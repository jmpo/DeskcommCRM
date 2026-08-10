import { readFileSync } from "node:fs";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

/**
 * QUANTO TEMPO RESTA PARA ESCREVER — do lado de quem atende.
 *
 * ─── O que faltava ─────────────────────────────────────────────────────────
 *
 * A regra da janela de 24h existe desde sempre em `windowRemainingMs`, e é
 * aplicada — mas o ÚNICO consumidor era o guardrail do agente de IA. Medido com
 * `grep`: nenhum componente, nenhuma rota do inbox, nenhum hook.
 *
 * O humano abria a conversa sem saber que restavam vinte minutos, escrevia
 * depois e recebia um `failed` com `131047`. Um número de cinco dígitos no
 * lugar de "a janela fechou; mande um modelo".
 *
 * ─── O que estes casos prendem ──────────────────────────────────────────────
 *
 * Que o relógio só apareça em canal que REALMENTE restringe (mostrá-lo onde não
 * muda nada ensina a ignorá-lo em todos); que a borda das 24h feche de verdade;
 * e que a tela não decida isso sozinha — quem sabe da regra é o seam.
 */
import { JanelaSelo } from "@/components/inbox/JanelaSelo";
import { estadoDaJanela, formatarRestante } from "@/lib/channels/janela";

const AGORA = new Date("2026-08-10T18:00:00Z");
const hMenos = (h: number) => new Date(AGORA.getTime() - h * 3_600_000).toISOString();

describe("o estado da janela", () => {
  it("canal SEM restrição não tem relógio — inventá-lo ensina a ignorá-lo", () => {
    // O número por QR aceita texto livre a qualquer hora.
    expect(estadoDaJanela("waha", hMenos(48), AGORA)).toEqual({ tipo: "sem_restricao" });
  });

  it("canal com restrição e cliente recente: aberta, com o que resta", () => {
    const e = estadoDaJanela("zernio", hMenos(1), AGORA);
    expect(e.tipo).toBe("aberta");
    if (e.tipo === "aberta") expect(Math.round(e.restanteMs / 3_600_000)).toBe(23);
  });

  it("passadas as 24h: fechada", () => {
    expect(estadoDaJanela("zernio", hMenos(25), AGORA)).toEqual({ tipo: "fechada" });
  });

  it("em 24h EXATAS já fechou — a borda é exclusiva, como a da plataforma", () => {
    expect(estadoDaJanela("zernio", hMenos(24), AGORA)).toEqual({ tipo: "fechada" });
  });

  it("cliente que NUNCA escreveu está fechado, não aberto", () => {
    // Fail-closed: tratá-lo como aberto faria toda prospecção fria passar como
    // se fosse resposta — exatamente o que a regra existe para impedir.
    expect(estadoDaJanela("zernio", null, AGORA)).toEqual({ tipo: "fechada" });
  });

  it("sem canal resolvido não trava nada", () => {
    // Inventar "fechada" barraria um envio que talvez saísse sem problema.
    expect(estadoDaJanela(null, hMenos(1), AGORA)).toEqual({ tipo: "sem_restricao" });
  });
});

describe("como o tempo é escrito", () => {
  it("horas e minutos quando falta muito", () => {
    expect(formatarRestante(23 * 3_600_000 + 40 * 60_000)).toBe("23h 40m");
  });

  it("só minutos abaixo de uma hora", () => {
    expect(formatarRestante(40 * 60_000)).toBe("40m");
  });

  it('abaixo de um minuto NÃO vira "0m" — que se lê como fechada', () => {
    expect(formatarRestante(30_000)).toBe("menos de 1m");
  });
});

describe("o selo na tela", () => {
  it("não renderiza nada em canal sem restrição", () => {
    const { container } = render(<JanelaSelo provider="waha" lastInboundAt={hMenos(1)} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("mostra o tempo restante quando aberta", () => {
    render(<JanelaSelo provider="zernio" lastInboundAt={new Date(Date.now() - 3_600_000).toISOString()} />);
    expect(screen.getByText(/Janela \d+h/)).toBeInTheDocument();
  });

  it("diz o que fazer quando fechada, não só que fechou", () => {
    // "Janela fechada" sozinho deixa o operador sem saída. O texto nomeia a
    // saída que existe: modelo aprovado.
    render(<JanelaSelo provider="zernio" lastInboundAt={new Date(Date.now() - 30 * 3_600_000).toISOString()} />);
    expect(screen.getByText(/só modelo/i)).toBeInTheDocument();
  });
});

describe("os elos que somem sem barulho", () => {
  it("a regra mora no SEAM, não na tela", () => {
    // Um `if (provider === "zernio")` no componente é o que o invariante 1 da
    // doutrina proíbe, e o `lint:channels` reprova.
    const fonte = readFileSync("components/inbox/JanelaSelo.tsx", "utf8");
    expect(fonte).toMatch(/estadoDaJanela/);
    expect(fonte, "a tela está decidindo por provider").not.toMatch(/"zernio"|"meta_cloud"|"waha"/);
  });

  it("a cabeçalho MONTA o selo — a regra sozinha não mostra nada", () => {
    const fonte = readFileSync("components/inbox/ConversationHeader.tsx", "utf8");
    // A tag no INÍCIO da linha, não em qualquer lugar dela: a primeira versão
    // deste caso aceitava `{null && <JanelaSelo` — o sabote de desmontar o selo
    // passou verde, porque a string continuava lá.
    expect(fonte, "o selo não é montado, só mencionado").toMatch(/\n\s*<JanelaSelo\b/);
    expect(fonte).toMatch(/lastInboundAt=\{conversation\.last_inbound_at\}/);
  });

  it("o `provider` chega pela consulta — sem ele o selo nunca aparece", () => {
    // A coluna fora do `select` não chega, e o cast do embed faz isso NÃO ser
    // erro de tipo: ficaria `undefined` e todo canal viraria "sem restrição".
    const fonte = readFileSync("app/api/v1/conversations/_handler.ts", "utf8");
    expect(fonte).toMatch(/channel_sessions:channel_session_id \(phone_number, display_name, provider\)/);
  });

  it("a conta é a MESMA do guardrail do agente", () => {
    // Duas contas para a mesma pergunta divergem: a tela diria "aberta" e o
    // envio seria recusado, ou o contrário — e ninguém saberia em qual acreditar.
    const fonte = readFileSync("lib/channels/janela.ts", "utf8");
    expect(fonte).toMatch(/from "@\/lib\/agent-engine\/guardrails\/messaging-window"/);
    expect(fonte).toMatch(/windowRemainingMs\(/);
  });
});
