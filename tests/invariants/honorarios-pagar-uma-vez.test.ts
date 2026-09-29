import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { beforeAll, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

/**
 * HONORÁRIOS — UMA PARCELA ENTRA NO CAIXA UMA VEZ SÓ (#1578, migration 0480).
 *
 * `fn_honorarios_parcela_pagar` é o único caminho de pagamento: lê a parcela com
 * `for update`, lança o `financial_entries` e marca a parcela como paga, na mesma
 * transação. Este arquivo mede, no banco de verdade e com o módulo PROVISIONADO:
 *
 *   1. o segundo pagamento da mesma parcela é recusado e não lança nada;
 *   2. dois pagamentos SIMULTÂNEOS (o clique duplo) lançam UMA vez — a segunda
 *      sessão espera o lock da primeira e encontra a parcela já paga;
 *   3. a conta de OUTRA organização é recusada. A função é definer e a conta vem
 *      do corpo da requisição: sem a conferência, a FK aceitaria a conta alheia e
 *      o dinheiro desta organização apareceria no extrato de outra.
 *
 * O caso 2 é o que o FOR UPDATE compra: sem ele as duas sessões leem "pendente"
 * e cada uma lança o seu lançamento.
 */

const ORG_A = "a4a4a4a4-0000-4000-8000-000000000001";
const ORG_B = "a4a4a4a4-0000-4000-8000-000000000002";
const GERENTE = "a4a4a4a4-1111-4000-8000-000000000001";
const CONTA_A = "a4a4a4a4-2222-4000-8000-000000000001";
const CONTA_B = "a4a4a4a4-2222-4000-8000-000000000002";
const CONTRATO = "a4a4a4a4-3333-4000-8000-000000000001";
const PARCELA_SEQ = "a4a4a4a4-4444-4000-8000-000000000001";
const PARCELA_CORRIDA = "a4a4a4a4-4444-4000-8000-000000000002";
const PARCELA_OUTRA_CONTA = "a4a4a4a4-4444-4000-8000-000000000003";

const execFileP = promisify(execFile);
const container = process.env.TEST_DB_CONTAINER ?? "";

const COMO_GERENTE = `
  set role authenticated;
  select set_config('request.jwt.claims', '{"sub":"${GERENTE}","role":"authenticated"}', false);
`;

function pagar(parcela: string, conta: string): string {
  return `select public.fn_honorarios_parcela_pagar('${ORG_A}'::uuid, '${parcela}'::uuid, '${conta}'::uuid)::text;`;
}

/** Uma sessão psql própria, assíncrona — para duas rodarem ao mesmo tempo. */
async function sessao(script: string): Promise<{ ok: boolean; saida: string }> {
  try {
    const { stdout } = await execFileP(
      "docker",
      ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tA", "-c", script],
      { encoding: "utf8" },
    );
    return { ok: true, saida: stdout };
  } catch (erro) {
    const e = erro as { stderr?: string; message?: string };
    return { ok: false, saida: e.stderr ?? e.message ?? "" };
  }
}

function lancamentosDa(parcela: string): number {
  return Number(
    lastLine(
      sql(`
        select count(*) from public.financial_entries fe
         where fe.organization_id = '${ORG_A}'
           and fe.description = (select format('Parcela %s de honorários', numero)
                                   from public.honorarios_parcelas where id = '${parcela}');
      `),
    ),
  );
}

beforeAll(() => {
  sql(`
    select public.fn_honorarios_provisionar();

    insert into auth.users (id, email) values
      ('${GERENTE}', 'honorarios-pagar@invariant.test') on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'honorarios-pagar-a', 'Honorarios Pagar A', 'Hon A'),
      ('${ORG_B}', 'honorarios-pagar-b', 'Honorarios Pagar B', 'Hon B')
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${GERENTE}', '${ORG_A}', 'manager', now()) on conflict do nothing;
    insert into public.financial_accounts (id, organization_id, name) values
      ('${CONTA_A}', '${ORG_A}', 'Caixa A'),
      ('${CONTA_B}', '${ORG_B}', 'Caixa B')
      on conflict (id) do nothing;
    insert into public.honorarios_contratos (id, organization_id, modelo, valor_fixo_cents) values
      ('${CONTRATO}', '${ORG_A}', 'fixo', 300000) on conflict (id) do nothing;
    insert into public.honorarios_parcelas (id, organization_id, contrato_id, numero, vencimento, valor_cents) values
      ('${PARCELA_SEQ}', '${ORG_A}', '${CONTRATO}', 1, '2026-10-01', 100000),
      ('${PARCELA_CORRIDA}', '${ORG_A}', '${CONTRATO}', 2, '2026-11-01', 100000),
      ('${PARCELA_OUTRA_CONTA}', '${ORG_A}', '${CONTRATO}', 3, '2026-12-01', 100000)
      on conflict (id) do nothing;
  `);
});

describe("fn_honorarios_parcela_pagar — uma parcela, um lançamento", () => {
  it("paga uma vez; a segunda chamada é recusada e não lança de novo", () => {
    const primeira = JSON.parse(lastLine(sql(`${COMO_GERENTE} ${pagar(PARCELA_SEQ, CONTA_A)}`)));
    expect(primeira).toMatchObject({ id: PARCELA_SEQ, status: "pago" });
    expect(lancamentosDa(PARCELA_SEQ)).toBe(1);

    expect(() => sql(`${COMO_GERENTE} ${pagar(PARCELA_SEQ, CONTA_A)}`)).toThrow(/parcela_ja_paga/);
    expect(lancamentosDa(PARCELA_SEQ)).toBe(1);
  });

  it("dois pagamentos simultâneos (clique duplo) lançam UMA vez", async () => {
    // A primeira sessão paga e SEGURA a transação aberta; a segunda chega enquanto
    // isso e tem de esperar o lock da linha. Sem o `for update`, as duas leriam
    // "pendente" e lançariam cada uma o seu.
    const primeira = sessao(`begin; ${COMO_GERENTE} ${pagar(PARCELA_CORRIDA, CONTA_A)} select pg_sleep(2); commit;`);
    await new Promise((r) => setTimeout(r, 600));
    const segunda = sessao(`${COMO_GERENTE} ${pagar(PARCELA_CORRIDA, CONTA_A)}`);

    const [r1, r2] = await Promise.all([primeira, segunda]);
    expect(r1.ok, r1.saida).toBe(true);
    expect(r2.ok).toBe(false);
    expect(r2.saida).toMatch(/parcela_ja_paga/);
    expect(lancamentosDa(PARCELA_CORRIDA)).toBe(1);
  });

  it("conta de outra organização é recusada, e nada entra no caixa", () => {
    expect(() => sql(`${COMO_GERENTE} ${pagar(PARCELA_OUTRA_CONTA, CONTA_B)}`)).toThrow(/conta_invalida/);
    expect(lancamentosDa(PARCELA_OUTRA_CONTA)).toBe(0);
    expect(
      lastLine(sql(`select status from public.honorarios_parcelas where id = '${PARCELA_OUTRA_CONTA}';`)),
    ).toBe("pendente");
  });
});
