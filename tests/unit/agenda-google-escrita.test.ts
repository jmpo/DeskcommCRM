import { beforeEach, describe, expect, it, vi } from "vitest";

import { apagarNoGoogle, idDeEventoDoGoogle, publicarNoGoogle } from "@/lib/agenda/google/escrita";
import type { AgendamentoParaGoogle } from "@/lib/agenda/google/evento";

/**
 * A IDA — e as três propriedades que ela precisa ter para não estragar a agenda
 * pessoal de quem atende.
 *
 * 1. IDEMPOTÊNCIA. Todo cron roda duas vezes algum dia. Se a segunda ida criar um
 *    segundo evento, o cliente vê a mesma consulta duplicada na agenda dele — e
 *    o horário fica bloqueado em dobro.
 * 2. APAGAR É "NÃO EXISTE MAIS", não "a chamada deu 200". 404 e 410 são o estado
 *    desejado; tratá-los como erro encheria a Central de aviso que não é falha.
 * 3. ERRO CLASSIFICADO, não engolido: o desfecho decide se o worker tenta de
 *    novo, rebaixa a conexão ou pede reautenticação.
 */

const AGENDAMENTO: AgendamentoParaGoogle = {
  id: "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e",
  organization_id: "aaaaaaaa-0000-4000-8000-00000000000a",
  title: "Consulta",
  starts_at: "2026-09-02T13:00:00.000Z",
  ends_at: "2026-09-02T13:30:00.000Z",
  time_zone: "America/Sao_Paulo",
  status: "confirmed",
  location_kind: "in_person",
};

function resposta(status: number, corpo: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => corpo,
  } as unknown as Response;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("fetch", vi.fn());
});

describe("o id do evento no Google", () => {
  it("é derivado do agendamento e estável entre chamadas", () => {
    expect(idDeEventoDoGoogle(AGENDAMENTO.id)).toBe(idDeEventoDoGoogle(AGENDAMENTO.id));
  });

  it("respeita o alfabeto que o Google aceita — [a-v0-9], mínimo 5", () => {
    const id = idDeEventoDoGoogle(AGENDAMENTO.id);
    expect(id).toMatch(/^[a-v0-9]{5,1024}$/);
  });

  it("CONTROLE: ids diferentes não colidem", () => {
    // Sem isto, uma normalização agressiva demais (por exemplo, remover TODO
    // caractere não-alfabético e truncar) passaria nos dois casos acima e
    // mandaria dois compromissos para o MESMO evento no Google.
    const a = idDeEventoDoGoogle("0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e");
    const b = idDeEventoDoGoogle("0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4f");
    expect(a).not.toBe(b);
  });
});

describe("publicar", () => {
  it("PRIMEIRA publicação usa POST, com o id derivado no CORPO", async () => {
    /**
     * ⚠️ ESTE CASO ASSERTAVA `PUT`, E A PREMISSA ERA FALSA.
     *
     * Ele dizia que `POST criaria um evento novo a cada rodada` — o que é
     * verdade para um POST SEM id, e falso para o POST com id derivado, que é o
     * que `events.insert` aceita. E o PUT que ele exigia devolve **404 em id que
     * não existe**: medido na VPS do dono, três compromissos, três
     * `evento_sumiu: HTTP 404`, nenhum evento criado, repetindo a cada 5 minutos.
     *
     * O teste passava porque o dublê responde 200 a qualquer coisa. Ele guardava
     * a CHAMADA e não o EFEITO — e a chamada que ele guardava era a errada.
     *
     * A propriedade que ele PROTEGIA continua protegida, e é o caso abaixo:
     * reenviar não pode duplicar. O que muda é como isso se consegue.
     *
     * Contrato conferido na doc oficial, não de memória:
     * https://developers.google.com/workspace/calendar/api/v3/reference/events/insert
     */
    vi.mocked(fetch).mockResolvedValue(resposta(200, { id: "deskcommabc", sequence: 3 }));
    const r = await publicarNoGoogle("tok", "ana@clinica.com.br", AGENDAMENTO);
    expect(r.ok).toBe(true);

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(
      init.method,
      "sem `google_event_id` o evento NÃO existe no Google, e `PUT` num id " +
        "inexistente devolve 404 — foi o que matou a ida na v1.9.1",
    ).toBe("POST");
    // A URL do POST é a COLEÇÃO: o id não vai nela.
    expect(url).toContain(encodeURIComponent("ana@clinica.com.br"));
    expect(url.endsWith("/events")).toBe(true);
  });

  it("o id derivado vai no CORPO do POST — é ele que impede a duplicata", async () => {
    // A propriedade que o caso antigo protegia, medida onde ela agora vive.
    // Sem o id no corpo, cada rodada do cron criaria um evento novo e a agenda
    // do cliente encheria de cópias da mesma consulta.
    vi.mocked(fetch).mockResolvedValue(resposta(200, { id: "deskcommabc" }));
    await publicarNoGoogle("tok", "cal", AGENDAMENTO);
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const corpo = JSON.parse(String(init.body)) as { id?: string };
    expect(corpo.id, "o POST foi sem id — o Google geraria um novo a cada rodada").toBe(
      idDeEventoDoGoogle(AGENDAMENTO.id),
    );
  });

  it("republicação usa PUT, porque o evento JÁ existe lá", async () => {
    vi.mocked(fetch).mockResolvedValue(resposta(200, { id: "jaexiste", sequence: 4 }));
    const r = await publicarNoGoogle("tok", "cal", AGENDAMENTO, "jaexiste");
    expect(r.ok).toBe(true);
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(init.method, "com id guardado, criar de novo é que duplicaria").toBe("PUT");
    expect(url).toContain(idDeEventoDoGoogle(AGENDAMENTO.id));
  });

  it("409 na criação cai para PUT — o id já estava lá", async () => {
    /**
     * O 409 `duplicate` é a resposta do Google para id que já existe, e a ação
     * que a própria doc sugere é "use the events.update method".
     * https://developers.google.com/workspace/calendar/api/guides/errors
     *
     * Isto acontece quando a publicação anterior criou o evento mas a gravação
     * do `google_event_id` na nossa linha não completou — o evento existe lá e
     * nós não sabemos. Sem este caminho, esse compromisso ficaria preso em 409
     * para sempre.
     */
    vi.mocked(fetch)
      .mockResolvedValueOnce(resposta(409, { error: { errors: [{ reason: "duplicate" }] } }))
      .mockResolvedValueOnce(resposta(200, { id: "deskcommabc", sequence: 1 }));
    const r = await publicarNoGoogle("tok", "cal", AGENDAMENTO);
    expect(r.ok, "o 409 não foi tratado — o compromisso ficaria preso nele").toBe(true);
    expect(vi.mocked(fetch).mock.calls).toHaveLength(2);
    const [, primeira] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const [, segunda] = vi.mocked(fetch).mock.calls[1] as [string, RequestInit];
    expect(primeira.method).toBe("POST");
    expect(segunda.method).toBe("PUT");
  });

  it("404 ao CRIAR não é `evento_sumiu` — é o calendário que não existe", async () => {
    /**
     * As duas leituras do 404, que a v1.9.1 confundia numa só. Na criação a URL
     * é a coleção e não carrega id de evento nenhum: 404 ali só pode ser o
     * calendário. Dizer "o evento sumiu" manda quem lê procurar um evento — e o
     * que falta é o calendário. Consertos opostos: um pede reconciliar, o outro
     * reconectar.
     */
    vi.mocked(fetch).mockResolvedValue(resposta(404, { error: { code: 404, message: "Not Found" } }));
    const r = await publicarNoGoogle("tok", "cal-que-nao-existe", AGENDAMENTO);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.classificacao.desfecho).toBe("calendario_sumiu");
  });

  it("404 ao ATUALIZAR continua sendo `evento_sumiu` — tínhamos o id e ele se foi", async () => {
    vi.mocked(fetch).mockResolvedValue(resposta(404, { error: { code: 404, message: "Not Found" } }));
    const r = await publicarNoGoogle("tok", "cal", AGENDAMENTO, "id-que-existia");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.classificacao.desfecho).toBe("evento_sumiu");
  });

  it("devolve o sequence que o Google mandou — é o que detecta edição alheia", async () => {
    vi.mocked(fetch).mockResolvedValue(resposta(200, { id: "x", sequence: 7 }));
    const r = await publicarNoGoogle("tok", "cal", AGENDAMENTO);
    expect(r.ok && r.sequence).toBe(7);
  });

  it("erro do Google vira CLASSIFICAÇÃO, não exceção solta", async () => {
    vi.mocked(fetch).mockResolvedValue(
      resposta(403, { error: { code: 403, errors: [{ reason: "insufficientPermissions" }] } }),
    );
    const r = await publicarNoGoogle("tok", "cal", AGENDAMENTO);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.classificacao.desfecho, "403 de escopo não pode virar retry infinito").toBe(
        "sem_permissao",
      );
    }
  });

  it("falha de REDE também é classificada — e é retentável", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("fetch failed"));
    const r = await publicarNoGoogle("tok", "cal", AGENDAMENTO);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.classificacao.desfecho).toBe("transitorio");
  });
});

describe("apagar", () => {
  it("404 é SUCESSO — o evento não existe mais, que é o estado desejado", async () => {
    vi.mocked(fetch).mockResolvedValue(resposta(404, {}));
    const r = await apagarNoGoogle("tok", "cal", AGENDAMENTO.id);
    expect(
      r.ok,
      "tratar 404 como erro encheria a Central de avisos com uma falha que não é falha",
    ).toBe(true);
  });

  it("410 também", async () => {
    vi.mocked(fetch).mockResolvedValue(resposta(410, {}));
    expect((await apagarNoGoogle("tok", "cal", AGENDAMENTO.id)).ok).toBe(true);
  });

  it("CONTROLE: 500 NÃO é sucesso — senão o par acima passa por tolerar tudo", async () => {
    vi.mocked(fetch).mockResolvedValue(resposta(500, {}));
    expect((await apagarNoGoogle("tok", "cal", AGENDAMENTO.id)).ok).toBe(false);
  });
});
