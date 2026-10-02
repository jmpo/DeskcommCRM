import { describe, expect, it } from "vitest";

import { modelosQueOFluxoEnvia, type LinhaDeModeloDoCanal } from "./modelos-aprovados";

function linha(id: string, status: string, texto: string): LinhaDeModeloDoCanal {
  return {
    id,
    name: `modelo_${id}`,
    language: "es",
    status,
    parameter_format: "POSITIONAL",
    components: [
      { type: "BODY", text: texto },
      { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Sí" }] },
    ],
  };
}

describe("modelos que um passo de fluxo consegue mandar sozinho", () => {
  it("⭐ só aprovado — o que o turno do fluxo depois pula não é oferecido", () => {
    const lista = modelosQueOFluxoEnvia([
      linha("a", "APPROVED", "Sale ₲125.000. ¿Te lo reservamos?"),
      linha("b", "PENDING", "ainda em análise"),
      linha("c", "APPROVED", "Hola {{1}}, ¿seguís interesado?"),
      linha("d", "REJECTED", "recusado"),
    ]);
    expect(lista.map((m) => m.id)).toEqual(["a", "c"]);
  });

  it("devolve o texto que o cliente lê, para escolher pelo conteúdo", () => {
    const [m] = modelosQueOFluxoEnvia([linha("a", "APPROVED", "Sale ₲125.000.")]);
    expect(m).toEqual({ id: "a", name: "modelo_a", language: "es", texto: "Sale ₲125.000.", variaveis: [] });
  });

  it("modelo com variável de texto entra, com as variáveis e o texto em volta de cada uma", () => {
    const [m] = modelosQueOFluxoEnvia([
      linha("c", "APPROVED", "¡Hola {{1}}! Recibimos tu pedido de {{2}} por {{3}}."),
    ]);
    expect(m?.variaveis.map((v) => [v.chave, v.marcador, v.noCabecalho])).toEqual([
      ["1", "{{1}}", false],
      ["2", "{{2}}", false],
      ["3", "{{3}}", false],
    ]);
    expect(m?.variaveis[0]?.antes).toContain("Hola");
  });

  it("variável que não é texto (imagem do cabeçalho) fica de fora: o fluxo não tem de onde tirá-la", () => {
    const lista = modelosQueOFluxoEnvia([
      {
        ...linha("e", "APPROVED", "Mirá la foto"),
        components: [
          { type: "HEADER", format: "IMAGE", example: { header_handle: ["https://x/y.jpg"] } },
          { type: "BODY", text: "Mirá la foto" },
        ],
      },
    ]);
    expect(lista).toEqual([]);
  });
});
