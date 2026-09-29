import { describe, expect, it } from "vitest";

import { botoesDoModelo, CHAVE_DOS_BOTOES_DO_MODELO, lerBotoesDoModelo } from "./botoes-do-modelo";

describe("os botões de um modelo", () => {
  it("lê os textos do componente BUTTONS, na ordem, em maiúscula ou minúscula", () => {
    const maiuscula = [
      { type: "BODY", text: "Hola" },
      { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Sí" }, { type: "URL", text: "Ver pedido", url: "https://x" }] },
    ];
    expect(botoesDoModelo(maiuscula)).toEqual(["Sí", "Ver pedido"]);
    const minuscula = [{ type: "buttons", buttons: [{ type: "quick_reply", text: " No " }] }];
    expect(botoesDoModelo(minuscula)).toEqual(["No"]);
  });

  it("sem BUTTONS, forma estranha ou texto vazio: nada", () => {
    expect(botoesDoModelo([{ type: "BODY", text: "Hola" }])).toEqual([]);
    expect(botoesDoModelo(null)).toEqual([]);
    expect(botoesDoModelo([{ type: "BUTTONS", buttons: "x" }])).toEqual([]);
    expect(botoesDoModelo([{ type: "BUTTONS", buttons: [{ text: "" }, null, { text: 3 }] }])).toEqual([]);
  });

  it("a mensagem guarda na chave combinada, e a leitura nunca lança", () => {
    expect(CHAVE_DOS_BOTOES_DO_MODELO).toBe("template_buttons");
    expect(lerBotoesDoModelo({ template_buttons: ["A", "B"] })).toEqual(["A", "B"]);
    expect(lerBotoesDoModelo({ template_buttons: "A" })).toEqual([]);
    expect(lerBotoesDoModelo(null)).toEqual([]);
    expect(lerBotoesDoModelo({ template_buttons: Array.from({ length: 12 }, (_, i) => `b${i}`) })).toHaveLength(10);
  });
});
