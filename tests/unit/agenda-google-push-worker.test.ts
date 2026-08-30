import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { apagarNoGoogle, publicarNoGoogle } from "@/lib/agenda/google/escrita";
import { apenasDeMembrosAtivos } from "@/lib/agenda/google/membros";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";

/**
 * O WORKER DA IDA — e as quatro propriedades que decidem se ele estraga a agenda
 * pessoal de quem atende.
 *
 * A mais sutil é a primeira, e ela não aparece lendo o código: quem NÃO tem
 * agenda conectada não pode ter `google_synced_at` marcado. Marcar ali faria a
 * ida "acontecer" sem ter acontecido — e a linha nunca mais seria candidata no
 * dia em que a pessoa conectasse. O compromisso ficaria invisível no Google para
 * sempre, sem erro em lugar nenhum.
 *
 * ═══ O QUE ESTE ARQUIVO NÃO COBRE, e a razão está escrita porque ele já mentiu
 *
 * Ele NÃO prova que a consulta de leitura é VÁLIDA. O `createAdminClient` daqui
 * é um dublê cuja cadeia aceita qualquer string em `or`/`eq`/`not`, então um
 * filtro que o Postgres RECUSA é, para ele, indistinguível de um que o Postgres
 * aceita.
 *
 * Isso não é hipótese: o worker rodou meses em produção com
 * `.or("google_synced_at.is.null,updated_at.gt.google_synced_at")`, que o
 * PostgREST recusa inteiro (o lado direito de `gt.` é valor literal, nunca nome
 * de coluna). Nenhuma linha voltava, nenhum compromisso ia ao Google — e estes
 * casos aqui ficaram verdes o tempo todo, porque o dublê devolvia `pendentes`
 * independentemente do filtro pedido.
 *
 * Quem guarda AQUELA propriedade são dois arquivos, de propósito fora daqui:
 *   - `tests/unit/postgrest-nao-compara-coluna-com-coluna.test.ts` — a FORMA do
 *     filtro, contra a lista de colunas real da tabela;
 *   - `tests/invariants/agenda-ida-ao-google-termina.test.ts` — o EFEITO, contra
 *     Postgres real, incluindo o laço dos dois relógios.
 *
 * O escopo está escrito para ninguém concluir, ao ver quatro casos verdes aqui,
 * que a ida ao Google está provada. Estes quatro provam o que o worker FAZ com
 * as linhas que recebe, não QUE linhas ele recebe.
 */

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined), isServiceRoleConfigured: vi.fn(() => true) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/webhooks/secrets", () => ({ decryptWebhookSecret: vi.fn(async () => "tok-decifrado") }));
vi.mock("@/lib/agenda/google/escrita", () => ({
  publicarNoGoogle: vi.fn(),
  apagarNoGoogle: vi.fn(),
}));
vi.mock("@/lib/agenda/google/membros", () => ({ apenasDeMembrosAtivos: vi.fn() }));

process.env.INTERNAL_CRON_SECRET = "segredo-do-cron";

const ORG = "aaaaaaaa-0000-4000-8000-00000000000a";
const DONO = "bbbbbbbb-0000-4000-8000-00000000000b";

/** O que o worker gravou em cada agendamento, por id. */
let gravado: Record<string, Record<string, unknown>> = {};
/** As linhas pendentes que o banco devolve. */
let pendentes: Array<Record<string, unknown>> = [];
/** As conexões que o banco devolve — vazio simula "não conectou". */
let conexoes: Array<Record<string, unknown>> = [];

function linha(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e",
    organization_id: ORG,
    owner_user_id: DONO,
    title: "Consulta",
    description: null,
    starts_at: "2026-09-02T13:00:00.000Z",
    ends_at: "2026-09-02T13:30:00.000Z",
    time_zone: "America/Sao_Paulo",
    status: "confirmed",
    location_kind: "in_person",
    location_details: null,
    google_event_id: null,
    ...over,
  };
}

function pedido(): NextRequest {
  return new NextRequest("https://crm.exemplo/api/v1/cron/agenda-google-push", {
    headers: { authorization: "Bearer segredo-do-cron" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  gravado = {};
  pendentes = [linha()];
  conexoes = [
    { id: "conn-1", status: "healthy", oauth_access_token_encrypted: "\\xCIFRADO", account_email: "ana@clinica.com.br" },
  ];
  vi.mocked(decryptWebhookSecret).mockResolvedValue("tok-decifrado");
  vi.mocked(apenasDeMembrosAtivos).mockImplementation(async (_a, l) => [...l] as never);
  vi.mocked(publicarNoGoogle).mockResolvedValue({ ok: true, eventoId: "deskcommabc", sequence: 1 });
  vi.mocked(apagarNoGoogle).mockResolvedValue({ ok: true, eventoId: "deskcommabc", sequence: null });

  vi.mocked(createAdminClient).mockReturnValue({
    from: (tabela: string) => ({
      select: () => {
        const cadeia: Record<string, unknown> = {};
        for (const m of ["or", "not", "order", "limit", "eq"]) {
          cadeia[m] = () => cadeia;
        }
        cadeia.then = (r: (v: unknown) => unknown) =>
          r({ data: tabela === "calendar_appointments" ? pendentes : conexoes, error: null });
        return cadeia;
      },
      update: (patch: Record<string, unknown>) => {
        const cadeia = {
          eq: (_c: string, id: string) => {
            gravado[id] = { ...(gravado[id] ?? {}), ...patch };
            return cadeia;
          },
          then: (r: (v: unknown) => unknown) => r({ error: null }),
        };
        return cadeia;
      },
    }),
  } as never);
});

async function rodar() {
  const { GET } = await import("@/app/api/v1/cron/agenda-google-push/route");
  return (await (await GET(pedido())).json()) as { data: Record<string, number> };
}

describe("worker da ida do Google", () => {
  it("publica o compromisso de quem tem agenda conectada", async () => {
    const r = await rodar();
    expect(publicarNoGoogle).toHaveBeenCalledTimes(1);
    expect(r.data.publicados).toBe(1);
    expect(gravado[linha().id as string]?.google_event_id).toBe("deskcommabc");
  });

  it("⚠️ SEM CONEXÃO não marca `google_synced_at` — senão a linha morre invisível", async () => {
    // A propriedade mais sutil do worker. Marcar aqui faria a ida "acontecer"
    // sem ter acontecido: a linha deixaria de ser candidata, e no dia em que a
    // pessoa conectasse o compromisso nunca apareceria no Google — sem erro em
    // lugar nenhum, sem sintoma, para sempre.
    conexoes = [];
    const r = await rodar();
    expect(r.data.semConexao).toBe(1);
    expect(publicarNoGoogle).not.toHaveBeenCalled();
    expect(
      gravado[linha().id as string],
      "o worker escreveu na linha de quem não tem conexão — ela deixou de ser candidata",
    ).toBeUndefined();
  });

  it("cancelado APAGA lá, não publica", async () => {
    // Publicar um cancelado deixaria o horário bloqueado na agenda pessoal de
    // quem atende — o efeito oposto ao pedido.
    pendentes = [linha({ status: "cancelled", google_event_id: "deskcommabc" })];
    const r = await rodar();
    expect(apagarNoGoogle).toHaveBeenCalledTimes(1);
    expect(publicarNoGoogle).not.toHaveBeenCalled();
    expect(r.data.apagados).toBe(1);
    expect(gravado[linha().id as string]?.google_event_id, "o id do evento tem de sair da linha").toBeNull();
  });

  it("erro do Google FICA NA LINHA, não só no log", async () => {
    // Erro que só existe em log é estoque morto: `google_sync_error` é o que a
    // tela pode mostrar para a pessoa entender por que o Google não recebeu.
    vi.mocked(publicarNoGoogle).mockResolvedValue({
      ok: false,
      classificacao: { desfecho: "sem_permissao", mensagem: "escopo faltando" } as never,
      detalhe: "HTTP 403",
    });
    const r = await rodar();
    expect(r.data.falhas).toBe(1);
    expect(String(gravado[linha().id as string]?.google_sync_error)).toContain("sem_permissao");
    expect(
      gravado[linha().id as string]?.google_synced_at,
      "marcou como sincronizado depois de FALHAR",
    ).toBeUndefined();
  });

  it("ex-membro não recebe nada — o filtro de time vale para escrever também", async () => {
    // `apenasDeMembrosAtivos` já impede LER a agenda pessoal de quem saiu.
    // Escrever nela é pior: manda compromisso da clínica para o calendário
    // particular de alguém que não é mais do time.
    vi.mocked(apenasDeMembrosAtivos).mockResolvedValue([] as never);
    const r = await rodar();
    expect(publicarNoGoogle).not.toHaveBeenCalled();
    expect(r.data.publicados).toBe(0);
  });

  it("CONTROLE: sem o segredo do cron, 401 e nada acontece", async () => {
    const { GET } = await import("@/app/api/v1/cron/agenda-google-push/route");
    const r = await GET(
      new NextRequest("https://crm.exemplo/api/v1/cron/agenda-google-push", {
        headers: { authorization: "Bearer errado" },
      }),
    );
    expect(r.status).toBe(401);
    expect(publicarNoGoogle).not.toHaveBeenCalled();
  });
});
