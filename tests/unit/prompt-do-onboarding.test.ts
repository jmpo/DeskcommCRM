/**
 * O prompt do primeiro agente no idioma da EMPRESA, e sem o ponto duplo do QA
 * de 26/10/2026 ("…ropa fitness.. Habla…").
 */
import { describe, expect, it } from "vitest";

import {
  ondeTrabalha,
  palavrasDePassagemDoIdioma,
  promptDoOnboarding,
} from "@/lib/ai/agents/prompt-do-onboarding";
import { PROMPT_TEMPLATES } from "@/lib/schemas/onboarding";

describe("promptDoOnboarding", () => {
  it("⭐ empresa em espanhol recebe o prompt em espanhol, nos três jeitos de falar", () => {
    for (const modelo of PROMPT_TEMPLATES) {
      const p = promptDoOnboarding(modelo, "Ferretería Central", "venta de herramientas", "es");
      expect(p).toMatch(
        /^Atiendes a los clientes de Ferretería Central, que es: venta de herramientas\./,
      );
      expect(p).not.toMatch(/Você|atende os clientes/);
    }
  });

  it("empresa em português: o texto de sempre", () => {
    expect(promptDoOnboarding("ecommerce_friendly", "Loja", undefined, "pt-BR")).toMatch(
      /^Você atende os clientes de Loja\. Fale de forma calorosa/,
    );
  });

  it("⭐ a pontuação final do ramo não vira ponto duplo", () => {
    expect(ondeTrabalha("Loja", "venda de roupa fitness.", "pt-BR")).toBe(
      "Loja, que é: venda de roupa fitness",
    );
    const p = promptDoOnboarding("ecommerce_professional", "Loja", "venda de roupa!!  ", "pt-BR");
    expect(p).not.toMatch(/\.\./);
    expect(p).not.toMatch(/!\./);
  });

  it("sem ramo, sem a frase do ramo (e não uma inventada)", () => {
    expect(ondeTrabalha("Loja", "   ", "es")).toBe("Loja");
  });

  it("palavras de passagem: espanhol ganha as suas; português fica no default da coluna", () => {
    expect(palavrasDePassagemDoIdioma("es")).toContain("hablar con una persona");
    expect(palavrasDePassagemDoIdioma("pt-BR")).toBeNull();
  });
});
