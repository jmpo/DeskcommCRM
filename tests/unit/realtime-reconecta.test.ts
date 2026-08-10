import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * O CANAL QUE CAIU TEM DE VOLTAR SOZINHO.
 *
 * ─── O defeito, relatado olhando a tela ─────────────────────────────────────
 *
 * "Às vezes preciso atualizar para a mensagem aparecer." Aconteceu com uma
 * mensagem mandada do próprio celular: ela chegou ao banco pelo webhook e não
 * apareceu na conversa aberta até o F5.
 *
 * ─── Três coisas somadas, e nenhuma delas gritava ──────────────────────────
 *
 * 1. O callback do `subscribe` ANOTAVA o estado e não fazia mais nada. Em
 *    `CHANNEL_ERROR`, `TIMED_OUT` ou `CLOSED` o canal ficava morto — e o efeito
 *    só re-roda quando a topologia muda, então nada o ressuscitava.
 * 2. `refetchOnWindowFocus` é `false` no padrão do repo (certo para o resto do
 *    app), então voltar para a aba também não buscava nada.
 * 3. O Realtime NÃO guarda o que passou enquanto o canal esteve fora. Mesmo
 *    reassinando, o evento perdido não chega — só o PRÓXIMO.
 *
 * Somadas: a única recuperação era a pessoa recarregar. Que foi o sintoma.
 *
 * ─── Por que canal NOVO, e não `subscribe()` de novo ───────────────────────
 *
 * Um canal que entrou em erro não volta: o socket derrubou a topologia dele, e
 * reassinar o mesmo objeto responde SUBSCRIBED sem nunca mais entregar. Morte
 * silenciosa — a mesma classe de defeito que a memo de auth deste arquivo já
 * tinha, e pela qual o cabeçalho dele já pagou.
 */

const FONTE = readFileSync("hooks/realtime/useRealtimeChannel.ts", "utf8");

describe("o canal volta sozinho", () => {
  it("uma falha AGENDA nova tentativa — antes só anotava o estado", () => {
    expect(FONTE).toMatch(/CHANNEL_ERROR" \|\| s === "TIMED_OUT" \|\| s === "CLOSED"/);
    expect(FONTE, "a falha não agenda retomada").toMatch(/retomada = setTimeout\(/);
  });

  it("com recuo exponencial e TETO — rajada contra socket caído piora tudo", () => {
    expect(FONTE).toMatch(/Math\.min\(30_000, 1_000 \* 2 \*\* tentativas\)/);
  });

  it("monta canal NOVO a cada tentativa", () => {
    // Reassinar o mesmo objeto devolve SUBSCRIBED e não entrega nada.
    expect(FONTE).toMatch(/supabase\.removeChannel\(active\);\s*\n\s*montar\(\);/);
    expect(FONTE).toMatch(/supabase\.channel\(`\$\{channelName\}#\$\{tentativas\}`\)/);
  });

  it("ao voltar, FORÇA uma busca — o que passou não chega sozinho", () => {
    // Esta é a parte que fecha o buraco de verdade. Sem ela o canal volta a
    // funcionar para o PRÓXIMO evento e a tela segue sem o anterior.
    expect(FONTE).toMatch(/handler\(\{ tipo: "reassinado" \}\)/);
  });

  it("só força quando VEIO de uma queda — a primeira assinatura não busca à toa", () => {
    expect(FONTE).toMatch(/if \(tentativas > 0\) \{/);
  });

  it("descarta o canal velho que responde tarde", () => {
    // Duas tentativas em voo: sem a comparação, a que chega atrasada
    // sobrescreve o estado da que já está de pé.
    // Dentro do callback do subscribe, não em qualquer lugar: a guarda também
    // existe no `then` da auth, e a primeira versão deste caso passava verde com
    // a do subscribe removida.
    expect(FONTE).toMatch(/novo\.subscribe\(\(s\) => \{\s*\n\s*if \(cancelado \|\| active !== novo\) return;/);
  });

  it("o timer é cancelado na saída — senão remonta canal de tela fechada", () => {
    // No CLEANUP, não no agendamento: a mesma linha existe nos dois lugares, e
    // a primeira versão deste caso passava com a do cleanup removida — que é
    // justamente a que impede remontar canal de tela já fechada.
    expect(FONTE).toMatch(/cancelado = true;\s*\n\s*if \(retomada\) clearTimeout\(retomada\);/);
  });
});

describe("a segunda rede: voltar para a aba", () => {
  it("o hilo de mensagens ressincroniza ao focar", () => {
    const fonte = readFileSync("hooks/inbox/useMessagesRealtime.ts", "utf8");
    expect(fonte).toMatch(/refetchOnWindowFocus: true/);
  });

  it("a lista de conversas também", () => {
    const fonte = readFileSync("hooks/inbox/useConversationsRealtime.ts", "utf8");
    expect(fonte).toMatch(/refetchOnWindowFocus: true/);
  });

  it("e o padrão GLOBAL segue desligado — isto é exceção, não virada de chave", () => {
    // Recarregar tudo a cada troca de aba é gasto sem retorno numa tela que
    // muda devagar. O inbox é o oposto, e só ele.
    const fonte = readFileSync("lib/query/client.ts", "utf8");
    expect(fonte).toMatch(/refetchOnWindowFocus: false/);
  });
});
