/**
 * Um `SupabaseClient` de MENTIRA, feito de `pg` de VERDADE.
 *
 * ═══ POR QUE ISTO EXISTE ═══
 *
 * `pnpm test:db` sobe Postgres puro, **sem PostgREST** — de propósito
 * (`vitest.db.config.ts` aponta `NEXT_PUBLIC_SUPABASE_URL` para uma porta
 * inalcançável). Então código que fala `supabase.from(...)` não tinha como ser
 * exercitado ali: só dava para reescrever a consulta em SQL ao lado e conferir
 * que o banco se defende — o que prova o BANCO, nunca o CÓDIGO.
 *
 * Aqui a decisão do código roda de verdade: quais filtros ele aplica, em que
 * ordem, o que faz com o que volta. O que muda é só o transporte.
 *
 * ═══ O QUE ELE NÃO REPRODUZ (declarado, não estimado) ═══
 *
 * 1. **RLS.** `pg` conecta como `postgres` e passa por cima. Isolamento entre
 *    organizações é medido pelos invariantes que usam papel restrito — não aqui.
 * 2. **Rede.** Timeout, retry e erro de transporte não existem neste caminho.
 * 3. **A superfície inteira do PostgREST.** Só o que está implementado abaixo:
 *    `select/insert` com `eq`, `order`, `limit`, `maybeSingle`, `single`. Um
 *    método não implementado **estoura** em vez de ser ignorado em silêncio —
 *    ver `naoImplementado`. Silêncio aqui viraria teste verde medindo nada.
 *
 * ═══ E SE ELE MENTIR? ═══
 *
 * Um adaptador que ignorasse um `.eq()` deixaria o teste passar pelo motivo
 * errado. Por isso `tests/invariants/pg-como-supabase.test.ts` sabota o próprio
 * adaptador: filtro que não filtra, ordem que não ordena e `maybeSingle` com
 * duas linhas têm caso próprio. O instrumento é medido antes de medir.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type pg from "pg";

interface ErroPg {
  message: string;
  code?: string;
}

export interface RespostaFalsa<T> {
  data: T | null;
  error: ErroPg | null;
}

function naoImplementado(metodo: string): never {
  throw new Error(
    `[pg-como-supabase] '${metodo}' não está implementado. ` +
      "Implemente-o (com caso no teste do adaptador) em vez de contornar — " +
      "método ausente que devolvesse vazio faria o teste passar medindo nada.",
  );
}

function erroDe(e: unknown): ErroPg {
  const bruto = e as { message?: string; code?: string };
  return { message: bruto?.message ?? String(e), code: bruto?.code };
}

/** Aspas em cada coluna: `slug`, `position` e afins são palavras vivas no SQL. */
function colunasSql(colunas: string): string {
  if (colunas.trim() === "*") return "*";
  return colunas
    .split(",")
    .map((c) => `"${c.trim()}"`)
    .join(", ");
}

class ConsultaPg<T> implements PromiseLike<RespostaFalsa<T[]>> {
  /** [operador, coluna, valor] — o operador entra porque `.lt`/`.gt` existem. */
  private filtros: Array<[string, string, unknown]> = [];
  private ordem: { coluna: string; asc: boolean } | null = null;
  private teto: number | null = null;

  constructor(
    private readonly pool: pg.Pool,
    private readonly tabela: string,
    private readonly colunas: string,
  ) {}

  eq(coluna: string, valor: unknown): this {
    this.filtros.push(["=", coluna, valor]);
    return this;
  }

  /**
   * `<` e `>` — nasceram porque `vencePropostasDeDado` os usa e o adaptador
   * ESTOUROU ao ser chamado. Terceira vez que o `naoImplementado` paga o
   * próprio custo: devolver vazio teria deixado 7 casos verdes medindo nada.
   */
  lt(coluna: string, valor: unknown): this {
    this.filtros.push(["<", coluna, valor]);
    return this;
  }

  gt(coluna: string, valor: unknown): this {
    this.filtros.push([">", coluna, valor]);
    return this;
  }

  order(coluna: string, opts?: { ascending?: boolean }): this {
    this.ordem = { coluna, asc: opts?.ascending !== false };
    return this;
  }

  limit(n: number): this {
    this.teto = n;
    return this;
  }

  /** Presentes para ESTOURAR: o código que os usar precisa de implementação real. */
  in(): never {
    return naoImplementado("in");
  }
  neq(): never {
    return naoImplementado("neq");
  }

  private montar(): { texto: string; valores: unknown[] } {
    const valores: unknown[] = [];
    const onde = this.filtros.map(([op, c, v]) => {
      valores.push(v);
      return `"${c}" ${op} $${valores.length}`;
    });
    let texto = `select ${colunasSql(this.colunas)} from public."${this.tabela}"`;
    if (onde.length > 0) texto += ` where ${onde.join(" and ")}`;
    if (this.ordem) texto += ` order by "${this.ordem.coluna}" ${this.ordem.asc ? "asc" : "desc"}`;
    if (this.teto !== null) texto += ` limit ${this.teto}`;
    return { texto, valores };
  }

  private async linhas(): Promise<{ rows: T[]; error: ErroPg | null }> {
    const { texto, valores } = this.montar();
    try {
      const r = await this.pool.query(texto, valores);
      return { rows: r.rows as T[], error: null };
    } catch (e) {
      return { rows: [], error: erroDe(e) };
    }
  }

  /** Zero linhas → `data: null` SEM erro. Mais de uma → ERRO, como o PostgREST. */
  async maybeSingle(): Promise<RespostaFalsa<T>> {
    const { rows, error } = await this.linhas();
    if (error) return { data: null, error };
    if (rows.length > 1) {
      return {
        data: null,
        error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" },
      };
    }
    return { data: rows[0] ?? null, error: null };
  }

  /** Exige exatamente uma. Zero também é erro — a diferença para `maybeSingle`. */
  async single(): Promise<RespostaFalsa<T>> {
    const { rows, error } = await this.linhas();
    if (error) return { data: null, error };
    if (rows.length !== 1) {
      return {
        data: null,
        error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" },
      };
    }
    return { data: rows[0]!, error: null };
  }

  then<R1 = RespostaFalsa<T[]>, R2 = never>(
    aoResolver?: ((v: RespostaFalsa<T[]>) => R1 | PromiseLike<R1>) | null,
    aoRejeitar?: ((r: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.linhas()
      .then(({ rows, error }) => (error ? { data: null, error } : { data: rows, error: null }))
      .then(aoResolver, aoRejeitar);
  }
}

class InsercaoPg<T> implements PromiseLike<RespostaFalsa<null>> {
  private colunasDeVolta: string | null = null;

  constructor(
    private readonly pool: pg.Pool,
    private readonly tabela: string,
    private readonly linha: Record<string, unknown>,
  ) {}

  select(colunas = "*"): this {
    this.colunasDeVolta = colunas;
    return this;
  }

  private montar(): { texto: string; valores: unknown[] } {
    const chaves = Object.keys(this.linha);
    const valores = chaves.map((k) => {
      const v = this.linha[k];
      // jsonb/array vão como parâmetro; objeto solto o driver não converte.
      return v !== null && typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : v;
    });
    const marcas = chaves.map((_, i) => `$${i + 1}`).join(", ");
    const texto =
      `insert into public."${this.tabela}" (${chaves.map((k) => `"${k}"`).join(", ")}) values (${marcas})` +
      (this.colunasDeVolta ? ` returning ${colunasSql(this.colunasDeVolta)}` : "");
    return { texto, valores };
  }

  async single(): Promise<RespostaFalsa<T>> {
    const { texto, valores } = this.montar();
    try {
      const r = await this.pool.query(texto, valores);
      return { data: (r.rows[0] ?? null) as T, error: null };
    } catch (e) {
      return { data: null, error: erroDe(e) };
    }
  }

  /**
   * Difere de `single` no que faz com o ERRO, não com o sucesso: quem usa
   * `maybeSingle` num insert está dizendo "se não deu, sigo sem" — é o caso do
   * item da Central, que não pode derrubar o vencimento das propostas.
   */
  async maybeSingle(): Promise<RespostaFalsa<T>> {
    return this.single();
  }

  then<R1 = RespostaFalsa<null>, R2 = never>(
    aoResolver?: ((v: RespostaFalsa<null>) => R1 | PromiseLike<R1>) | null,
    aoRejeitar?: ((r: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    const { texto, valores } = this.montar();
    return this.pool
      .query(texto, valores)
      .then(() => ({ data: null, error: null }) as RespostaFalsa<null>)
      .catch((e: unknown) => ({ data: null, error: erroDe(e) }) as RespostaFalsa<null>)
      .then(aoResolver, aoRejeitar);
  }
}


/**
 * UPDATE com filtros — a forma `.update(obj).eq(a,b).select(cols).maybeSingle()`.
 *
 * Nasceu porque `patchContactHandler` a usa, e o adaptador ESTOUROU ao ser
 * chamado (em vez de devolver vazio, que teria deixado o teste verde medindo
 * nada). O `naoImplementado` fez o trabalho dele.
 */
class AtualizacaoPg<T> implements PromiseLike<RespostaFalsa<unknown>> {
  private filtros: Array<[string, unknown]> = [];
  private colunasDeVolta: string | null = null;

  constructor(
    private readonly pool: pg.Pool,
    private readonly tabela: string,
    private readonly patch: Record<string, unknown>,
  ) {}

  eq(coluna: string, valor: unknown): this {
    this.filtros.push([coluna, valor]);
    return this;
  }

  select(colunas = "*"): this {
    this.colunasDeVolta = colunas;
    return this;
  }

  private montar(): { texto: string; valores: unknown[] } {
    const valores: unknown[] = [];
    const sets = Object.keys(this.patch).map((k) => {
      const v = this.patch[k];
      valores.push(v !== null && typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : v);
      return `"${k}" = $${valores.length}`;
    });
    const onde = this.filtros.map(([c, v]) => {
      valores.push(v);
      return `"${c}" = $${valores.length}`;
    });
    let texto = `update public."${this.tabela}" set ${sets.join(", ")}`;
    if (onde.length > 0) texto += ` where ${onde.join(" and ")}`;
    if (this.colunasDeVolta) texto += ` returning ${colunasSql(this.colunasDeVolta)}`;
    return { texto, valores };
  }

  async maybeSingle(): Promise<RespostaFalsa<T>> {
    const { texto, valores } = this.montar();
    try {
      const r = await this.pool.query(texto, valores);
      if (r.rows.length > 1) {
        return { data: null, error: { message: "multiple rows returned", code: "PGRST116" } };
      }
      return { data: (r.rows[0] ?? null) as T, error: null };
    } catch (e) {
      return { data: null, error: erroDe(e) };
    }
  }

  async single(): Promise<RespostaFalsa<T>> {
    const r = await this.maybeSingle();
    if (r.error) return r;
    if (r.data === null) {
      return { data: null, error: { message: "no rows returned", code: "PGRST116" } };
    }
    return r;
  }

  /**
   * ⚠️ Com `.select()`, o `await` direto devolve AS LINHAS — não `null`.
   *
   * A primeira versão devolvia `{data: null}` sempre, e isso quebrava um padrão
   * que o repo usa como TRAVA: `update().eq(id).eq(stage_id).select("id")` e
   * depois `if (linhas.length === 0)` para detectar "um humano moveu o card no
   * meio da operação". Com `null`, toda escrita bem-sucedida virava
   * `conflito_humano` — o adaptador afirmava que a trava tinha disparado
   * quando o UPDATE tinha funcionado.
   *
   * Sem `.select()`, `data: null` continua certo: é o que o PostgREST devolve.
   */
  then<R1 = RespostaFalsa<unknown>, R2 = never>(
    aoResolver?: ((v: RespostaFalsa<unknown>) => R1 | PromiseLike<R1>) | null,
    aoRejeitar?: ((r: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    const { texto, valores } = this.montar();
    const pediuRetorno = this.colunasDeVolta !== null;
    return this.pool
      .query(texto, valores)
      .then(
        (r) =>
          ({ data: pediuRetorno ? r.rows : null, error: null }) as RespostaFalsa<unknown>,
      )
      .catch((e: unknown) => ({ data: null, error: erroDe(e) }) as RespostaFalsa<unknown>)
      .then(aoResolver, aoRejeitar);
  }
}

/**
 * `rpc(nome, args)` — chamada de função por argumentos NOMEADOS, como o
 * PostgREST faz. Sem isto, todo caminho que emite evento (`emit_event`) morre no
 * meio do handler sob teste.
 */
async function chamarRpc(
  pool: pg.Pool,
  nome: string,
  args: Record<string, unknown>,
): Promise<RespostaFalsa<unknown>> {
  const chaves = Object.keys(args);
  const valores = chaves.map((k) => {
    const v = args[k];
    return v !== null && typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : v;
  });
  const nomeados = chaves.map((k, i) => `${k} => $${i + 1}`).join(", ");
  try {
    const r = await pool.query(`select public."${nome}"(${nomeados}) as valor`, valores);
    return { data: (r.rows[0] as { valor: unknown } | undefined)?.valor ?? null, error: null };
  } catch (e) {
    return { data: null, error: erroDe(e) };
  }
}

/**
 * O cast para `SupabaseClient` é deliberado e está confinado a esta linha: o
 * tipo real tem dezenas de membros que este objeto não tem, e listá-los como
 * `undefined` só esconderia a mesma verdade com mais texto.
 */
export function pgComoSupabase(pool: pg.Pool): SupabaseClient {
  return {
    from(tabela: string) {
      return {
        select: (colunas = "*") => new ConsultaPg(pool, tabela, colunas),
        insert: (linha: Record<string, unknown>) => new InsercaoPg(pool, tabela, linha),
        update: (patch: Record<string, unknown>) => new AtualizacaoPg(pool, tabela, patch),
        delete: () => naoImplementado("delete"),
        upsert: () => naoImplementado("upsert"),
      };
    },
    rpc: (nome: string, args: Record<string, unknown> = {}) => chamarRpc(pool, nome, args),
  } as unknown as SupabaseClient;
}
