/**
 * "ESTÁ NA FILA" É UMA DECISÃO DE PRODUTO E TEM UM LUGAR SÓ.
 *
 * ## O que este teste existe para impedir
 *
 * A definição estava copiada em SEIS sítios e eles não concordavam entre si:
 *
 *   supabase/baseline.sql (trg_conversation_routing_requested)   open+pending
 *   lib/routing/queue.ts  getQueuePosition  (o nº que o CLIENTE ouve)  open+pending
 *   lib/routing/queue.ts  getQueuePositions (o nº que a TELA mostra)   open
 *   lib/routing/queue.ts  getQueueStatus    (o painel do gerente)      open
 *   app/api/v1/conversations/counts         (o badge da aba)           open
 *   components/inbox/InboxLayout            (a aba Fila)               open
 *
 * Duas consequências de produto, não de estilo: a conversa que o automático
 * ESCALOU (`pending`) sumia da aba, do badge e do painel — a que mais precisa de
 * uma pessoa era a única invisível; e duas funções VIZINHAS no mesmo arquivo
 * davam números diferentes, então o "você é o 5º da fila" que o cliente recebe
 * pelo WhatsApp não batia com o "3º" que o atendente lia na tela.
 *
 * O gate é textual porque o defeito é textual: um literal `"open"` sozinho num
 * predicado de fila é exatamente como os seis divergiram. Varre o FONTE e cobra a
 * constante — o sétimo sítio nasce ligado ou nasce vermelho.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CONVERSATION_QUEUE_STATUSES } from "@/lib/schemas";

const RAIZ = join(__dirname, "..", "..");

function fonte(caminho: string): string {
  return readFileSync(join(RAIZ, caminho), "utf8");
}

/** Todo sítio que decide, no código de produção, quem está na fila. */
const SITIOS_DA_FILA = [
  "lib/routing/queue.ts",
  "app/api/v1/conversations/counts/route.ts",
  "components/inbox/InboxLayout.tsx",
  "lib/mcp/tools/conversations.ts",
] as const;

describe("a fila tem uma definição só", () => {
  it("a constante é o vocabulário de espera — nem terminal, nem com dono", () => {
    expect([...CONVERSATION_QUEUE_STATUSES]).toEqual(["open", "pending"]);
    // `claimed` tem dono e `ai_handling` é o automático cuidando: nenhum dos dois
    // é alguém esperando uma pessoa.
    for (const fora of ["claimed", "ai_handling", "closed", "archived", "resolved"]) {
      expect(CONVERSATION_QUEUE_STATUSES as readonly string[]).not.toContain(fora);
    }
  });

  it.each(SITIOS_DA_FILA)("%s consome a constante", (caminho) => {
    expect(fonte(caminho)).toContain("CONVERSATION_QUEUE_STATUSES");
  });

  it.each(SITIOS_DA_FILA)("%s não decide a fila por literal solto", (caminho) => {
    const src = fonte(caminho);
    // O padrão exato que produziu a divergência: um predicado de status com
    // `"open"` literal, sem `pending` ao lado. Comentários não contam — é o
    // código que decide.
    const semComentarios = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const suspeitos = [
      /\.eq\(\s*["']status["']\s*,\s*["']open["']\s*\)/,
      /status\s*===\s*["']open["']/,
      /\.in\(\s*["']status["']\s*,\s*\[\s*["']open["']\s*,\s*["']pending["']\s*\]/,
    ];
    for (const re of suspeitos) {
      expect(semComentarios, `${caminho}: predicado de fila fora da constante`).not.toMatch(re);
    }
  });

  it("o trigger de roteamento do banco concorda com a constante", () => {
    // O baseline é a outra ponta da mesma decisão, e foi ele que esteve certo o
    // tempo todo: o trigger sempre enfileirou `pending`. Se alguém encolher a
    // constante sem mexer no trigger, o rodízio volta a atribuir conversa que a
    // tela jura não existir — que era exatamente o estado anterior.
    const baseline = fonte("supabase/baseline.sql");
    const gatilho = baseline.slice(baseline.indexOf("trg_conversation_routing_requested"));
    const when = gatilho.slice(0, gatilho.indexOf("execute function"));

    // EQUIVALÊNCIA, não inclusão. Iterar a constante e pedir `toContain` teria um
    // ponto cego que este arquivo existe para não ter: encolher a constante de
    // volta para `["open"]` satisfaria o teste (o trigger contém 'open'), e a
    // catraca ficaria verde pelo motivo errado — exatamente a divergência que ela
    // vigia. Extrair o conjunto DO TRIGGER e comparar os dois lados reprova nas
    // duas direções.
    const doTrigger = [...when.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(doTrigger).toEqual([...CONVERSATION_QUEUE_STATUSES].sort());
  });
});
