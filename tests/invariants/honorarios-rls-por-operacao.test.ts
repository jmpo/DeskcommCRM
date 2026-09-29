import { beforeAll, describe, expect, it } from "vitest";

import {
  GOV_AGENT_A,
  GOV_MANAGER,
  GOV_ORG,
  GOV_VIEWER,
  lastLine,
  seedGov,
  sql,
  writeCountAs,
} from "./gov-helpers";

/**
 * A RLS DE HONORÁRIOS É POR OPERAÇÃO (revisão do #1578, migration 0480).
 *
 * A policy nasceu UMA só, `for all`, com USING = membro da organização e
 * WITH CHECK = manager+. DELETE só avalia o USING, e o baseline dá GRANT ALL a
 * `authenticated`: pelo PostgREST — que fala com o JWT da sessão direto, sem
 * rota nenhuma (ver 0150) — `viewer` e `agent` apagavam o contrato (e, pelo
 * `on delete cascade`, as parcelas dele) ou uma parcela já paga.
 *
 * Agora a escrita espelha as rotas: criar é `manager` (POST de contrato e de
 * parcela), e editar e apagar também. Parcela paga não se apaga nem se
 * reescreve pela sessão, nem o contrato que a tem; e a sessão não marca
 * parcela como paga — isso só `fn_honorarios_parcela_pagar`, que lança o caixa
 * junto. Os casos com ⭐ são os que a policy `for all` deixava passar, pela
 * regra dela (USING = membro); o "antes" não foi executado neste arquivo.
 */
const ORG_B = "cccccccc-9999-4000-8000-00000000d0b0";
const CONTRATO = "cccccccc-9999-4000-8000-00000000d001";
const CONTRATO_COM_PAGA = "cccccccc-9999-4000-8000-00000000d002";
const CONTRATO_DESCARTE = "cccccccc-9999-4000-8000-00000000d003";
const CONTRATO_OUTRA_ORG = "cccccccc-9999-4000-8000-00000000d004";
const PENDENTE = "cccccccc-9999-4000-8000-00000000d011";
const PAGA = "cccccccc-9999-4000-8000-00000000d012";
const PENDENTE_DESCARTE = "cccccccc-9999-4000-8000-00000000d013";

function existe(tabela: string, id: string): boolean {
  return lastLine(sql(`select exists(select 1 from public.${tabela} where id = '${id}')::text;`)) === "true";
}

function statusDa(parcela: string): string {
  return lastLine(sql(`select status from public.honorarios_parcelas where id = '${parcela}';`));
}

beforeAll(() => {
  seedGov();
  sql(`
    select public.fn_honorarios_provisionar();

    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_B}', 'honorarios-rls-b', 'Honorarios RLS B', 'Hon RLS B')
      on conflict (id) do nothing;
    insert into public.honorarios_contratos (id, organization_id, modelo, valor_fixo_cents) values
      ('${CONTRATO}', '${GOV_ORG}', 'fixo', 300000),
      ('${CONTRATO_COM_PAGA}', '${GOV_ORG}', 'fixo', 300000),
      ('${CONTRATO_DESCARTE}', '${GOV_ORG}', 'fixo', 300000),
      ('${CONTRATO_OUTRA_ORG}', '${ORG_B}', 'fixo', 300000)
      on conflict (id) do nothing;
    insert into public.honorarios_parcelas (id, organization_id, contrato_id, numero, vencimento, valor_cents, status) values
      ('${PENDENTE}', '${GOV_ORG}', '${CONTRATO}', 1, '2026-10-01', 100000, 'pendente'),
      ('${PENDENTE_DESCARTE}', '${GOV_ORG}', '${CONTRATO}', 2, '2026-11-01', 100000, 'pendente'),
      ('${PAGA}', '${GOV_ORG}', '${CONTRATO_COM_PAGA}', 1, '2026-10-01', 100000, 'pago')
      on conflict (id) do nothing;
  `);
});

describe("viewer e agent não apagam nada", () => {
  for (const [papel, usuario] of [
    ["viewer", GOV_VIEWER],
    ["agent", GOV_AGENT_A],
  ] as const) {
    it(`⭐ ${papel} não apaga contrato, nem parcela pendente, nem parcela paga`, () => {
      expect(writeCountAs(usuario, `delete from public.honorarios_contratos where id = '${CONTRATO}'`)).toBe(0);
      expect(writeCountAs(usuario, `delete from public.honorarios_contratos where id = '${CONTRATO_COM_PAGA}'`)).toBe(0);
      expect(writeCountAs(usuario, `delete from public.honorarios_parcelas where id = '${PENDENTE}'`)).toBe(0);
      expect(writeCountAs(usuario, `delete from public.honorarios_parcelas where id = '${PAGA}'`)).toBe(0);

      expect(existe("honorarios_contratos", CONTRATO)).toBe(true);
      expect(existe("honorarios_contratos", CONTRATO_COM_PAGA)).toBe(true);
      expect(existe("honorarios_parcelas", PENDENTE)).toBe(true);
      expect(existe("honorarios_parcelas", PAGA)).toBe(true);
    });

    it(`${papel} não cria nem edita`, () => {
      expect(
        writeCountAs(usuario, `insert into public.honorarios_contratos (organization_id, modelo, valor_fixo_cents) values ('${GOV_ORG}', 'fixo', 1)`),
      ).toBe(0);
      expect(writeCountAs(usuario, `update public.honorarios_parcelas set valor_cents = 1 where id = '${PENDENTE}'`)).toBe(0);
    });

    it(`${papel} lê (GET é viewer) — controle positivo`, () => {
      expect(
        Number(
          lastLine(
            sql(`
              set role authenticated;
              select set_config('request.jwt.claims', '{"sub":"${usuario}"}', false);
              select count(*) from public.honorarios_parcelas where id in ('${PENDENTE}', '${PAGA}');
            `),
          ),
        ),
      ).toBe(2);
    });
  }
});

describe("parcela paga: nem manager apaga ou reescreve pela sessão", () => {
  it("⭐ manager não apaga a parcela paga nem o contrato que a tem", () => {
    expect(writeCountAs(GOV_MANAGER, `delete from public.honorarios_parcelas where id = '${PAGA}'`)).toBe(0);
    expect(writeCountAs(GOV_MANAGER, `delete from public.honorarios_contratos where id = '${CONTRATO_COM_PAGA}'`)).toBe(0);
    expect(existe("honorarios_parcelas", PAGA)).toBe(true);
    expect(existe("honorarios_contratos", CONTRATO_COM_PAGA)).toBe(true);
  });

  it("⭐ manager não devolve a paga para pendente (seria pagar duas vezes)", () => {
    expect(writeCountAs(GOV_MANAGER, `update public.honorarios_parcelas set status = 'pendente' where id = '${PAGA}'`)).toBe(0);
    expect(statusDa(PAGA)).toBe("pago");
  });

  it("⭐ manager não marca parcela como paga à mão (sem lançamento no caixa)", () => {
    expect(writeCountAs(GOV_MANAGER, `update public.honorarios_parcelas set status = 'pago' where id = '${PENDENTE}'`)).toBe(0);
    expect(
      writeCountAs(
        GOV_MANAGER,
        `insert into public.honorarios_parcelas (organization_id, contrato_id, numero, vencimento, valor_cents, status) values ('${GOV_ORG}', '${CONTRATO}', 9, '2026-12-01', 1, 'pago')`,
      ),
    ).toBe(0);
    expect(statusDa(PENDENTE)).toBe("pendente");
  });

  it("⭐ manager não pendura parcela em contrato de outra organização", () => {
    expect(
      writeCountAs(
        GOV_MANAGER,
        `insert into public.honorarios_parcelas (organization_id, contrato_id, numero, vencimento, valor_cents) values ('${GOV_ORG}', '${CONTRATO_OUTRA_ORG}', 1, '2026-12-01', 1)`,
      ),
    ).toBe(0);
  });
});

describe("manager escreve (as rotas são manager) — controle positivo", () => {
  it("cria contrato e parcela, edita a pendente, apaga a pendente e o contrato sem parcela paga", () => {
    expect(
      writeCountAs(GOV_MANAGER, `insert into public.honorarios_contratos (organization_id, modelo, valor_fixo_cents) values ('${GOV_ORG}', 'fixo', 1)`),
    ).toBe(1);
    expect(
      writeCountAs(
        GOV_MANAGER,
        `insert into public.honorarios_parcelas (organization_id, contrato_id, numero, vencimento, valor_cents) values ('${GOV_ORG}', '${CONTRATO}', 3, '2026-12-01', 1)`,
      ),
    ).toBe(1);
    expect(writeCountAs(GOV_MANAGER, `update public.honorarios_parcelas set status = 'atrasado' where id = '${PENDENTE}'`)).toBe(1);
    expect(writeCountAs(GOV_MANAGER, `delete from public.honorarios_parcelas where id = '${PENDENTE_DESCARTE}'`)).toBe(1);
    expect(writeCountAs(GOV_MANAGER, `delete from public.honorarios_contratos where id = '${CONTRATO_DESCARTE}'`)).toBe(1);
  });
});
