import { describe, expect, it } from "vitest";

import { lerPedidoDeSaida } from "@/lib/channels/pos-entrada";

/**
 * QUEM PEDIU PARA SAIR, SAI — E QUEM NÃO PEDIU, NÃO.
 *
 * ─── O defeito, medido na base do dono ──────────────────────────────────────
 *
 * A plantilla dele diz, em espanhol, "Respondé BAJA para no recibir más". O
 * detector procurava `STOP|PARAR|SAIR|UNSUBSCRIBE` — português e inglês.
 * "BAJA" nunca esteve na lista.
 *
 *   "Baja"                              14/08   bloqueado: NÃO
 *   "Doy de baja la pauta?"             12/08   bloqueado: NÃO
 *   "quiero dar de baja la suscripcion" 02/08   bloqueado: NÃO
 *
 * Três pessoas pediram, nenhuma foi atendida — e a promessa está escrita na
 * mensagem que a empresa mandou. No canal onde a plataforma pune denúncia de
 * spam.
 *
 * ─── Por que a resposta tem TRÊS valores, e não dois ───────────────────────
 *
 * Porque "Doy de baja la pauta?" é uma PERGUNTA sobre pausar o anúncio dele,
 * não um pedido para parar de receber. Um detector de dois estados erra sempre
 * um dos dois lados: ou perde o pedido real, ou cala um cliente que só
 * perguntou.
 *
 * E os dois erros não custam o mesmo. Quem pede e não é atendido reclama de
 * novo — o pedido volta. Quem é bloqueado sem pedir simplesmente PARA DE
 * RECEBER, e ninguém descobre, porque não há sintoma. Por isso o meio-termo
 * (`talvez`) não decide: abre aviso e deixa um humano ler.
 */

describe("o pedido claro bloqueia", () => {
  it("a palavra que a própria plantilla pede", () => {
    // Este é o caso que motivou tudo: a empresa PROMETEU que funcionaria.
    expect(lerPedidoDeSaida("Baja")).toBe("pediu");
    expect(lerPedidoDeSaida("BAJA")).toBe("pediu");
    expect(lerPedidoDeSaida("baja.")).toBe("pediu");
  });

  it("com uma cortesia em volta, que é como as pessoas escrevem", () => {
    expect(lerPedidoDeSaida("BAJA por favor")).toBe("pediu");
    expect(lerPedidoDeSaida("baja, gracias")).toBe("pediu");
  });

  it("as palavras que já existiam seguem valendo", () => {
    // O conserto não pode ter custado o comportamento anterior.
    expect(lerPedidoDeSaida("STOP")).toBe("pediu");
    expect(lerPedidoDeSaida("PARAR")).toBe("pediu");
    expect(lerPedidoDeSaida("unsubscribe")).toBe("pediu");
  });

  it("frases que não admitem outra leitura", () => {
    expect(lerPedidoDeSaida("quiero dar de baja la suscripcion")).toBe("pediu");
    expect(lerPedidoDeSaida("no quiero recibir más mensajes")).toBe("pediu");
    expect(lerPedidoDeSaida("por favor no me escriban más")).toBe("pediu");
    expect(lerPedidoDeSaida("não quero receber mais nada")).toBe("pediu");
  });
});

describe("a menção ambígua NÃO bloqueia — vira aviso", () => {
  it("a pergunta sobre a pauta dele", () => {
    // O caso real. Bloquear aqui tiraria as mensagens de um cliente ATIVO que
    // só perguntou sobre pausar o próprio anúncio.
    expect(lerPedidoDeSaida("Doy de baja la pauta?")).toBe("talvez");
  });

  it("a palavra no meio de uma frase que fala de outra coisa", () => {
    expect(lerPedidoDeSaida("che, la baja temporada nos mató las ventas")).toBe("talvez");
    expect(lerPedidoDeSaida("puedo cancelar el turno del martes?")).toBe("talvez");
  });
});

describe("o falso positivo que já custou caro", () => {
  it("acentuada não vira pedido — o defeito do `\\b` ASCII", () => {
    // Em JavaScript `\b` é ASCII, então "sairá" e "pararão" casavam com
    // `\bSAIR\b` e `\bPARAR\b`. Clientes bloqueados em silêncio, em português,
    // que é a língua da maioria dos usuários deste produto.
    expect(lerPedidoDeSaida("amanhã ele sairá do escritório")).toBe("nao");
    expect(lerPedidoDeSaida("pararão as obras na semana que vem")).toBe("nao");
  });

  it("palavra que só CONTÉM o termo não conta", () => {
    expect(lerPedidoDeSaida("necesito rebajar el precio")).toBe("nao");
    expect(lerPedidoDeSaida("trabajamos con separar los lotes")).toBe("nao");
  });

  it("mensagem vazia ou ausente não decide nada", () => {
    expect(lerPedidoDeSaida(null)).toBe("nao");
    expect(lerPedidoDeSaida("   ")).toBe("nao");
  });
});
