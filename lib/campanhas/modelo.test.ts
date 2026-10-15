/**
 * Campanha com modelo aprovado: o mapa diz de onde sai cada variável, e a
 * preparação resolve contato a contato. Variável vazia num contato tira ESTE
 * contato da lista (`variavel_ausente`) — nunca vira "¡Hola !" no WhatsApp.
 */
import { describe, expect, it } from "vitest";

import { deriveTemplateContract } from "@/lib/channels/meta/template-contract";

import {
  camposDoNegocioUsados,
  problemasDoMapa,
  resolverValoresDaCampanha,
  textoDoModeloParaAConversa,
  variaveisDaCampanhaSchema,
} from "./modelo";

const COMPONENTES = [
  { type: "HEADER", format: "IMAGE" },
  { type: "BODY", text: "¡Hola {{1}}! Tu {{2}} a {{3}} con envío gratis." },
  { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Quiero" }] },
];
const CONTRATO = deriveTemplateContract({
  name: "oferta",
  language: "es",
  parameter_format: "POSITIONAL",
  components: COMPONENTES as never,
});
const MAPA = variaveisDaCampanhaSchema.parse({
  "header:1": { kind: "fixed", value: "https://cdn.x/pico.jpg" },
  "1": { kind: "contact_first_name" },
  "2": { kind: "lead_custom", key: "produto" },
  "3": { kind: "fixed", value: "₲125.000" },
});

describe("problemasDoMapa", () => {
  it("mapa completo: nenhum problema", () => {
    expect(problemasDoMapa(CONTRATO, MAPA)).toEqual([]);
  });

  it("variável sem origem e mídia que não é link público são recusadas ao salvar", () => {
    const { "2": _sem, ...semDois } = MAPA;
    void _sem;
    const problemas = problemasDoMapa(CONTRATO, { ...semDois, "header:1": { kind: "fixed", value: "pico.jpg" } });
    expect(problemas).toHaveLength(2);
    expect(problemas.join(" ")).toMatch(/\{\{2\}\}/);
    expect(problemas.join(" ")).toMatch(/https:\/\//);
  });

  it("mídia do cabeçalho não aceita nome do contato — contato não tem de onde tirar uma imagem", () => {
    expect(problemasDoMapa(CONTRATO, { ...MAPA, "header:1": { kind: "contact_name" } })).toHaveLength(1);
  });
});

describe("resolverValoresDaCampanha", () => {
  it("resolve cada variável para o contato: primeiro nome, campo do negócio, texto fixo e link", () => {
    const r = resolverValoresDaCampanha(CONTRATO, MAPA, {
      nomeDoContato: "María José Pérez",
      camposDoNegocio: { produto: "Pico de Alta Presión" },
    });
    expect(r).toEqual({
      ok: true,
      values: { "header:1": "https://cdn.x/pico.jpg", "1": "María", "2": "Pico de Alta Presión", "3": "₲125.000" },
    });
  });

  it("contato sem o dado sai da lista com o motivo — e telefone no lugar do nome não conta como nome", () => {
    const r = resolverValoresDaCampanha(CONTRATO, MAPA, { nomeDoContato: "+595981123456", camposDoNegocio: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problemas).toHaveLength(2);
  });
});

describe("o que a conversa guarda", () => {
  it("o texto do modelo com os valores do contato — o que o agente lê quando o cliente responde", () => {
    const texto = textoDoModeloParaAConversa(
      { name: "oferta", language: "es", parameterFormat: "POSITIONAL", components: COMPONENTES },
      { "header:1": "https://cdn.x/pico.jpg", "1": "María", "2": "Pico", "3": "₲125.000" },
    );
    expect(texto).toBe("¡Hola María! Tu Pico a ₲125.000 con envío gratis.");
  });

  it("só lê campos do negócio quando o mapa usa algum", () => {
    expect(camposDoNegocioUsados(MAPA)).toEqual(["produto"]);
    expect(camposDoNegocioUsados({ "1": { kind: "contact_name" } })).toEqual([]);
  });
});
