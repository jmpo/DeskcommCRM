import { describe, it, expect } from "vitest";
import { evaluateConditions, resolveField } from "@/lib/automation/conditions";

const ctx = {
  event: { to_stage_id: "s2", added_tags: ["vip", "novo"] },
  lead: { title: "Ana", custom_fields: { utm_source: "instagram" }, value_cents: 5000 },
};

describe("resolveField", () => {
  it("path aninhado", () => expect(resolveField(ctx, "lead.custom_fields.utm_source")).toBe("instagram"));
  it("path ausente → undefined", () => expect(resolveField(ctx, "lead.nope.x")).toBeUndefined());
});

describe("evaluateConditions", () => {
  it("lista vazia → true (regra sem condição dispara sempre)", () =>
    expect(evaluateConditions([], ctx)).toBe(true));
  it("eq string", () =>
    expect(evaluateConditions([{ field: "event.to_stage_id", op: "eq", value: "s2" }], ctx)).toBe(true));
  it("eq com coerção numérica (valor sempre chega como string da UI)", () =>
    expect(evaluateConditions([{ field: "lead.value_cents", op: "eq", value: "5000" }], ctx)).toBe(true));
  it("neq", () =>
    expect(evaluateConditions([{ field: "event.to_stage_id", op: "neq", value: "s1" }], ctx)).toBe(true));
  it("contains em array", () =>
    expect(evaluateConditions([{ field: "event.added_tags", op: "contains", value: "vip" }], ctx)).toBe(true));
  it("contains em string (case-insensitive)", () =>
    expect(evaluateConditions([{ field: "lead.custom_fields.utm_source", op: "contains", value: "INSTA" }], ctx)).toBe(true));

  /**
   * #956: em lista, `contains` exigia a tag IDÊNTICA, com caixa. Quem escreve a
   * regra digita "Google"; a tag guardada é `google` (o editor de tags do
   * contato no Inbox grava em minúsculas) ou `google ads`. O rótulo na tela é
   * "contém" — e em texto ele já era "contém" sem caixa.
   */
  const comTags = (tags: string[]) => ({ event: { added_tags: tags } });
  it("contém em lista: casa a tag de caixa diferente", () =>
    expect(
      evaluateConditions([{ field: "event.added_tags", op: "contains", value: "Google" }], comTags(["google"])),
    ).toBe(true));
  // Os dois casos abaixo eram POSITIVOS na primeira versão do #957 ("pedaço da
  // tag"). O dono escolheu pertinência: a regra que o operador escreveu para
  // `Google` não passa a alcançar quem tem `Google Ads`. São o controle que
  // separa a decisão (B) da (A) — sem eles, "casa a caixa diferente" sozinho é
  // satisfeito pelas duas.
  it("contém em lista: NÃO casa pedaço de tag", () =>
    expect(
      evaluateConditions([{ field: "event.added_tags", op: "contains", value: "Google" }], comTags(["Google Ads"])),
    ).toBe(false));
  it("contém em lista: NÃO casa o texto no meio da tag", () =>
    expect(
      evaluateConditions([{ field: "event.added_tags", op: "contains", value: "google" }], comTags(["tráfego google"])),
    ).toBe(false));
  it("contém em lista: NÃO casa prefixo de outra tag", () =>
    expect(
      evaluateConditions([{ field: "event.added_tags", op: "contains", value: "vip" }], comTags(["vip ouro"])),
    ).toBe(false));
  it("contém em TEXTO continua sendo contém", () =>
    expect(
      evaluateConditions(
        [{ field: "event.event_type_name", op: "contains", value: "manutenção" }],
        { event: { event_type_name: "Manutenção preventiva" } },
      ),
    ).toBe(true));
  it("contém em lista: NÃO casa tag sem relação", () =>
    expect(
      evaluateConditions([{ field: "event.added_tags", op: "contains", value: "Google" }], comTags(["indicação", "vip"])),
    ).toBe(false));
  it("E entre múltiplas: uma falsa derruba", () =>
    expect(
      evaluateConditions(
        [
          { field: "event.to_stage_id", op: "eq", value: "s2" },
          { field: "lead.title", op: "eq", value: "Bia" },
        ],
        ctx,
      ),
    ).toBe(false));
  it("campo ausente → condição falsa, não erro", () =>
    expect(evaluateConditions([{ field: "lead.ghost", op: "eq", value: "x" }], ctx)).toBe(false));
  it("campo ausente com neq → true (ausente ≠ valor)", () =>
    expect(evaluateConditions([{ field: "lead.ghost", op: "neq", value: "x" }], ctx)).toBe(true));

  /**
   * #2973: a comparação sem caixa já existia; sem ACENTO e sem PONTUAÇÃO não.
   * O lead escreve a mesma frase com um acento a mais ou a menos e a regra não
   * dispara — sem erro e sem aviso —, e o operador passa a ler a automação como
   * aleatória. Os casos abaixo prendem a forma NOVA nos dois lados (o valor da
   * condição e o texto recebido); os controles fecham a porta para "afrouxou
   * demais" — inclusive o `eq`, que continua comparação EXATA.
   */
  const comTexto = (texto: string) => ({ event: { body_preview: texto } });

  it("contém em texto: casa com e sem acento, nos DOIS sentidos", () => {
    expect(
      evaluateConditions(
        [{ field: "event.body_preview", op: "contains", value: "anúncio" }],
        comTexto("vi o anuncio de voces"),
      ),
    ).toBe(true);
    expect(
      evaluateConditions(
        [{ field: "event.body_preview", op: "contains", value: "anuncio" }],
        comTexto("vi o anúncio de vocês"),
      ),
    ).toBe(true);
  });

  it("contém em texto: Olá casa Ola e olá!", () => {
    for (const escrito of ["Ola", "olá!", "OLÁ", "olá,"]) {
      expect(
        evaluateConditions(
          [{ field: "event.body_preview", op: "contains", value: "Olá" }],
          comTexto(`Oi, tudo bem? ${escrito}`),
        ),
        `"Olá" tinha de casar "${escrito}"`,
      ).toBe(true);
    }
  });

  it("contém em texto: o que é OUTRA coisa continua não casando", () => {
    // Sem estes dois, "ignora acento e pontuação" ficaria indistinguível de
    // "casa tudo", e o verde não provaria nada.
    expect(
      evaluateConditions(
        [{ field: "event.body_preview", op: "contains", value: "anúncio" }],
        comTexto("quero uma proposta comercial"),
      ),
    ).toBe(false);
    expect(
      evaluateConditions(
        [{ field: "event.body_preview", op: "contains", value: "olá" }],
        comTexto("bom dia, tudo certo?"),
      ),
    ).toBe(false);
  });

  it("eq continua EXATO: acento e caixa ainda decidem (só o contains dobra a grafia)", () => {
    expect(
      evaluateConditions(
        [{ field: "event.body_preview", op: "eq", value: "anúncio" }],
        comTexto("anuncio"),
      ),
    ).toBe(false);
    expect(
      evaluateConditions(
        [{ field: "event.body_preview", op: "eq", value: "anuncio" }],
        comTexto("Anuncio"),
      ),
    ).toBe(false);
    expect(
      evaluateConditions(
        [{ field: "event.body_preview", op: "eq", value: "anuncio" }],
        comTexto("anuncio"),
      ),
    ).toBe(true);
  });

  it("contém em lista: a mesma grafia dobra, a pertinência (tag inteira) NÃO", () => {
    expect(
      evaluateConditions([{ field: "event.added_tags", op: "contains", value: "tráfego" }], comTags(["trafego"])),
    ).toBe(true);
    // #956 continua de pé: tag inteira, nunca o pedaço — nem depois de dobrar a grafia.
    expect(
      evaluateConditions([{ field: "event.added_tags", op: "contains", value: "trafego" }], comTags(["trafego pago"])),
    ).toBe(false);
  });

  /**
   * Doc 161 (16/10), opção D: a pontuação vira ESPAÇO, não some. O caso que
   * motivou a #2973 é a mensagem pronta do anúncio que o lead edita. Os casos
   * acima passam só com o acento; este é o que prende a pontuação.
   */
  it("contém em texto: a mensagem do anúncio casa mesmo sem a pontuação", () => {
    for (const recebido of ["ola vi o anuncio", "ola, vi o anuncio", "Olá!! Vi o anúncio."]) {
      expect(
        evaluateConditions(
          [{ field: "event.body_preview", op: "contains", value: "Olá! vi o anúncio" }],
          comTexto(recebido),
        ),
        `"Olá! vi o anúncio" tinha de casar "${recebido}"`,
      ).toBe(true);
    }
    expect(
      evaluateConditions(
        [{ field: "event.body_preview", op: "contains", value: "pré-venda" }],
        comTexto("quero entrar na pre venda"),
      ),
    ).toBe(true);
  });

  it("contém em texto: pontuação vira espaço e não junta números nem endereços", () => {
    expect(
      evaluateConditions(
        [{ field: "event.body_preview", op: "contains", value: "10,00" }],
        comTexto("o plano custa 1.000"),
      ),
    ).toBe(false);
    expect(
      evaluateConditions(
        [{ field: "event.body_preview", op: "contains", value: "@gmail.com" }],
        comTexto("meu email é fulanogmailcom"),
      ),
    ).toBe(false);
  });

  it("contém em texto: regra só de pontuação não casa toda mensagem", () => {
    // "?" normalizado fica vazio, e "contém vazio" casaria tudo: uma regra que
    // manda WhatsApp passaria a disparar para todo mundo. Ela compara como antes.
    expect(
      evaluateConditions([{ field: "event.body_preview", op: "contains", value: "?" }], comTexto("bom dia")),
    ).toBe(false);
    expect(
      evaluateConditions([{ field: "event.body_preview", op: "contains", value: "?" }], comTexto("tudo bem?")),
    ).toBe(true);
    expect(
      evaluateConditions([{ field: "event.added_tags", op: "contains", value: "!" }], comTags(["vip"])),
    ).toBe(false);
  });
});
