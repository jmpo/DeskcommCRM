import { describe, expect, it, vi } from "vitest";

import { avisarLeadDoCrm } from "@/lib/ai/handoff/aviso-ao-lead";

/**
 * O AVISO DE "A IA SAIU DE CAMPO" SÓ FAZ SENTIDO SE A IA ESTEVE EM CAMPO.
 *
 * ─── O incidente, medido em produção (02/09/2026) ────────────────────────────
 *
 * Instalação SEM agente publicado (is_active=false, published_version_id=null).
 * O worker de sentimento — que roda para TODA mensagem, com ou sem agente —
 * disparou triggerHandoff('low_sentiment') sobre a conversa de um cliente que
 * mandava piada ("Jajaja"). O orquestrador de handoff enviou "Esse caso é
 * melhor resolvido por uma pessoa. Já acionei o time." — em português, numa
 * operação em espanhol, a um cliente que NUNCA tinha falado com IA nenhuma.
 *
 * E enviou QUATRO vezes em cinco minutos ao mesmo cliente: o envio travou
 * (channel_session_not_working), o watchdog redirigiu, e cada redrive virou
 * mensagem nova. Total: 5 mensagens fantasma para 2 clientes reais.
 *
 * As duas guardas deste arquivo são a causa raiz, não o sintoma:
 *  - sem fala prévia da IA na conversa, não há retirada a anunciar;
 *  - um aviso por conversa por janela de 24h, contado no BANCO (o requestId
 *    não segura porque cada disparo de handoff gera chamada nova).
 */

function adminFalso(mensagens: { metadata: Record<string, unknown> | null; created_at: string }[]) {
  const encadeado = {
    select: () => encadeado,
    eq: () => encadeado,
    order: () => encadeado,
    limit: () => Promise.resolve({ data: mensagens, error: null }),
    insert: vi.fn(() => Promise.resolve({ data: null, error: null })),
  };
  return { from: vi.fn(() => encadeado) } as never;
}

const ENTRADA = {
  organizationId: "org-1",
  conversationId: "conv-1",
  contactId: "contato-1",
  reason: "low_sentiment",
};

describe("as guardas do aviso ao lead", () => {
  it("IA que nunca falou na conversa não tem retirada a anunciar", async () => {
    const r = await avisarLeadDoCrm(adminFalso([]), ENTRADA);
    expect(r).toEqual({ avisado: false, porque: "ia_nunca_falou_nesta_conversa" });
  });

  it("aviso anterior na conversa não conta como fala da IA", async () => {
    // O caso da metralhadora: a ÚNICA "fala" é o próprio aviso do disparo
    // anterior. Sem esta distinção, o primeiro aviso indevido legitimaria o
    // segundo — o bug se autoalimentando.
    const r = await avisarLeadDoCrm(
      adminFalso([{ metadata: { aviso_de_escalacao: true }, created_at: new Date().toISOString() }]),
      ENTRADA,
    );
    expect(r.avisado).toBe(false);
    expect(r.porque).toBe("ia_nunca_falou_nesta_conversa");
  });

  it("com fala real da IA mas aviso recente, não repete", async () => {
    const agora = new Date().toISOString();
    const r = await avisarLeadDoCrm(
      adminFalso([
        { metadata: { aviso_de_escalacao: true }, created_at: agora },
        { metadata: null, created_at: agora },
      ]),
      ENTRADA,
    );
    expect(r).toEqual({ avisado: false, porque: "aviso_ja_enviado_na_janela" });
  });

  it("aviso VELHO (fora da janela) não bloqueia o novo — retrigger honesto avisa", async () => {
    const ontem = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const r = await avisarLeadDoCrm(
      adminFalso([
        { metadata: { aviso_de_escalacao: true }, created_at: ontem },
        { metadata: null, created_at: ontem },
      ]),
      ENTRADA,
    );
    // passa das guardas; o envio em si falha no dublê (sem handler real), e o
    // contrato do orquestrador é NUNCA lançar — o que se mede é que as guardas
    // não barraram por motivo de guarda.
    expect(r.porque === "ia_nunca_falou_nesta_conversa" || r.porque === "aviso_ja_enviado_na_janela").toBe(false);
  });
});
