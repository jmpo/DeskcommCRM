/**
 * O subtítulo do card do nó final passou a sair de `lib/followup/vocabulario.ts`
 * em vez de um mapa próprio deste arquivo — eram duas cópias das mesmas três
 * palavras. A troca só vale se o texto na tela for o MESMO, e "mesmo" aqui é
 * literal: `tests/e2e/followup-journey.spec.ts` confere "Convertido" no card.
 */
import { describe, expect, it } from "vitest";

import { describeNodeConfig } from "./nodeVisuals";

describe("describeNodeConfig — nó final", () => {
  it.each([
    ["converted", "Convertido"],
    ["exhausted", "Esgotado"],
    ["custom", "Personalizado"],
  ] as const)("outcome '%s' aparece no card como '%s'", (outcome, esperado) => {
    expect(describeNodeConfig("end", { outcome })).toBe(esperado);
  });
});

/**
 * O subtítulo do card de condição anunciava sempre o combinador. No modo
 * uma-saída-por-regra o motor NÃO consulta o combinador — o card estaria
 * afirmando uma coisa que o código ignora, e é no card que o usuário acredita.
 * Achado olhando o screenshot da própria evidência.
 */
describe("describeNodeConfig — nó de condição", () => {
  const regras = [
    { id: "regra-1", field: "tag" as const, op: "contains" as const, value: "vip" },
    { id: "regra-2", field: "steps_taken" as const, op: "gte" as const, value: 3 },
  ];

  it("no modo combinado anuncia o combinador, que é o que decide", () => {
    expect(describeNodeConfig("condition", { combinator: "and", checks: regras })).toBe("2 condição(ões) · E");
    expect(describeNodeConfig("condition", { combinator: "or", checks: regras })).toBe("2 condição(ões) · OU");
  });

  it("no modo uma-saída-por-regra NÃO anuncia combinador nenhum", () => {
    const texto = describeNodeConfig("condition", {
      combinator: "and",
      branching: "per_check",
      checks: regras,
    });
    expect(texto).toBe("2 regras · uma saída por regra");
    expect(texto).not.toMatch(/\bE\b|\bOU\b/);
  });
});
