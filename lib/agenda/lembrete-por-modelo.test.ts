import { describe, expect, it } from "vitest";

import { corpoDoModelo, valoresDoModeloDoLembrete } from "./lembrete-por-modelo";

const pecas = { primeiro_nome: "Ana", quando: "jueves, 30/10 a las 15:00", titulo: "Demo", endereco: "" };

describe("valores do lembrete por modelo", () => {
  it("preenche por posição: nome e dia e hora", () => {
    expect(valoresDoModeloDoLembrete("Hola {{1}}, tu demo: {{2}}.", pecas)).toEqual({
      valores: { "1": "Ana", "2": "jueves, 30/10 a las 15:00" },
      texto: "Hola Ana, tu demo: jueves, 30/10 a las 15:00.",
    });
  });
  it("modelo sem variável sai como está", () => {
    expect(valoresDoModeloDoLembrete("Recordatorio de su demo.", pecas)).toEqual({
      valores: {},
      texto: "Recordatorio de su demo.",
    });
  });
  it("a mesma variável repetida usa o mesmo valor", () => {
    expect(valoresDoModeloDoLembrete("{{1}}, {{1}}!", pecas)?.texto).toBe("Ana, Ana!");
  });
  it.each([
    ["buraco na numeração", "Hola {{1}}, {{3}}"],
    ["mais variáveis do que a ordem cobre", "{{1}} {{2}} {{3}} {{4}} {{5}}"],
    ["peça vazia (a Meta recusa parâmetro vazio)", "{{1}} {{2}} {{3}} {{4}}"],
  ])("não serve: %s", (_caso, corpo) => {
    expect(valoresDoModeloDoLembrete(corpo, pecas)).toBeNull();
  });
});

describe("corpo do modelo espelhado", () => {
  it("lê o BODY entre os componentes", () => {
    expect(corpoDoModelo([{ type: "HEADER", text: "x" }, { type: "BODY", text: "Hola {{1}}" }])).toBe("Hola {{1}}");
  });
  it.each([[null], [[]], [[{ type: "BODY", text: "  " }]], ["texto"]])("sem corpo: %j", (c) => {
    expect(corpoDoModelo(c)).toBeNull();
  });
});
