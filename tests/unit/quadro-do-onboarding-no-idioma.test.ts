/**
 * "Onde ele organiza" no idioma da empresa (QA de 26/10/2026: uma ferretería de
 * Assunção escolheu "Loja" e recebeu "Novo contato", "Vai levar", "Pedido pago").
 */
import { describe, expect, it } from "vitest";

import {
  PACOTES,
  nomeTemEspanhol,
  nomesDosPacotes,
  propostaNoIdioma,
} from "@/lib/onboarding/pacotes-de-funil";
import {
  escolherPacotePorTexto,
  pedidoDeSugestao,
  sugerirFunil,
} from "@/lib/onboarding/sugerir-funil";

describe("os quadros prontos em espanhol", () => {
  it("⭐ todo nome de quadro e de coluna tem espanhol — nenhum cai no português calado", () => {
    const sem = nomesDosPacotes().filter((n) => !nomeTemEspanhol(n));
    expect(sem).toEqual([]);
  });

  it("propostaNoIdioma traduz nomes e PRESERVA o passo de cada coluna", () => {
    const loja = PACOTES.find((p) => p.id === "loja")!;
    const es = propostaNoIdioma(loja.proposta, "es");
    expect(es.nome).toBe("Ventas");
    expect(es.etapas.map((e) => e.nome)).toContain("Lo va a llevar");
    expect(es.etapas.map((e) => e.passo)).toEqual(loja.proposta.etapas.map((e) => e.passo));
    // Português: a própria chave.
    expect(propostaNoIdioma(loja.proposta, "pt-BR")).toEqual(loja.proposta);
  });
});

describe("a escolha do quadro pelo que a pessoa escreveu", () => {
  it.each([
    ["Ferretería Central — venta de herramientas", "loja"],
    ["Tienda de ropa", "loja"],
    ["Inmobiliaria del Este", "imobiliaria"],
    ["Peluquería y barbería", "clinica"],
    ["Estudio de abogados", "servicos"],
    ["Clases de inglés", "curso"],
  ])("%s → %s", (texto, pacote) => {
    expect(escolherPacotePorTexto(texto).id).toBe(pacote);
  });
});

describe("o pedido de sugestão à IA", () => {
  it("⭐ em espanhol, o pedido inteiro e o exemplo vêm em espanhol", () => {
    const loja = PACOTES.find((p) => p.id === "loja")!;
    const { system, prompt } = pedidoDeSugestao(
      { nome: "Ferretería", oQueFaz: "herramientas" },
      loja,
      "es",
    );
    expect(system).toMatch(/Escribe en español/);
    expect(prompt).toContain("Lo va a llevar");
    expect(prompt).not.toContain("Vai levar");
    expect(system).not.toMatch(/negócio brasileiro/);
  });

  it("em português, o pedido de sempre", () => {
    const loja = PACOTES.find((p) => p.id === "loja")!;
    expect(pedidoDeSugestao({ nome: "Loja", oQueFaz: "roupas" }, loja).system).toMatch(
      /negócio brasileiro/,
    );
  });

  it("sugerirFunil repassa o idioma ao pedido", async () => {
    let pedido = "";
    await sugerirFunil(
      { nome: "Ferretería", oQueFaz: "herramientas" },
      async ({ system }) => {
        pedido = system;
        return "não é json";
      },
      "es",
    );
    expect(pedido).toMatch(/español/);
  });
});
