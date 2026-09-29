/**
 * D7 DA ADR-0002 — AS FUNÇÕES DO MÓDULO EXISTEM (E COMPILAM) MESMO SEM AS TABELAS.
 *
 * ─── O que a ADR decide e este arquivo mede ───────────────────────────────────────────────────
 * "As funções de negócio do módulo são criadas pela migration e pelo baseline como qualquer
 * outra função, mesmo onde as tabelas não existem. Elas são escritas para compilar sem as
 * tabelas (PL/pgSQL com `record`, nunca `tabela%rowtype`), e o invariante cria toda a cadeia
 * com `check_function_bodies` ligado e sem as tabelas." (ADR-0002, D7)
 *
 * A ironia que dá sentido a este arquivo: num banco montado só com o `baseline.sql`, as
 * tabelas de honorários NÃO EXISTEM (a 0480 criou só as funções — as tabelas nascem quando
 * alguém instala o módulo, D2/D3). Então as funções do módulo vivem o tempo todo numa
 * instalação real no estado exatamente oposto ao que as originou. Se alguma delas precisasse
 * das tabelas para ser criada, a cadeia inteira falharia no `update.sh` de toda VPS.
 *
 * ─── Por que ligar `check_function_bodies` muda tudo ──────────────────────────────────────────
 * O `baseline.sql` abre com `SET check_function_bodies = false` (linha 10) — sem isso, o
 * corpo de PL/pgSQL e de `language sql` é analisado na CRIAÇÃO e qualquer referência a tabela
 * que ainda não existe derruba o arquivo. As migrations, ao contrário, rodam com o default do
 * Postgres: LIGADO. Ou seja: os DOIS artefatos da tripla criam as mesmas funções, mas em
 * regimes de validação diferentes, e só um deles está medido.
 *
 * Medido em `pgvector/pgvector:pg15` antes de escrever este arquivo — as três formas de corpo:
 *
 *   query em tabela ausente (PL/pgSQL)  -> CRIA (o corpo não é resolvido na criação)
 *   `v record`                          -> CRIA
 *   `declare v public.x%rowtype`        -> FALHA: relation "public.x" does not exist
 *   `language sql` sobre tabela ausente -> FALHA: relation does not exist
 *
 * Por isso a régua aqui é a da ADR: `record`, nunca `%rowtype`, e nenhuma função de negócio
 * do módulo pode ser `language sql` sobre tabela do módulo. Sabotagem que prova o gate: trocar
 * `v_parcela record` por `v_parcela public.honorarios_parcelas%rowtype` no corpo de
 * `fn_honorarios_parcela_pagar` deixa este arquivo VERMELHO na hora.
 *
 * ─── O controle positivo ──────────────────────────────────────────────────────────────────────
 * Sem ele, o gate passaria por VÁCUO: se `check_function_bodies` estiver desligado na sessão,
 * QUALQUER corpo compila e os casos abaixo seriam verdes sem medir nada. A sonda cria uma
 * função `language sql` que consulta a tabela ausente e espera o ERRO; se ela nascer, o
 * instrumento está cego e `D7_CONTROLE_CEGO` derruba a suíte.
 */
import { describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

/** A tabela do módulo não instalado — é assim que o baseline a entrega. */
const TABELAS_DO_MODULO = ["public.honorarios_contratos", "public.honorarios_parcelas"];

describe("D7 — a cadeia de funções do módulo compila sem as tabelas", () => {
  it("o instrumento está vivo: com as tabelas ausentes, corpo inválido NÃO compila", () => {
    // A sonda roda com `check_function_bodies` LIGADO e consulta a tabela que não existe.
    // Se nascer, é porque a sessão está validando nada — e aí todo o resto deste arquivo
    // seria verde por não medir.
    const saida = tentar(`
      set check_function_bodies = on;
      create or replace function public.sonda_d7_corpo_invalido()
        returns bigint language sql stable
        as $$ select count(*) from public.honorarios_parcelas $$;
    `);
    expect(
      saida,
      "a sonda D7 NASCEU (o `create` passou): check_function_bodies está desligado nesta sessão " +
        "e QUALQUER corpo compila — o gate seria verde sem medir nada",
    ).not.toBe("");
    expect(saida).toMatch(/does not exist/);
  });

  it("toda a cadeia de funções do módulo é recriada com check_function_bodies LIGADO e sem as tabelas", () => {
    // Um ÚNICO script, porque o `set` e a captura dos corpos são da mesma sessão: cada
    // chamada de `sql()` abre um psql novo, e tabela temporária não atravessa sessão.
    const saida = sql(`
      create temporary table d7_defs as
        select pg_get_functiondef(p.oid) as def
          from pg_proc p
         where p.pronamespace = 'public'::regnamespace
           and p.proname like 'fn\\_honorarios\\_%';

      -- O estado do banco instalado SEM o módulo (D2/D3): as tabelas não existem.
      drop table if exists public.honorarios_parcelas, public.honorarios_contratos cascade;

      set check_function_bodies = on;

      -- O corpo que este invariante garante: sem a tabela, ele não pode ser criado.
      do $sonda$
      begin
        begin
          execute $q$
            create or replace function public.sonda_d7_corpo_invalido()
              returns bigint language sql stable
            as $$ select count(*) from public.honorarios_parcelas $$
          $q$;
          raise exception 'D7_CONTROLE_CEGO';
        exception when others then
          if sqlerrm = 'D7_CONTROLE_CEGO' then raise; end if;
        end;
      end $sonda$;

      -- A prova de D7: cada função do módulo, tal qual o banco a guardou, recriada sob a
      -- régua da migration (corpo analisado na criação) com as tabelas ausentes.
      do $recria$
      declare
        d record;
        n int := 0;
      begin
        for d in select def from d7_defs loop
          execute d.def;
          n := n + 1;
        end loop;
        if n = 0 then
          raise exception 'D7_CONTROLE_CEGO: nenhuma função do módulo capturada';
        end if;
      end $recria$;

      select (select count(*) from pg_proc
               where pronamespace = 'public'::regnamespace
                 and proname like 'fn\\_honorarios\\_%')
             || '|' ||
             (to_regclass('public.honorarios_contratos') is null
              and to_regclass('public.honorarios_parcelas') is null)::text;
    `);

    const [capturadas, tabelasAusem] = lastLine(saida).split("|");
    expect(
      Number(capturadas),
      "nenhuma função do módulo foi recriada — a cadeia sumiu do baseline",
    ).toBeGreaterThanOrEqual(2);
    expect(
      tabelasAusem,
      "as tabelas do módulo existiam no banco de teste: este caso não mediria 'sem as tabelas'",
    ).toBe("true");
  });

  it("o módulo entregue hoje tem função de NEGÓCIO, e não só a provisionadora", () => {
    // Sem isto, a frase "a cadeia compila sem as tabelas" poderia se referir a uma função só
    // (a provisionadora, cujo corpo É o schema) e soar maior do que é. Honorários traz duas:
    // a provisória e `fn_honorarios_parcela_pagar` (0480).
    const existe = sql(`
      select string_agg(proname, ', ' order by proname)
        from pg_proc
       where pronamespace = 'public'::regnamespace
         and proname like 'fn\\_honorarios\\_%';
    `);
    expect(existe).toContain("fn_honorarios_provisionar");
    expect(existe).toContain("fn_honorarios_parcela_pagar");
    // E as duas estão onde a tripla manda que estejam: no baseline.
    for (const tabela of TABELAS_DO_MODULO) {
      expect(sql(`select (to_regclass('${tabela}') is null)::text;`)).toBe("true");
    }
  });
});

/** Roda um script esperando FALHA; devolve a saída de erro, ou "" se passou. */
function tentar(script: string): string {
  try {
    sql(script);
    return "";
  } catch (e) {
    const erro = e as { stderr?: string; message?: string };
    return `${erro.stderr ?? ""}${erro.message ?? ""}`;
  }
}
