/**
 * D8 DA ADR-0002 — O REGISTRO DE SEÇÕES DE MÓDULO É FECHADO TAMBÉM PARA O `service_role`.
 *
 * ─── O defeito que este arquivo reprova ───────────────────────────────────────────────────────
 * `fn_lgpd_redigir_secoes_de_modulo` é gatilho `security definer` de dono `postgres` e executa
 * `update public.<tabela> set ... where (<ligacao>)` com o `tabela` e a `ligacao` gravados em
 * `modulo_secoes_lgpd`. Quem pudesse escrever uma seção ganharia, na anonimização seguinte,
 * UPDATE como `postgres` em qualquer tabela de `public` — `api_audit_log` inclusive, de onde a
 * 0258 tirou o UPDATE até do `service_role`.
 *
 * O `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO service_role` do baseline (reproduzido
 * pelo prelude de `scripts/test-db.sh`) vale para toda tabela nova, e o `service_role` ignora a
 * RLS. Revogar só de `anon` e `authenticated` deixa a porta aberta para quem tem a service key.
 * Precedente do fechamento completo: `event_service_origins` no baseline.
 *
 * Arquivo próprio, e não um caso a mais em `adr-0002-d8-secoes-de-modulo-na-cascata.test.ts`,
 * porque `tests/invariants/**` é congelado pelo pre-commit: invariante novo, não edição.
 */
import { describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

/** Roda um script esperando FALHA; devolve o texto do erro, ou "" se passou. */
function tentar(script: string): string {
  try {
    sql(script);
    return "";
  } catch (e) {
    const erro = e as { stderr?: string; message?: string };
    return `${erro.stderr ?? ""}${erro.message ?? ""}`;
  }
}

describe("D8 — modulo_secoes_lgpd só é escrito por quem aplica o schema", () => {
  it("nenhum papel do PostgREST tem privilégio de escrita no registro", () => {
    for (const papel of ["anon", "authenticated", "service_role"]) {
      for (const privilegio of ["insert", "update", "delete", "truncate"]) {
        expect(
          sql(`
            select case when to_regrole('${papel}') is null then 'sem-role'
                        when has_table_privilege('${papel}', 'public.modulo_secoes_lgpd', '${privilegio}')
                          then 'exposta'
                        else 'fechada' end;
          `),
          `modulo_secoes_lgpd com ${privilegio} para ${papel}`,
        ).toBe("fechada");
      }
    }
  });

  it("o service_role não consegue declarar uma seção apontando para api_audit_log", () => {
    const erro = tentar(`
      set role service_role;
      insert into public.modulo_secoes_lgpd (modulo, tabela, ligacao, colunas)
        values ('sonda_intrusa', 'api_audit_log', 'true', '{action}');
    `);
    expect(erro, "o service_role gravou uma seção no registro").toMatch(/permission denied/i);
    // Controle: a recusa foi de permissão, e nada entrou.
    expect(sql(`select count(*) from public.modulo_secoes_lgpd where modulo = 'sonda_intrusa';`)).toBe("0");
  });
});
