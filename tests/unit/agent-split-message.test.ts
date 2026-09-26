// tests/unit/agent-split-message.test.ts
import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";

import { instrucaoDeBolhas, splitIntoBubbles } from "@/lib/agent-engine/agent/split-message";

describe("splitIntoBubbles", () => {
  it("texto curto vira uma bolha só (trim)", () => {
    expect(splitIntoBubbles("  Olá, tudo bem?  ", 600)).toEqual(["Olá, tudo bem?"]);
  });
  it("vazio/whitespace → []", () => {
    expect(splitIntoBubbles("", 600)).toEqual([]);
    expect(splitIntoBubbles("   \n  ", 600)).toEqual([]);
  });
  it("quebra por parágrafo quando cabe", () => {
    const out = splitIntoBubbles("Primeiro parágrafo.\n\nSegundo parágrafo.", 30);
    expect(out).toEqual(["Primeiro parágrafo.", "Segundo parágrafo."]);
  });
  it("nenhuma bolha excede maxChars (quebra por sentença)", () => {
    const text = "Oi! Como você está hoje? Queria falar do seu pedido. Ele já saiu para entrega.";
    const out = splitIntoBubbles(text, 30);
    expect(out.every((b) => b.length <= 30)).toBe(true);
    expect(out.join(" ")).toContain("pedido");
  });
  it("junta sentenças curtas adjacentes até o teto", () => {
    const out = splitIntoBubbles("Oi. Tudo bem? Beleza.", 100);
    expect(out).toHaveLength(1); // tudo cabe em 100
  });
  it("palavra única maior que o teto vai sozinha (não corta no meio)", () => {
    const big = "a".repeat(50);
    const out = splitIntoBubbles(`curto ${big} fim`, 20);
    expect(out).toContain(big);
    expect(out.every((b) => b.length > 0)).toBe(true);
  });
  it("não perde texto quando o ponto não é seguido de espaço (preço decimal)", () => {
    const out = splitIntoBubbles(
      "Seu pedido de R$149.90 já saiu para entrega hoje as 14h no bairro central.",
      30,
    );
    expect(out.join(" ")).toContain("Seu pedido");
    expect(out.join(" ")).toContain("149");
    expect(out.join(" ")).toContain("central");
  });

  it("nunca parte um valor em reais no separador de milhar (R$ 10.990) entre bolhas", () => {
    // Bug real em produção (2026-09-04): "R$ 10.990" virava bolha "R$ 10." + bolha
    // "990 no cartão…" — o cliente que via só a primeira lia "R$ 10" como o
    // preço de uma moto de R$ 10.990.
    const out = splitIntoBubbles(
      "Temos a DT3 por R$ 9.990 à vista no Pix ou R$ 10.990 no cartão em até 12x sem juros.",
      40,
    );
    for (const bubble of out) {
      expect(bubble).not.toMatch(/\d\.\s*$/); // nenhuma bolha termina em "dígito."
    }
    expect(out.join(" ")).toContain("10.990");
    expect(out.join(" ")).toContain("9.990");
  });

  it("não insere espaço espúrio dentro de um valor em reais (R$ 7. 990)", () => {
    const out = splitIntoBubbles("O valor é R$ 7.990 à vista no Pix.", 30);
    expect(out.join(" ")).not.toContain("7. 990");
    expect(out.join(" ")).toContain("7.990");
  });
});

// O parágrafo é a fronteira da bolha (medido em produção, 26/09/2026: com os
// parágrafos juntados até o teto, a opção não tinha ajuste — teto alto virava
// uma bolha só, teto baixo picotava o resumo do pedido no meio da linha).
describe("splitIntoBubbles — o parágrafo é a bolha", () => {
  it("três parágrafos curtos saem em três bolhas, na ordem, mesmo cabendo numa só", () => {
    const texto = "¡Hola! Soy Mia 😊\n\nSí, sirve para cualquier manguera.\n\n¿Te lo reservo?";
    expect(splitIntoBubbles(texto, 600)).toEqual([
      "¡Hola! Soy Mia 😊",
      "Sí, sirve para cualquier manguera.",
      "¿Te lo reservo?",
    ]);
  });

  it("o resumo do pedido — lista numa linha por item — sai inteiro, com as quebras de linha", () => {
    const resumo = [
      "Te resumo tu pedido:",
      "📦 Pico de alta presión x1 - ₲135.000",
      "📍 Av. San Ignacio 739, Valle Apu'a, Lambaré, Central",
      "📌 Ref: 2 cuadras de la cancha",
      "🕚 Mañana a las 11hs",
      "💵 Pagás en efectivo cuando te llega",
      "¿Confirmamos así?",
    ].join("\n");
    expect(splitIntoBubbles(resumo, 600)).toEqual([resumo]);
  });

  it("só o parágrafo que estoura o teto é partido, e dentro dele", () => {
    const texto = "Curto.\n\nPrimeira frase longa aqui. Segunda frase longa aqui.";
    expect(splitIntoBubbles(texto, 30)).toEqual([
      "Curto.",
      "Primeira frase longa aqui.",
      "Segunda frase longa aqui.",
    ]);
  });
});

// Medido em produção (26/09/2026): com a instrução antiga ("Prefira várias
// mensagens curtas a um texto único e longo"), o modelo chamava send_message
// várias vezes no mesmo passo — chamadas paralelas, que chegam fora de ordem.
// A instrução tem de pedir UM envio em parágrafos, e o corte do sistema tem de
// cumprir o que ela promete: partir nos parágrafos, em ordem.
describe("instrucaoDeBolhas", () => {
  it("desligado não diz nada ao modelo", () => {
    expect(instrucaoDeBolhas(false)).toBe("");
  });

  it("ligado pede UM envio em parágrafos — nunca várias chamadas de send_message", () => {
    const t = instrucaoDeBolhas(true);
    expect(t).toMatch(/ÚNICA chamada de send_message/);
    expect(t).toMatch(/parágrafos curtos separados por uma linha em branco/);
    expect(t).toMatch(/Nunca chame send_message mais de uma vez/);
    expect(t).not.toMatch(/várias mensagens/i);
  });

  it("o texto escrito como a instrução pede sai em bolhas nos parágrafos, na mesma ordem", () => {
    const resposta = [
      "¡Hola! Soy Mia, de Pedilo 😊",
      "Te cuento del Pico de alta presión: usa la presión de tu canilla para un chorro fuerte.",
      "Sale ₲135.000, con envío gratis y pagás cuando te llega. ¿Te lo reservo?",
    ].join("\n\n");
    const bolhas = splitIntoBubbles(resposta, 90);
    expect(bolhas).toEqual([
      "¡Hola! Soy Mia, de Pedilo 😊",
      "Te cuento del Pico de alta presión: usa la presión de tu canilla para un chorro fuerte.",
      "Sale ₲135.000, con envío gratis y pagás cuando te llega. ¿Te lo reservo?",
    ]);
  });

  it("o turno usa esta instrução, e não um texto próprio", () => {
    const turno = readFileSync("lib/agent-engine/agent/inbound-turn.ts", "utf8");
    expect(turno).toMatch(/instrucaoDeBolhas\(agentConfig\?\.splitMessages/);
    expect(turno).not.toMatch(/Prefira várias mensagens curtas/);
  });
});
