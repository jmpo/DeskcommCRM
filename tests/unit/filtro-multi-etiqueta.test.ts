/**
 * O FILTRO POR VÁRIAS ETIQUETAS — E/OU NAS TRÊS LISTAS, SEM QUEBRAR O `?tag=` (#1274)
 *
 * ─── O que este arquivo afirma, e por que cada afirmação é diferente ───────
 *
 * A feature é pequena e o defeito possível é silencioso. Um filtro que não
 * filtra devolve uma lista *plausível*: o operador lê "nenhuma conversa" ou
 * "quase todas" e não tem como saber que a escolha dele foi ignorada. Por isso
 * nada aqui é testado pelo resultado visível na tela, e sim pelo TEXTO que sai
 * para o PostgREST — é o único lugar onde E e OU são distinguíveis sem banco.
 *
 * Os cinco blocos:
 *
 * 1. **A régua** (E/OU, o caso de uma etiqueta, o controle negativo de vazio).
 * 2. **O schema e a rota** (a repetição na URL sobrevive até o handler).
 * 3. **A não-regressão do `?tag=` singular**, byte a byte.
 * 4. **O funil**, que filtra no cliente e por isso não tem `cs`/`ov` para
 *    delegar — a semântica é reimplementada e precisa bater.
 * 5. **O handler**, que é quem monta o texto que vai ao PostgREST: a expressão
 *    do E e a do OU, nas DUAS rotas que filtram no servidor (conversas e
 *    contatos).
 *
 * ─── A semântica, e por que ela é a que é ──────────────────────────────────
 *
 * - **E** = a caixa tem TODAS as escolhidas (`cs` com a lista inteira). As DUAS
 *   caixas (conversa e contato) continuam em OU, que é a régua que a migration
 *   0323 fixou.
 * - **OU** = qualquer uma das escolhidas, em qualquer das duas caixas (`ov`).
 *
 * "vip na conversa E orçamento no contato" (misturando caixas) NÃO é aceito, e
 * é decisão de produto registrada na issue — não um furo. O caso está escrito
 * aqui para que ninguém o "conserte" achando que é bug.
 */
import { describe, expect, it } from "vitest";

import { listContactsHandler } from "@/app/api/v1/contacts/_handler";
import { listConversationsHandler } from "@/app/api/v1/conversations/_handler";
import {
  aplicarMarcador,
  aplicarMarcadores,
  arrayDeUmValorParaOr,
  listaDeValoresParaOr,
  marcadoresEscolhidos,
  modoDeEtiqueta,
  predicadoDeVariasEtiquetas,
} from "@/lib/inbox/marcador-da-conversa";
import { listConversationsQuerySchema } from "@/lib/schemas";
import { applyFilters, filtersFromParams, filtersToParams, marcadoresDoFiltro } from "@/lib/kanban/filters";
import type { Lead } from "@/lib/types/leads";

/** Uma consulta que registra os `or=` aplicados, como o builder do supabase-js. */
function consultaQueRegistra() {
  const ors: string[] = [];
  const consulta = {
    or: (filtro: string) => {
      ors.push(filtro);
      return consulta;
    },
  };
  return { consulta, ors };
}

/** Os `or=` que a régua emite para esta lista de marcadores e este modo. */
const orsDe = (marcadores: string[], modo?: "e" | "ou"): string[] => {
  const reg = consultaQueRegistra();
  aplicarMarcadores(reg.consulta, marcadores, modo);
  return reg.ors;
};

// ══════════════════════════════════════════════════════ 1. A RÉGUA

describe("a régua do filtro por várias etiquetas", () => {
  it("E com DUAS etiquetas: `cs` com a LISTA nas DUAS caixas", () => {
    // O `cs` de um valor só cada seria OU ("vip OU orçamento"); a lista inteira
    // num literal só é o "contém todos" que o E pede.
    expect(predicadoDeVariasEtiquetas(["vip", "orcamento"], "e")).toBe(
      'tags.cs."{\\"vip\\",\\"orcamento\\"}",tags_do_contato.cs."{\\"vip\\",\\"orcamento\\"}"',
    );
  });

  it("OU com DUAS etiquetas: `ov` (tem ALGUMA) nas DUAS caixas", () => {
    // Aqui `cs` seria o E de novo com outro nome — e o nome mente. O `ov` é o
    // "tem ALGUMA", que é o que OU pede.
    expect(predicadoDeVariasEtiquetas(["vip", "orcamento"], "ou")).toBe(
      'tags.ov."{\\"vip\\",\\"orcamento\\"}",tags_do_contato.ov."{\\"vip\\",\\"orcamento\\"}"',
    );
  });

  it("cada elemento da lista vai entre ASPAS — sem elas seria um marcador só", () => {
    // `{vip,orcamento}` é um literal de UM elemento cujo nome é "vip,orcamento".
    // O filtro casaria conversas com uma etiqueta chamada assim, que ninguém
    // escreveu, e a lista de duas jamais casaria nada. Esta é a diferença entre
    // uma lista e uma palavra, e ela é um caractere só.
    const valor = listaDeValoresParaOr(["vip", "orcamento"]);
    // O que o PostgREST desescapifica é o literal `{"vip","orcamento"}`.
    expect(valor.replace(/\\\\/g, "")).toBe('"{\\"vip\\",\\"orcamento\\"}"');
  });

  it("a lista de UM é byte a byte o valor único — é o que segura o `?tag=` antigo", () => {
    // Sem este caso, a forma de um item teria aspas internas diferentes da
    // singular, e o `?tag=vip` casaria um literal diferente do de sempre — lista
    // quase inteira, sem erro.
    expect(listaDeValoresParaOr(["vip"])).toBe(arrayDeUmValorParaOr("vip"));
  });

  it("E e OU com as MESMAS etiquetas só diferem no OPERADOR — e é o que se espera", () => {
    const e = predicadoDeVariasEtiquetas(["vip", "orcamento"], "e");
    const ou = predicadoDeVariasEtiquetas(["vip", "orcamento"], "ou");
    expect(e).not.toBe(ou);
    // As DUAS caixas continuam em OU nos dois modos: é a régua da 0323, e perdê-la
    // em um dos modos faria o filtro de etiqueta do contato desaparecer.
    for (const predicado of [e, ou]) {
      expect(predicado).toContain("tags.");
      expect(predicado).toContain("tags_do_contato.");
    }
    expect(e.startsWith("tags.cs.")).toBe(true);
    expect(ou.startsWith("tags.ov.")).toBe(true);
  });

  it("modo `e` é o PADRÃO: sem dizer nada, o filtro é o de sempre", () => {
    expect(predicadoDeVariasEtiquetas(["vip", "orcamento"])).toBe(
      predicadoDeVariasEtiquetas(["vip", "orcamento"], "e"),
    );
  });

  it("CONTROLE NEGATIVO: lista vazia, ou só vazios/repetidos, não filtra NADA", () => {
    // Sem este caso, uma implementação que sempre emitisse um `or=` passaria nos
    // de cima e a contagem/lista passaria a MENTIR para baixo: em vez de devolver
    // tudo (o que "sem filtro" significa), devolveria nada — e a tela pintaria
    // "nenhuma conversa" com o filtro desligado.
    expect(orsDe([])).toEqual([]);
    expect(orsDe(["", "   "])).toEqual([]);
    // ⚠️ Repetido NAO e lista vazia: `["vip","vip","vip"]` reduz a UMA
    // etiqueta, e uma etiqueta e o filtro de sempre — nao `[]`. O que se fixa
    // aqui e que nao ha `or=` para uma lista que nao sobrou nada, e o caso de
    // uma so ja esta coberto pela comparacao byte a byte do singular.
    expect(orsDe(["vip", "vip", "vip"])).toEqual(orsDe(["vip"]));
    expect(marcadoresEscolhidos([undefined, null, "  "])).toEqual([]);
    // E o predicado puro também devolve vazio — ninguém deve conseguir escrever
    // `or=()` com ele.
    expect(predicadoDeVariasEtiquetas([], "e")).toBe("");
    expect(predicadoDeVariasEtiquetas([], "ou")).toBe("");
  });

  it("a lista escolhida sai sem vazio, sem repetido, na ordem da primeira aparição", () => {
    // ⚠️ O que esta função NÃO faz: mexer na CAIXA. `VIP` e `vip` são dois
    // marcadores diferentes para ela, e é a normalização do schema
    // (`conversationTagSchema`, minúsculo) que os junta antes. Se esta função
    // também normalizasse, teríamos DUAS regras de caixa no mesmo caminho, e a
    // segunda sempre diverge da primeira — que é o defeito que o arquivo de
    // regra existe para evitar.
    expect(marcadoresEscolhidos(["vip", "", "  ", "orcamento", "vip", " VIP "])).toEqual([
      "vip",
      "orcamento",
      "VIP",
    ]);
  });

  it("`modo` fora dos dois não vira modo: fica indefinido, e quem chamou decide", () => {
    expect(modoDeEtiqueta("e")).toBe("e");
    expect(modoDeEtiqueta("ou")).toBe("ou");
    expect(modoDeEtiqueta("xou")).toBeUndefined();
    expect(modoDeEtiqueta(null)).toBeUndefined();
    expect(modoDeEtiqueta(undefined)).toBeUndefined();
  });

  it("marcador com vírgula, chave e aspas chega inteiro nos DOIS modos", () => {
    // O mesmo cuidado do valor único (`inbox-filtro-de-tag-le-as-duas-caixas`),
    // estendido à lista: o `,` DENTRO do nome de um marcador não pode ter virado
    // o separador da lista, e é por isso que o escape é por item.
    const marcador = 'a,b{c}"d\\e';
    const valor = listaDeValoresParaOr([marcador, "outra"]);
    // Um ESCAPE por caractere perigoso e, por baixo, DOIS elementos: a vírgula do
    // nome continua dentro do elemento, e a que separa os dois fica solta.
    expect(valor).toBe('"{\\"a,b{c}\\\\\\"d\\\\\\\\e\\",\\"outra\\"}"');
    // E o predicado dos dois modos carrega a mesma coisa — nenhum dos dois
    // pode perder o marcador por causa de caractere especial.
    for (const modo of ["e", "ou"] as const) {
      expect(predicadoDeVariasEtiquetas([marcador, "outra"], modo)).toContain(valor);
    }
  });
});

// ══════════════════════════════════════════════════════ 3. A NÃO-REGRESSÃO DO SINGULAR

describe("o `?tag=` singular continua byte a byte o de antes", () => {
  it("UMA etiqueta pelo caminho plural é IDÊNTICA ao caminho singular", () => {
    // Este é o teste que impede a regressão SILENCIOSA: um `cs` de lista de um
    // item e o `cs` de valor único casam a mesma conversa, então trocar a forma
    // não quebraria a lista — só a deixaria de filtrar, e nenhum teste de
    // contagem notaria.
    const singular = consultaQueRegistra();
    aplicarMarcador(singular.consulta, "vip");
    const plural = consultaQueRegistra();
    aplicarMarcadores(plural.consulta, ["vip"]);
    expect(plural.ors).toEqual(singular.ors);
    // O literal é escrito a partir da PRÓPRIA função singular, e não copiado à
    // mão: um literal escrito à mão diverge da regra no primeiro ajuste de escape
    // que ela ganhe, e o teste passa a proteger a cópia, não o comportamento.
    const valor = arrayDeUmValorParaOr("vip");
    expect(plural.ors).toEqual([
      `tags.cs.${valor},tags_do_contato.cs.${valor}`,
    ]);
  });

  it("o modo não muda NADA com uma etiqueta só — nem E nem OU", () => {
    // `?tag=vip&modo=ou` é um link que o produto aceita, e ele tem de filtrar
    // como `?tag=vip`. Se o modo alterasse o caso de um item, a mesma
    // configuração teria dois resultados, e o operador não teria como saber qual.
    for (const modo of ["e", "ou"] as const) {
      expect(orsDe(["vip"], modo)).toEqual(
        orsDe(["vip"]),
      );
    }
  });
});

// ══════════════════════════════════════════════════════ 2. O SCHEMA E A ROTA

describe("a query string leva as várias etiquetas até o schema", () => {
  const spDe = (q: string) => new URLSearchParams(q);

  it("a repetição na URL vira LISTA no schema", () => {
    const r = listConversationsQuerySchema.parse({
      tag: spDe("?tag=vip&tag=orçamento").getAll("tag"),
    });
    expect(r.tag).toEqual(["vip", "orçamento"]);
  });

  it("`?tag=vip` (um só) continua sendo ACEITO, e vira lista de um", () => {
    const r = listConversationsQuerySchema.parse({
      tag: spDe("?tag=vip").getAll("tag"),
    });
    expect(r.tag).toEqual(["vip"]);
  });

  it("a forma ANTIGA (string, não array) também passa — a API chama com as duas", () => {
    // `get` devolve string; `getAll` devolve array. Se o schema só aceitasse uma,
    // a outra chamada quebraria com 422 — e a quebra seria num link salvo.
    expect(listConversationsQuerySchema.parse({ tag: "vip" }).tag).toEqual(["vip"]);
    expect(listConversationsQuerySchema.parse({}).tag).toBeUndefined();
  });

  it("o marcador é normalizado item a item (`?tag=VIP` acha o que gravou `vip`)", () => {
    const r = listConversationsQuerySchema.parse({ tag: ["  VIP ", "Orçamento"] });
    expect(r.tag).toEqual(["vip", "orçamento"]);
  });

  it("`modo` fora dos dois é RECUSADO (422) — quem chama precisa corrigir", () => {
    const r = listConversationsQuerySchema.safeParse({ tag: ["vip"], modo: "xou" });
    expect(r.success).toBe(false);
    // E o valor válido passa.
    expect(listConversationsQuerySchema.safeParse({ tag: ["vip"], modo: "ou" }).success).toBe(true);
  });

  it("CONTROLE: mais etiquetas que o teto é recusado, e não descartado em silêncio", () => {
    const muitas = Array.from({ length: 21 }, (_, i) => `t${i}`);
    expect(listConversationsQuerySchema.safeParse({ tag: muitas }).success).toBe(false);
    // Descartar as que passassem do teto daria uma lista MENOR sem dizer por quê —
    // e uma lista curta parece resposta.
    expect(listConversationsQuerySchema.safeParse({ tag: muitas.slice(0, 20) }).success).toBe(true);
  });
});

// ══════════════════════════════════════════════════════ 4. O FUNIL (filtro no cliente)

const lead = (id: string, tags: Partial<Lead> = {}): Lead =>
  ({
    id,
    title: `lead ${id}`,
    status: "open",
    owner_user_id: "u1",
    owner_agent_id: null,
    tags: [],
    conversation_tags: [],
    contact_tags: [],
    ...tags,
  }) as Lead;

describe("o funil: E e OU dão listas DIFERENTES", () => {
  const ambos = lead("a", { tags: ["vip", "orcamento"] });
  const soVip = lead("b", { tags: ["vip"] });
  const soOrcamento = lead("c", { tags: ["orcamento"] });
  const nenhum = lead("d", { tags: ["retorno"] });
  const leia = [ambos, soVip, soOrcamento, nenhum];

  it("E devolve só quem tem as DUAS", () => {
    const out = applyFilters(leia, { tag: ["vip", "orcamento"], tagMode: "e" });
    expect(out.map((l) => l.id)).toEqual(["a"]);
  });

  it("OU devolve quem tem QUALQUER uma — e a lista CRESCE", () => {
    const out = applyFilters(leia, { tag: ["vip", "orcamento"], tagMode: "ou" });
    expect(out.map((l) => l.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("CONTROLE: a diferença entre E e OU é o TAMANHO, e ninguém confunde as duas", () => {
    // Sem isto, o `tagMode` poderia ser lido e simplesmente ignorado, e os dois
    // modos devolveriam a mesma lista — o filtro "funcionaria" e não filtraria.
    const emE = applyFilters(leia, { tag: ["vip", "orcamento"], tagMode: "e" });
    const emOu = applyFilters(leia, { tag: ["vip", "orcamento"], tagMode: "ou" });
    expect(emE).toHaveLength(1);
    expect(emOu.length).toBeGreaterThan(emE.length);
  });

  it("E é o PADRÃO: sem `tagMode`, o filtro é o de E", () => {
    expect(applyFilters(leia, { tag: ["vip", "orcamento"] }).map((l) => l.id)).toEqual(["a"]);
  });

  it("o funil casa as TRÊS caixas do card (negócio, contato e conversa)", () => {
    const porContato = lead("e", { contact_tags: ["vip", "orcamento"] });
    const porConversa = lead("f", { conversation_tags: ["vip", "orcamento"] });
    expect(applyFilters([porContato, porConversa], { tag: ["vip", "orcamento"] })).toHaveLength(2);
  });

  it("uma etiqueta SÓ no funil continua filtrando como antes", () => {
    // A não-regressão do funil: `tag: "vip"` (string) tem de virar lista de um
    // e casar igual a `tag: ["vip"]`.
    expect(applyFilters(leia, { tag: "vip" }).map((l) => l.id).sort()).toEqual(["a", "b"]);
    expect(applyFilters(leia, { tag: "vip" })).toEqual(applyFilters(leia, { tag: ["vip"] }));
  });

  it("CONTROLE NEGATIVO: sem etiquetas escolhidas, o funil não filtra por etiqueta", () => {
    // Um `every` sobre lista vazia é `true` (vacuoso) e um `some` sobre lista
    // vazia é `false` (nada casa). O primeiro é o que o "sem filtro" quer; o
    // segundo esconderia o quadro inteiro. Aqui se fixa que lista vazia NÃO
    // filha nada.
    expect(applyFilters(leia, {})).toHaveLength(4);
    expect(applyFilters(leia, { tag: [] })).toHaveLength(4);
    expect(applyFilters(leia, { tag: [], tagMode: "ou" })).toHaveLength(4);
  });

  it("E do funil NÃO aceita mistura de caixas — é o caso que a issue deixa pendente", () => {
    // O E do servidor é `tags.cs.{a,b}` OU `tags_do_contato.cs.{a,b}`: as duas
    // etiquetas DENTRO de uma caixa. "vip na conversa E orçamento no negócio" é a
    // mistura que a #1274 registra como decisão de produto e que o servidor não
    // expressa — aceitar no funil e recusar no servidor faria o MESMO filtro
    // devolver listas diferentes nas duas telas, sem erro em nenhuma.
    const misturado = lead("g", { tags: ["vip"], contact_tags: ["orcamento"] });
    expect(applyFilters([misturado], { tag: ["vip", "orcamento"], tagMode: "e" })).toHaveLength(0);
    // No OU a mesma mistura passa: é "qualquer uma em qualquer caixa".
    expect(applyFilters([misturado], { tag: ["vip", "orcamento"], tagMode: "ou" })).toHaveLength(1);
    // E as DUAS na mesma caixa passam no E — em QUALQUER uma das três.
    const naConversa = lead("h", { conversation_tags: ["vip", "orcamento"] });
    const noNegocio = lead("i", { tags: ["vip", "orcamento"] });
    expect(applyFilters([naConversa, noNegocio], { tag: ["vip", "orcamento"], tagMode: "e" })).toHaveLength(2);
  });

  it("uma etiqueta só no funil não muda de sentido por causa da mesma-caixa", () => {
    // Com um item só, "todas na mesma caixa" é sinônimo de "está em alguma
    // caixa": o filtro de sempre continua filtrando o de sempre.
    const emCaixasDiferentes = lead("j", { tags: ["vip"], conversation_tags: ["vip"] });
    expect(applyFilters([emCaixasDiferentes], { tag: "vip" })).toHaveLength(1);
  });
});

describe("o deep-link do funil leva as várias etiquetas e volta", () => {
  it("ida e volta: `?tag=vip&tag=orçamento&modo=ou` sobrevive ao F5", () => {
    const params = filtersToParams({ tag: ["vip", "orçamento"], tagMode: "ou" });
    const sp = new URLSearchParams(params);
    // A URL precisa Trazer as DUAS: com `set`, a segunda substituiria a primeira.
    expect(sp.getAll("tag")).toEqual(["vip", "orçamento"]);
    expect(sp.get("modo")).toBe("ou");
    const lido = filtersFromParams(sp);
    expect(marcadoresDoFiltro(lido.tag)).toEqual(["vip", "orçamento"]);
    expect(lido.tagMode).toBe("ou");
  });

  it("`?tag=vip` de hoje não ganha `&modo=e` colado — o link é o mesmo de sempre", () => {
    const params = filtersToParams({ tag: "vip" });
    expect(params).toBe("tag=vip");
    // E a leitura devolve a mesma coisa que a de sempre.
    expect(marcadoresDoFiltro(filtersFromParams(new URLSearchParams(params)).tag)).toEqual(["vip"]);
  });

  it("um `modo` inválido no link vira E, e não erro — o link é deep-link, não API", () => {
    const lido = filtersFromParams(new URLSearchParams("tag=vip&tag=x&modo=xou"));
    expect(lido.tagMode).toBeUndefined();
    expect(marcadoresDoFiltro(lido.tag)).toEqual(["vip", "x"]);
  });
});

// ══════════════════════════════════════════════════════ 5. O HANDLER

/**
 * Um builder do supabase que registra cada chamada — o mesmo desenho de
 * `inbox-filtro-de-tag-le-as-duas-caixas`, porque quem filtra no servidor só
 * revela a semântica pelo TEXTO que manda ao PostgREST.
 */
function supabaseQueRegistra() {
  const chamadas: { metodo: string; args: unknown[] }[] = [];
  const proxy: Record<string, unknown> = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") {
          return (ok: (v: unknown) => unknown) => ok({ data: [], error: null });
        }
        return (...args: unknown[]) => {
          chamadas.push({ metodo: String(prop), args });
          return proxy;
        };
      },
    },
  ) as Record<string, unknown>;
  return { client: { from: () => proxy } as never, chamadas };
}

const ctxDoHandler = {
  organization_id: "11111111-1111-4111-8111-111111111111",
  requestId: "req-1274",
  actor: { type: "user" as const, id: "user-1" },
} as never;

/** Os `or=` que a consulta emitiu, na ordem em que saíram. */
const orsDaConsulta = (chamadas: { metodo: string; args: unknown[] }[]): string[] =>
  chamadas.filter((c) => c.metodo === "or").map((c) => String(c.args[0]));

/**
 * Os textos EXATOS que as duas rotas têm de mandar. Estão escritos à mão de
 * propósito: derivá-los de `predicadoDeVariasEtiquetas` protegeria a função
 * contra si mesma, e é justamente a função que a sabotagem troca.
 */
const OR_DE_E = String.raw`tags.cs."{\"vip\",\"orcamento\"}",tags_do_contato.cs."{\"vip\",\"orcamento\"}"`;
const OR_DE_OU = String.raw`tags.ov."{\"vip\",\"orcamento\"}",tags_do_contato.ov."{\"vip\",\"orcamento\"}"`;
const OR_SINGULAR = String.raw`tags.cs."{\"vip\"}",tags_do_contato.cs."{\"vip\"}"`;
const OR_DE_CONTATOS_E = String.raw`tags.ov."{\"vip\"}",tags.ov."{\"orcamento\"}"`;

describe("o handler monta a expressão certa, nos DOIS modos", () => {
  it("conversas, modo E: um `or=` só, com `cs` e as DUAS etiquetas num literal", async () => {
    const { client, chamadas } = supabaseQueRegistra();
    await listConversationsHandler(client, ctxDoHandler, {
      limit: 50,
      tag: ["vip", "orcamento"],
      modo: "e",
    } as never);
    expect(orsDaConsulta(chamadas)).toEqual([OR_DE_E]);
  });

  it("conversas, modo OU: o MESMO literal com o operador `ov`", async () => {
    const { client, chamadas } = supabaseQueRegistra();
    await listConversationsHandler(client, ctxDoHandler, {
      limit: 50,
      tag: ["vip", "orcamento"],
      modo: "ou",
    } as never);
    expect(orsDaConsulta(chamadas)).toEqual([OR_DE_OU]);
    // O E e o OU diferem num caractere — e é o caractere certo.
    expect(orsDaConsulta(chamadas)).not.toEqual([OR_DE_E]);
  });

  it("conversas, uma etiqueta só: continua o `or=` singular de sempre", async () => {
    const { client, chamadas } = supabaseQueRegistra();
    await listConversationsHandler(client, ctxDoHandler, {
      limit: 50,
      tag: ["vip"],
      modo: "ou",
    } as never);
    expect(orsDaConsulta(chamadas)).toEqual([OR_SINGULAR]);
  });

  it("contatos, modo E: `contains` com a LISTA — um parâmetro só, sem `or=`", async () => {
    const { client, chamadas } = supabaseQueRegistra();
    await listContactsHandler(client, ctxDoHandler, {
      limit: 25,
      tag: ["vip", "orcamento"],
      modo: "e",
    } as never);
    const contem = chamadas.filter((c) => c.metodo === "contains" && c.args[0] === "tags");
    expect(contem.map((c) => c.args[1])).toEqual([["vip", "orcamento"]]);
    // Um `or=` com `tags.ov` aqui seria o OU com o nome do E.
    expect(orsDaConsulta(chamadas)).not.toContain(OR_DE_CONTATOS_E);
  });

  it("contatos, modo OU: um `or=` com um `ov` por etiqueta", async () => {
    const { client, chamadas } = supabaseQueRegistra();
    await listContactsHandler(client, ctxDoHandler, {
      limit: 25,
      tag: ["vip", "orcamento"],
      modo: "ou",
    } as never);
    expect(orsDaConsulta(chamadas)).toEqual([OR_DE_CONTATOS_E]);
    // O `contains` (E) não pode ter saído junto: repetir `contains` no
    // PostgREST é E de novo, com o nome de OU.
    const contem = chamadas.filter((c) => c.metodo === "contains" && c.args[0] === "tags");
    expect(contem).toEqual([]);
  });

  it("contatos, uma etiqueta só: `contains` com lista de um, byte a byte o de antes", async () => {
    const { client, chamadas } = supabaseQueRegistra();
    await listContactsHandler(client, ctxDoHandler, { limit: 25, tag: ["vip"] } as never);
    const contem = chamadas.filter((c) => c.metodo === "contains" && c.args[0] === "tags");
    expect(contem.map((c) => c.args[1])).toEqual([["vip"]]);
  });
});
