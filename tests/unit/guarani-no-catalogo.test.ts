/**
 * Guarani no catálogo: moeda SEM subunidade.
 *
 * O defeito medido em produção (23/09/2026): o preço digitado "125.000" virava
 * `preco_cents = 12.500.000` (×100 fixo) e `formatCents` — que segue a régua de
 * unidades menores do `Intl` — escrevia "PYG 12,500,000" para o agente de IA
 * cotar ao cliente. Cem vezes o preço, numa conversa de venda.
 */
import { describe, expect, it } from "vitest";

import { casasDaMoeda, formatCents, MOEDAS_SERVIDAS } from "@/lib/money";
import { precoParaCentavos } from "@/lib/schemas/produtos";
import { lerPlanilha } from "@/lib/catalogo/planilha";

const semEspacoFino = (s: string) => s.replace(/\s/g, " ");

describe("guarani servido", () => {
  it("está entre as moedas servidas e não tem casas decimais", () => {
    expect(MOEDAS_SERVIDAS).toContain("PYG");
    expect(casasDaMoeda("PYG")).toBe(0);
    expect(casasDaMoeda("BRL")).toBe(2);
  });

  it("escreve como se lê no Paraguai", () => {
    expect(semEspacoFino(formatCents(125_000, "PYG"))).toBe("Gs. 125.000");
  });
});

describe("o preço digitado cai na régua da moeda", () => {
  it("guarani: milhar com ponto, símbolo e sem centavo", () => {
    expect(precoParaCentavos("125.000", 0)).toBe(125_000);
    expect(precoParaCentavos("Gs. 125.000", 0)).toBe(125_000);
    expect(precoParaCentavos("₲125.000", 0)).toBe(125_000);
    expect(precoParaCentavos("125000", 0)).toBe(125_000);
    expect(precoParaCentavos("125.000,00", 0)).toBe(125_000);
  });

  it("centavo numa moeda sem centavo é recusado, não arredondado", () => {
    expect(precoParaCentavos("125.000,50", 0)).toBeNull();
  });

  it("o real continua igual (2 casas é o padrão)", () => {
    expect(precoParaCentavos("R$ 5.499,00")).toBe(549_900);
    expect(precoParaCentavos("49,90", 2)).toBe(4_990);
  });

  it("formatar o que foi lido devolve o que a pessoa digitou", () => {
    const lido = precoParaCentavos("125.000", casasDaMoeda("PYG"))!;
    expect(semEspacoFino(formatCents(lido, "PYG"))).toBe("Gs. 125.000");
  });

  it("a planilha do catálogo usa as casas que recebe", () => {
    const r = lerPlanilha("codigo,nome,preco\nPICO,Pico de alta presión,125.000\n", undefined, 0);
    expect("erro" in r).toBe(false);
    if (!("erro" in r)) expect(r.produtos[0]!.preco_cents).toBe(125_000);
  });
});
