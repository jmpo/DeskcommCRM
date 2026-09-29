import { beforeAll, describe, expect, it } from "vitest";

import {
  GOV_AGENT_A,
  GOV_MANAGER,
  GOV_ORG,
  GOV_VIEWER,
  countAs,
  lastLine,
  seedGov,
  sql,
  writeCountAs,
} from "./gov-helpers";

/**
 * A RLS DE FOLLOW-UP É POR OPERAÇÃO (issue #1913, migration 0489).
 *
 * `followup_enrollments` e `followup_flow_pointers` tinham UMA policy `for all`,
 * USING = membro da organização, sem papel mínimo. Pelo PostgREST — o JWT da
 * sessão fala com ele direto, sem rota — `viewer` e `agent` apagavam a inscrição
 * (e, pela cascata, a trilha e os turnos agendados) ou o fluxo inteiro. O PR
 * #1912 tira a única coisa que barrava isso por acidente (a guarda de geração
 * recusando a cascata), então a trava tem de estar na policy.
 *
 * Agora a escrita espelha as rotas: toda rota que escreve nestas tabelas pela
 * sessão exige `manager`. Os casos com ⭐ são os que a policy `for all` deixava
 * passar.
 */
const ORG_B = "cccccccc-1913-4000-8000-00000000000b";
const CONTATO_B = "cccccccc-1913-4000-8000-0000000000cb";
const VERSAO = "cccccccc-1913-4000-8000-000000000001";
const FLUXO = "cccccccc-1913-4000-8000-000000000002";
const FLUXO_DESCARTE = "cccccccc-1913-4000-8000-000000000003";
const VERSAO_B = "cccccccc-1913-4000-8000-00000000000c";
const FLUXO_B = "cccccccc-1913-4000-8000-00000000000d";
const INSCRICAO = "cccccccc-1913-4000-8000-000000000011";
const INSCRICAO_DESCARTE = "cccccccc-1913-4000-8000-000000000012";
const INSCRICAO_B = "cccccccc-1913-4000-8000-000000000013";
const PREFIXO_CRIADO = "rls-1913-criado";
// Contatos próprios: a vaga viva é UMA por contato na organização inteira
// (`idx_followup_enrollments_one_live`), e os contatos do seedGov são de todos.
const CONTATO_1 = "cccccccc-1913-4000-8000-0000000000c1";
const CONTATO_2 = "cccccccc-1913-4000-8000-0000000000c2";
const CONTATO_3 = "cccccccc-1913-4000-8000-0000000000c3";
const CONTATO_4 = "cccccccc-1913-4000-8000-0000000000c4";

function existe(tabela: string, id: string): boolean {
  return lastLine(sql(`select exists(select 1 from public.${tabela} where id = '${id}')::text;`)) === "true";
}

function inscricaoNova(org: string, fluxo: string, versao: string, contato: string): string {
  return `insert into public.followup_enrollments (organization_id, pointer_id, version_id, contact_id, current_node_id, status)
    values ('${org}', '${fluxo}', '${versao}', '${contato}', 'start', 'paused_handoff')`;
}

beforeAll(() => {
  seedGov();
  // Pausadas (sem relógio): não entram no lote de nenhum tick de outro arquivo.
  sql(`
    delete from public.followup_flow_pointers where name like '${PREFIXO_CRIADO}%';
    delete from public.followup_enrollments where contact_id in ('${CONTATO_3}', '${CONTATO_4}');

    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_B}', 'followup-rls-b', 'Followup RLS B', 'Followup RLS B')
      on conflict (id) do nothing;
    insert into public.contacts (id, organization_id, display_name) values
      ('${CONTATO_1}', '${GOV_ORG}', 'Followup RLS contato 1'),
      ('${CONTATO_2}', '${GOV_ORG}', 'Followup RLS contato 2'),
      ('${CONTATO_3}', '${GOV_ORG}', 'Followup RLS contato 3'),
      ('${CONTATO_4}', '${GOV_ORG}', 'Followup RLS contato 4'),
      ('${CONTATO_B}', '${ORG_B}', 'Followup RLS contato B')
      on conflict (id) do nothing;
    insert into public.followup_flow_versions (id, organization_id, graph) values
      ('${VERSAO}', '${GOV_ORG}', '{}'::jsonb),
      ('${VERSAO_B}', '${ORG_B}', '{}'::jsonb)
      on conflict (id) do nothing;
    insert into public.followup_flow_pointers (id, organization_id, name, status, active_version_id) values
      ('${FLUXO}', '${GOV_ORG}', 'rls-1913 fluxo', 'active', '${VERSAO}'),
      ('${FLUXO_DESCARTE}', '${GOV_ORG}', 'rls-1913 descarte', 'draft', null),
      ('${FLUXO_B}', '${ORG_B}', 'rls-1913 fluxo B', 'active', '${VERSAO_B}')
      on conflict (id) do nothing;
    insert into public.followup_enrollments (id, organization_id, pointer_id, version_id, contact_id, current_node_id, status) values
      ('${INSCRICAO}', '${GOV_ORG}', '${FLUXO}', '${VERSAO}', '${CONTATO_1}', 'start', 'paused_handoff'),
      ('${INSCRICAO_DESCARTE}', '${GOV_ORG}', '${FLUXO}', '${VERSAO}', '${CONTATO_2}', 'start', 'paused_handoff'),
      ('${INSCRICAO_B}', '${ORG_B}', '${FLUXO_B}', '${VERSAO_B}', '${CONTATO_B}', 'start', 'paused_handoff')
      on conflict (id) do nothing;
  `);
});

describe("viewer e agent leem, mas não escrevem", () => {
  for (const [papel, usuario] of [
    ["viewer", GOV_VIEWER],
    ["agent", GOV_AGENT_A],
  ] as const) {
    it(`⭐ ${papel} não apaga a inscrição nem o fluxo`, () => {
      expect(writeCountAs(usuario, `delete from public.followup_enrollments where id = '${INSCRICAO}'`)).toBe(0);
      expect(writeCountAs(usuario, `delete from public.followup_flow_pointers where id = '${FLUXO}'`)).toBe(0);
      expect(existe("followup_enrollments", INSCRICAO)).toBe(true);
      expect(existe("followup_flow_pointers", FLUXO)).toBe(true);
    });

    it(`⭐ ${papel} não cancela a inscrição nem desliga o fluxo`, () => {
      expect(
        writeCountAs(
          usuario,
          `update public.followup_enrollments set status = 'cancelled', cancel_reason = 'rls-1913', completed_at = now() where id = '${INSCRICAO}'`,
        ),
      ).toBe(0);
      expect(writeCountAs(usuario, `update public.followup_flow_pointers set status = 'disabled' where id = '${FLUXO}'`)).toBe(0);
      expect(lastLine(sql(`select status from public.followup_enrollments where id = '${INSCRICAO}';`))).toBe("paused_handoff");
      expect(lastLine(sql(`select status from public.followup_flow_pointers where id = '${FLUXO}';`))).toBe("active");
    });

    it(`⭐ ${papel} não inscreve contato nem cria fluxo`, () => {
      expect(writeCountAs(usuario, inscricaoNova(GOV_ORG, FLUXO, VERSAO, CONTATO_4))).toBe(0);
      expect(
        writeCountAs(usuario, `insert into public.followup_flow_pointers (organization_id, name) values ('${GOV_ORG}', '${PREFIXO_CRIADO}-${papel}')`),
      ).toBe(0);
    });

    it(`${papel} lê (os GETs são viewer) — controle positivo`, () => {
      expect(countAs(usuario, `select count(*) from public.followup_enrollments where id = '${INSCRICAO}';`)).toBe(1);
      expect(countAs(usuario, `select count(*) from public.followup_flow_pointers where id = '${FLUXO}';`)).toBe(1);
    });
  }
});

describe("ninguém toca outra organização", () => {
  it("manager da org A não lê, não altera, não apaga nem inscreve na org B", () => {
    expect(countAs(GOV_MANAGER, `select count(*) from public.followup_enrollments where id = '${INSCRICAO_B}';`)).toBe(0);
    expect(countAs(GOV_MANAGER, `select count(*) from public.followup_flow_pointers where id = '${FLUXO_B}';`)).toBe(0);
    expect(writeCountAs(GOV_MANAGER, `update public.followup_enrollments set cancel_reason = 'rls-1913' where id = '${INSCRICAO_B}'`)).toBe(0);
    expect(writeCountAs(GOV_MANAGER, `delete from public.followup_enrollments where id = '${INSCRICAO_B}'`)).toBe(0);
    expect(writeCountAs(GOV_MANAGER, `delete from public.followup_flow_pointers where id = '${FLUXO_B}'`)).toBe(0);
    expect(writeCountAs(GOV_MANAGER, inscricaoNova(ORG_B, FLUXO_B, VERSAO_B, CONTATO_B))).toBe(0);
    expect(existe("followup_enrollments", INSCRICAO_B)).toBe(true);
    expect(existe("followup_flow_pointers", FLUXO_B)).toBe(true);
  });
});

describe("manager escreve (as rotas são manager) — controle positivo", () => {
  it("inscreve, altera, apaga a inscrição; cria, altera e apaga o fluxo", () => {
    expect(writeCountAs(GOV_MANAGER, inscricaoNova(GOV_ORG, FLUXO, VERSAO, CONTATO_3))).toBe(1);
    expect(writeCountAs(GOV_MANAGER, `update public.followup_enrollments set cancel_reason = 'rls-1913' where id = '${INSCRICAO}'`)).toBe(1);
    expect(writeCountAs(GOV_MANAGER, `delete from public.followup_enrollments where id = '${INSCRICAO_DESCARTE}'`)).toBe(1);

    expect(
      writeCountAs(GOV_MANAGER, `insert into public.followup_flow_pointers (organization_id, name) values ('${GOV_ORG}', '${PREFIXO_CRIADO}-manager')`),
    ).toBe(1);
    expect(writeCountAs(GOV_MANAGER, `update public.followup_flow_pointers set name = 'rls-1913 fluxo renomeado' where id = '${FLUXO}'`)).toBe(1);
    expect(writeCountAs(GOV_MANAGER, `delete from public.followup_flow_pointers where id = '${FLUXO_DESCARTE}'`)).toBe(1);
  });
});
