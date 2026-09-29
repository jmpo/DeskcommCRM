/**
 * O MARCADOR DA CONVERSA — uma régua só, para quem LISTA e para quem CONTA.
 *
 * ## Por que este arquivo existe
 *
 * O marcador mora em DUAS caixas: o marcador da CONVERSA (`conversations.tags`,
 * `text[]`, migration 0033) e o marcador do CONTATO, que a conversa enxerga pelo
 * campo calculado `tags_do_contato` (migration 0323). Quem filtra por marcador
 * tem de casar as duas.
 *
 * Enquanto a régua morava dentro de quem LISTA, quem CONTA respondeu à mesma
 * pergunta do seu jeito: pediu IGUALDADE numa coluna `tag`, que não existe em
 * `conversations` (`tag` é o nome do parâmetro da URL). O PostgREST devolvia
 * 42703 (`undefined_column`) e a rota inteira respondia 500 — com um marcador
 * filtrado, TODA aba do Inbox ficava sem número, a "Fechadas" inclusive. Medido
 * na tela: badge nenhum.
 *
 * A segunda régua sempre diverge. Por isso o predicado nasce AQUI, e quem filtra
 * — a lista (`app/api/v1/conversations/_handler.ts`) e a contagem das abas
 * (`app/api/v1/conversations/counts/route.ts`) — apenas o aplica.
 * `tests/unit/badge-espelha-o-filtro.test.ts` vigia os dois lados.
 *
 * ─── E AGORA, VÁRIAS ETIQUETAS (#1274) ─────────────────────────────────────
 *
 * A segunda metade do arquivo é o filtro por VÁRIAS etiquetas, nos dois modos
 * (E/OU). A régua continua UMA só: quem oferece a opção e quem filtra leem as
 * mesmas funções, que é a mesma razão de o arquivo existir.
 */

/**
 * `{valor}` como operando de `cs`/`ov` DENTRO de um `or=` do PostgREST.
 *
 * Duas gramáticas, uma dentro da outra: o literal de array do Postgres
 * (`{"vip"}`, com `"` e `\` escapados por barra) e, por fora, o valor entre
 * aspas do `or=` (mesmo escape). Sem as aspas de fora, marcador com `,` ou `)`
 * quebra a árvore lógica, e com `{`/`}` o PostgREST nem reconhece o array —
 * `pLogicSingleVal` só aceita `{…}` sem chave dentro. O `termoSeguroParaOr` da
 * busca não serve aqui: ele troca esses caracteres por curinga, e marcador é
 * igualdade exata.
 */
export function arrayDeUmValorParaOr(valor: string): string {
  const escapa = (t: string) => t.replace(/[\\"]/g, (c) => `\\${c}`);
  return `"${escapa(`{"${escapa(valor)}"}`)}"`;
}

/**
 * `{"a","b"}` como operando de `cs`/`ov` DENTRO de um `or=` — a MESMA gramática
 * de duas camadas de `arrayDeUmValorParaOr`, com a lista inteira num literal só.
 *
 * ⚠️ CADA ELEMENTO VAI ENTRE ASPAS, e é isso que a torna uma lista e não uma
 * palavra. O literal de array do Postgres é `{"a","b"}`: sem as aspas internas,
 * `{a,b}` é um elemento só, de nome `a,b` — e o filtro casaria conversas com
 * uma etiqueta chamada "a,b", que ninguém escreveu. A forma de um item já
 * tinha as aspas (`arrayDeUmValorParaOr("vip")` → `{"vip"}`); a lista tem de
 * manter, senão as duas formas da mesma coluna divergiriam por construção.
 *
 * Por isso a lista de um é `{"vip"}` — byte a byte o que o caminho singular já
 * produzia, e a razão de `aplicarMarcadores` desviar o caso de TAMANHO 1 para
 * `aplicarMarcador`: por este caminho, ele já sairia igual.
 *
 * O escape é o de sempre, POR ITEM: escapar a string junta escaparia as vírgulas
 * que separam os elementos, e o `,` que está DENTRO do nome de um marcador
 * viraria separador. Marcador é texto livre e o editor aceita vírgula — é o caso
 * que o valor único já resolvia, e resolver aqui só o valor único devolveria a
 * mesma classe de defeito pelo caminho novo.
 */
export function listaDeValoresParaOr(valores: readonly string[]): string {
  const escapa = (t: string) => t.replace(/[\\"]/g, (c) => `\\${c}`);
  const itens = valores.map((v) => `"${escapa(v)}"`).join(",");
  return `"${escapa(`{${itens}}`)}"`;
}

/**
 * O predicado do marcador: casa a caixa da CONVERSA **ou** a do CONTATO.
 *
 * As duas, e não a troca: trocar a fonte pelo contato consertaria o relato e
 * tiraria o filtro de quem marca a conversa (`ConversationTagsEditor`, e a IA
 * por `crm_manage_tags`) — o marcador continuaria editável e deixaria de ser
 * filtrável. O lado do contato é o campo calculado, e não um `contact_id.in.(…)`:
 * a lista de ids viaja na URL e tem teto (`idsQueCabemNaURL`) — numa org com mais
 * contatos marcados que isso, conversas sumiriam do filtro sem aviso.
 */
export function predicadoDoMarcador(marcador: string): string {
  const valor = arrayDeUmValorParaOr(marcador);
  return `tags.cs.${valor},tags_do_contato.cs.${valor}`;
}

/**
 * Aplica o marcador na consulta — a MESMA função para a lista e para a contagem.
 *
 * Sem marcador não há filtro, e sem filtro não há `or=`. O builder do supabase-js
 * devolve ele mesmo, então quem chama pode encadear sem saber quem aplicou.
 *
 * ⚠️ ESTA É A FORMA SINGULAR, E ELA CONTINUA SENDO O CONTRATO DE HOJE. O plural
 * nasce em `aplicarMarcadores` (logo abaixo), que delega a forma de um item a
 * ESTA função — de modo que `?tag=vip` produz byte a byte o mesmo `or=` que
 * produzia antes desta mudança. `tests/unit/filtro-multi-etiqueta.test.ts`
 * fixa essa igualdade byte a byte.
 */
export function aplicarMarcador<C extends { or: (filtro: string) => C }>(
  consulta: C,
  marcador: string | null | undefined,
): C {
  if (!marcador) return consulta;
  return consulta.or(predicadoDoMarcador(marcador));
}

/**
 * ═══ O FILTRO POR VÁRIAS ETIQUETAS, E COMO AS DUAS SEMÂNTICAS VIRARAM TEXTO ═══
 *
 * A issue #1274 pede "vip **e** orçamento" e "vip **ou** orçamento" nas três
 * listas. A semântica de cada uma foi combinada com quem mantém o produto:
 *
 * - **E** (`modo=e`, padrão): a conversa tem TODAS as escolhidas *na mesma caixa*
 *   — na conversa (`tags`) **ou** no contato (`tags_do_contato`). É o "contém
 *   todos" do PostgREST (`cs`) e mantém a régua das duas caixas que a 0323
 *   fixou: quem marcou a conversa e quem marcou o cliente continuam casando.
 * - **OU** (`modo=ou`): qualquer uma das escolhidas, em qualquer das duas caixas
 *   (`ov`).
 *
 * O intervalo entre as duas — "vip na conversa E orçamento no contato", misturando
 * caixas — não é expressável pelas duas caixas de hoje. A recomendação de quem
 * abriu a issue é ficar nas duas semânticas simples, e o terceiro caso fica
 * registrado aqui como decisão de produto pendente — é o que o PR declara.
 */

/** Os dois modos, e só eles. `e` é o padrão: uma etiqueta só nunca muda de sentido. */
export const MODOS_DE_ETIQUETA = ["e", "ou"] as const;
/** Qual dos dois modos vale — `e` quando ninguém disse. */
export type ModoDeEtiqueta = (typeof MODOS_DE_ETIQUETA)[number];

/**
 * Quantas etiquetas um filtro aceita. Teto GENEROSO de propósito: ele existe
 * porque a lista de valores viaja na querystring do PostgREST, e um teto baixo
 * cortaria um filtro pedido. 20 é o mesmo teto que a escrita de marcadores já
 * impõe (`conversationTagsSchema`, `normalizarTags` na importação por CSV) —
 * acima disso nenhum marcador escrito hoje seria filtrável, então o limite não
 * tira nada de quem filtra.
 */
export const MAXIMO_DE_ETIQUETAS_NO_FILTRO = 20;

/**
 * Lê `modo` da URL sem explodir: valor FORA dos dois (`?modo=xou`) é `undefined`,
 * e quem chamou decide — no schema Zod, virar 422, porque uma resposta de 422
 * ensina o integrador a corrigir; na tela, virar `e`, porque uma tela não pode
 * quebrar por um param inventado.
 */
export function modoDeEtiqueta(cru: string | null | undefined): ModoDeEtiqueta | undefined {
  if (cru == null) return undefined;
  return (MODOS_DE_ETIQUETA as readonly string[]).includes(cru)
    ? (cru as ModoDeEtiqueta)
    : undefined;
}

/**
 * A lista de marcadores que o filtro escolheu, sem vazio e sem repetido.
 *
 * A ordem da primeira aparição é preservada: é o que o operador reconhece, e o
 * que a URL produzida seja estável entre dois renders do mesmo filtro.
 */
export function marcadoresEscolhidos(crus: readonly (string | null | undefined)[]): string[] {
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const cru of crus) {
    const marcador = cru?.trim();
    if (!marcador || vistos.has(marcador)) continue;
    vistos.add(marcador);
    saida.push(marcador);
  }
  return saida;
}

/**
 * O predicado de UMA etiqueta, no texto do `or=` — a MESMA forma que a função
 * singular acima produzia, e é por isso que o filtro de uma etiqueta não mudou
 * de byte.
 */
export function predicadoDeUmMarcador(marcador: string): string {
  return predicadoDoMarcador(marcador);
}

/**
 * O predicado de VÁRIAS etiquetas nas DUAS caixas, no `or=` de sempre.
 *
 * `modo` é o que decide o OPERADOR: `cs` (a caixa contém TODAS as etiquetas) no
 * modo E, `ov`/overlaps (a caixa contém QUALQUER uma) no modo OU. É a ÚNICA coisa
 * que muda entre os dois modos — o literal é o mesmo e o `or=` é o mesmo, de
 * propósito: o que separa "E" de "OU" fica visível num `git diff` de uma linha.
 */
export function predicadoDeVariasEtiquetas(
  marcadores: readonly string[],
  modo: ModoDeEtiqueta = "e",
): string {
  if (marcadores.length === 0) return "";
  if (marcadores.length === 1) return predicadoDeUmMarcador(marcadores[0]!);
  const operador = modo === "ou" ? "ov" : "cs";
  const valor = listaDeValoresParaOr(marcadores);
  return `tags.${operador}.${valor},tags_do_contato.${operador}.${valor}`;
}

/**
 * Aplica o filtro de VÁRIAS etiquetas na consulta.
 *
 * ⚠️ Aceita `string` além de `string[]` DE PROPÓSITO. Quem chama vem de duas
 * fontes: a tela, que tem lista, e o `?tag=vip` de um link salvo, que é uma
 * string só. Se esta função aceitasse só array, o chamador da string teria de
 * embrulhar — e um chamador que esquece o embrulho não avisa: o filtro passa a
 * casar a string como se fosse um marcador INTEIRO, que é uma lista vazia na
 * prática, e a tela mostra "nenhuma conversa" sem erro. Aceitar as duas formas
 * aqui é a mesma política do schema, pela mesma razão.
 *
 * ⚠️ O CASO DE TAMANHO 1 É O QUE MANTÉM A URL ANTIGA VIVA. Uma etiqueta só
 * entra pelo caminho singular (`aplicarMarcador` → `or=(tags.cs.{vip},
 * tags_do_contato.cs.{vip})`), byte a byte igual ao que `?tag=vip` produzia
 * antes desta mudança. Sem esse desvio, o `?tag=` singular passaria a gerar um
 * `cs` de lista de um item — que casaria a mesma conversa, e por isso o defeito
 * seria SILENCIOSO: a lista voltaria quase inteira e o sintoma seria "o filtro
 * parou de filtrar". Daí o teste comparar as duas formas byte a byte.
 */
export function aplicarMarcadores<C extends { or: (filtro: string) => C }>(
  consulta: C,
  marcadores: readonly string[] | string | null | undefined,
  modo: ModoDeEtiqueta = "e",
): C {
  // A string solitaria é embrulhada em LISTA de um — e é aqui que está o perigo
  // que o embrulho evita: sem ele, uma string `fidic` viraria o LITERAL
  // `{f,i,d,c}` de "contém todos", e o filtro casaria conversas que têm as
  // letras f, i, d e c em qualquer ordem. A lista de um devolve exatamente o
  // que o caminho singular devolvia, que é o que a comparação byte a byte
  // abaixo fixa.
  const lista = marcadoresEscolhidos(
    typeof marcadores === "string" ? [marcadores] : (marcadores ?? []),
  );
  if (lista.length === 0) return consulta;
  if (lista.length === 1) return aplicarMarcador(consulta, lista[0]);
  return consulta.or(predicadoDeVariasEtiquetas(lista, modo));
}
