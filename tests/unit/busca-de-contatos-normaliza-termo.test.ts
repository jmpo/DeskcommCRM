/**
 * A BUSCA DE CONTATOS NORMALIZA O TERMO — PELA RÉGUA QUE JÁ EXISTE (#1835, F1).
 *
 * ─── O defeito ───────────────────────────────────────────────────────────────
 * O `q.search` da listagem de contatos passava por exatamente três
 * transformações, e nenhuma delas é sobre COMO A GENTE DIGITA:
 *
 *     trim · escape de curinga (`%`/`_`) · vírgula e parêntese viram espaço
 *
 * Medido na issue #1835, com o contato "Paulo Lima Jr" no banco:
 *
 *     digitado            antes                    depois (F1)
 *     "Paulo  Lima"       0 — espaço duplo         acha
 *     "Paulo Jr"          0 — não adjacentes       acha
 *     "Silva, Maria"      exige adjacência         acha
 *     "a"                 a lista INTEIRA          não consulta
 *
 * A última linha é a mais grave e a menos óbvia: `?search=a` montava
 * `name.ilike.%a%` e devolvia a base inteira embaralhada. Lista inteira sob
 * busca não é resposta — é ruído que PARECE resposta, e quem opera conclui
 * que o filtro não funciona.
 *
 * ─── Por que isto importa o arquivo inteiro ──────────────────────────────────
 * A busca de CONVERSAS já resolve os três casos com `normalizarTermoDeBusca` +
 * `PISO_DA_BUSCA`, em `lib/inbox/termo-de-busca.ts` — a ÚNICA régua por
 * design, lida pelo schema Zod e pela tela. Repetir a regra num dos lados faz
 * os dois divergirem no primeiro ajuste, e a divergência aparece como busca
 * que funciona na caixa e não funciona em contatos. Por isso o handler de
 * contatos IMPORTA a régua em vez de reimplementá-la, e este teste é a
 * catraca que impede que alguém volte a escrever a regra à mão aqui dentro.
 *
 * ─── O que este teste mede, e o que ele NÃO mede ─────────────────────────────
 * Não há banco no `tests/unit`. O que se mede é o FILTRO que sai do handler —
 * a decisão que estava errada — e ele é então traduzido para SQL pelo MESMO
 * par de regras do PostgREST (`padraoCasa` abaixo): `*` vira `%`, `%`/`_`
 * escapados são literais. É uma reimplementação de `ILIKE`, e por isso ela
 * mesma tem casos de CONTROLE: se o emulador passasse a casar tudo, os quatro
 * casos de cima ficariam verdes sem provar nada.
 *
 * O que NÃO está aqui: o banco de verdade (`tests/invariants`, `test:db`) e a
 * tela — ambos do CI.
 */
import { describe, expect, it } from "vitest";

import { listContactsHandler } from "@/app/api/v1/contacts/_handler";

const ORG = "11111111-1111-4111-8111-111111111111";

/** O contato que a issue usou para medir os quatro casos. */
const PAULO_LIMA_JR = "Paulo Lima Jr";

/**
 * Cliente mínimo que mede TRÊS coisas: se o handler ABRIU uma tabela, se ele
 * EXECUTOU a cadeia (o `await` é o momento em que o supabase-js faria o fetch)
 * e o `.or()` que ele montou.
 *
 * Contar `from` e `await` separados é o que permite afirmar "NÃO CONSULTOU",
 * e não apenas "não achou": uma consulta que devolve 200 com a base inteira é
 * exatamente o defeito da linha `"a"` da issue.
 *
 * O dublê tem de conhecer TODOS os elos que o handler encadeia: um elo que
 * falta não vira "asserção que não passa", vira `TypeError` no meio da consulta
 * — e o vermelho aparece por motivo nenhum.
 */
function supabaseEspiao() {
  const estado = {
    aberturas: 0,
    execucoes: 0,
    filtros: [] as string[],
    igualdades: [] as Array<[string, unknown]>,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    select: () => chain,
    eq: (coluna: string, valor: unknown) => {
      estado.igualdades.push([coluna, valor]);
      return chain;
    },
    order: () => chain,
    limit: () => chain,
    contains: () => chain,
    is: () => chain,
    in: () => chain,
    or: (expr: string) => {
      estado.filtros.push(expr);
      return chain;
    },
    then: (res: (v: unknown) => unknown) => {
      estado.execucoes += 1;
      return Promise.resolve({ data: [], error: null }).then(res);
    },
  };
  return {
    client: {
      from: () => {
        estado.aberturas += 1;
        return chain;
      },
    } as never,
    estado,
  };
}

async function busca(termo: string) {
  const { client, estado } = supabaseEspiao();
  const resultado = await listContactsHandler(
    client,
    { organization_id: ORG, actor: { type: "user", id: "u-1" }, requestId: "req" },
    { search: termo, limit: 20 },
  );
  return {
    resultado,
    aberturas: estado.aberturas,
    execucoes: estado.execucoes,
    filtro: estado.filtros[0] ?? "",
    igualdades: estado.igualdades,
  };
}

function escapeRegex(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * `ILIKE` do PostgREST, em duas linhas declaradas.
 *
 * PostgREST traduz `*` no valor para `%` do SQL; `%` e `_` escapados com
 * barra voltada são literais (é o que o handler faz com o curinga que a PESSOA
 * digitou); o resto é casamento por inteiro, sem caixa — `ilike`.
 */
function padraoCasa(padrao: string, valor: string): boolean {
  let re = "";
  for (let i = 0; i < padrao.length; i++) {
    const ch = padrao[i]!;
    if (ch === "\\" && i + 1 < padrao.length) {
      re += escapeRegex(padrao[++i]!);
    } else if (ch === "*" || ch === "%") {
      re += ".*";
    } else if (ch === "_") {
      re += ".";
    } else {
      re += escapeRegex(ch);
    }
  }
  return new RegExp(`^${re}$`, "i").test(valor);
}

/** Todas as condições `coluna.ilike.padrao` que o handler pôs no `.or()`. */
function condicoesIlke(filtro: string): Array<{ coluna: string; padrao: string }> {
  return [...filtro.matchAll(/(\w+)\.ilike\.([^,]+)/g)].map((m) => ({
    coluna: m[1]!,
    padrao: m[2]!,
  }));
}

/** O filtro ACHOU o nome? (`name` e `display_name` — as duas colunas do OR.) */
function achouNoNome(filtro: string, nome: string): boolean {
  return condicoesIlke(filtro)
    .filter((c) => c.coluna === "name" || c.coluna === "display_name")
    .some((c) => padraoCasa(c.padrao, nome));
}

describe("busca de contatos: o termo é normalizado pela régua do repo (#1835, F1)", () => {
  it('espaço duplo ("Paulo  Lima") passa a achar "Paulo Lima Jr"', async () => {
    const { filtro } = await busca("Paulo  Lima");
    expect(achouNoNome(filtro, PAULO_LIMA_JR), `filtro=${filtro}`).toBe(true);
    // A asserção acima é o comportamento; esta diz COMO ele nasceu: um curinga
    // só, não dois espaços literais.
    expect(filtro).toContain("%Paulo*Lima%");
  });

  it('palavras não adjacentes ("Paulo Jr") passam a achar "Paulo Lima Jr"', async () => {
    const { filtro } = await busca("Paulo Jr");
    expect(achouNoNome(filtro, PAULO_LIMA_JR), `filtro=${filtro}`).toBe(true);
    expect(filtro).toContain("%Paulo*Jr%");
  });

  it('vírgula ("Silva, Maria") não exige mais adjacência — nem injeção no or=', async () => {
    // DIGITADO com vírgula contra o contato cadastrado COM vírgula: o saneamento
    // antigo virava `Silva  Maria` (dois espaços literais) e não casava nada.
    const comVirgula = await busca("Silva, Maria");
    expect(comVirgula.filtro).not.toContain("Silva,");
    expect(achouNoNome(comVirgula.filtro, "Silva, Maria"), `filtro=${comVirgula.filtro}`).toBe(true);

    // E o outro sentido é o que a linha da issue quer dizer com "não exige
    // adjacência": digitar SEM a vírgula acha o cadastro QUE A TEM.
    const semVirgula = await busca("Silva Maria");
    expect(achouNoNome(semVirgula.filtro, "Silva, Maria"), `filtro=${semVirgula.filtro}`).toBe(true);
  });

  it('termo de 1 caractere ("a") NÃO consulta — devolver a lista inteira é ruído', async () => {
    const { aberturas, execucoes, filtro, resultado } = await busca("a");
    // Antes: `name.ilike.%a%` e a base inteira de volta, com 200 OK — parecia
    // resposta. Agora: nenhuma consulta, página vazia.
    expect(aberturas).toBe(0);
    expect(execucoes).toBe(0);
    expect(filtro).toBe("");
    expect(resultado).toEqual({ contacts: [], cursor: null, has_more: false });
  });

  it("só pontuação também não consulta — o piso mede DEPOIS de normalizar", async () => {
    // `", ,"` tem 3 caracteres crus e passaria por qualquer piso de comprimento;
    // normalizado vira string vazia, que no `ilike` seria `%%` e casaria TUDO.
    const { aberturas, execucoes } = await busca(", ,");
    expect(aberturas).toBe(0);
    expect(execucoes).toBe(0);
  });

  it.each(["()", "((", "(a", "a)", "( a )"])(
    'parêntese não fura o piso: "%s" NÃO consulta',
    async (termo) => {
      // O filtro tira os parênteses antes da régua; o piso tem de medir a MESMA
      // string. Medido o cru, "()" passava (2 caracteres) e consultava `%%`, e
      // "(a" consultava `%a%` — a lista inteira de volta, pela porta irmã de ", ,".
      const { aberturas, execucoes } = await busca(termo);
      expect(aberturas).toBe(0);
      expect(execucoes).toBe(0);
    },
  );

  it.each([
    "a,organization_id.neq.x",
    "a),or(id.not.is.null",
    "a,organization_id.eq.00000000-0000-0000-0000-000000000000,id.not.is.null",
    '"a"',
    "a.b:c",
    "a&or=(id.not.is.null)",
  ])('termo malicioso "%s" não abre condição nova no or= nem tira o filtro de org', async (termo) => {
    const { execucoes, filtro, igualdades } = await busca(termo);
    expect(execucoes).toBe(1);
    // Nenhum delimitador do DSL do `or=` sobra dentro de um valor: parêntese
    // aninharia, e cada vírgula restante tem de ser a que o handler pôs.
    expect(filtro).not.toMatch(/[()]/);
    const colunas = filtro.split(",").map((cond) => cond.split(".")[0]);
    expect(colunas).toEqual(["name", "display_name", "email", "phone_number"]);
    // O recorte por organização é parâmetro PRÓPRIO da query (E com o `or=`):
    // é ele que segura o caminho de service role (Bearer e MCP).
    expect(igualdades).toContainEqual(["organization_id", ORG]);
  });

  it("CONTROLE: termo de verdade continua consultando e filtrando", async () => {
    // Sem este par, uma implementação que recusasse TUDO passaria nos de cima.
    const { aberturas, execucoes, filtro } = await busca("Paulo");
    expect(aberturas).toBe(1);
    expect(execucoes).toBe(1);
    expect(filtro).not.toBe("");
    expect(achouNoNome(filtro, PAULO_LIMA_JR)).toBe(true);
    // E continua filtrando de verdade: quem não é o termo não casa.
    expect(achouNoNome(filtro, "Maria Silva")).toBe(false);
  });

  it("CONTROLE: o curinga digitado continua literal, não vira coringa", async () => {
    const { filtro } = await busca("100%");
    expect(filtro).toContain("100\\%");
  });
});

/**
 * ⛔ Os controles do PRÓPRIO emulador.
 *
 * Ele é uma reimplementação de `ILIKE`, então é ele quem decide se os quatro
 * casos de cima significam alguma coisa. Se `padraoCasa` casasse tudo, todos
 * passariam verdes com a busca destruída.
 */
describe("CONTROLE: o emulador de ILIKE mede o que diz medir", () => {
  it("curinga `*` (que o PostgREST vira `%`) cobre o meio", () => {
    expect(padraoCasa("%Paulo*Jr%", PAULO_LIMA_JR)).toBe(true);
    expect(padraoCasa("%Paulo%", PAULO_LIMA_JR)).toBe(true);
  });

  it("espaço literal NÃO cobre o meio: é o defeito da F1, medido aqui", () => {
    expect(padraoCasa("%Paulo  Lima%", PAULO_LIMA_JR)).toBe(false);
    expect(padraoCasa("%Paulo Jr%", PAULO_LIMA_JR)).toBe(false);
  });

  it("% escapado é literal; _ escapado é literal; sem escape, é o coringa do SQL", () => {
    expect(padraoCasa("100\\%", "100%")).toBe(true);
    expect(padraoCasa("100\\%", "1000")).toBe(false);
    expect(padraoCasa("a\\_b", "a_b")).toBe(true);
    expect(padraoCasa("a\\_b", "axb")).toBe(false);
    // E o `_` SEM escape é curinga de UM caractere — é o `LIKE` do SQL, e é
    // por isso que o handler escapa o digitado: sem o escape, "a_b" casaria
    // "axb" e a busca acharia gente que ninguém pediu.
    expect(padraoCasa("a_b", "axb")).toBe(true);
  });

  it("casamento é por INTEIRO e sem caixa — não é busca desubstring qualquer", () => {
    expect(padraoCasa("%lmo%", PAULO_LIMA_JR)).toBe(false);
    expect(padraoCasa("%PAULO LIMA%", PAULO_LIMA_JR)).toBe(true);
  });
});
