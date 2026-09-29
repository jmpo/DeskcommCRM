import { beforeAll, describe, expect, it } from "vitest";

import {
  GOV_ADMIN,
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
 * A TRILHA E AS VERSÕES DE FOLLOW-UP TÊM RLS POR OPERAÇÃO (issue #1915, migration 0490).
 *
 * `followup_enrollment_events` (a trilha de uma inscrição) e `followup_flow_versions`
 * (as versões publicadas, base do rollback) tinham UMA policy `for all`, USING =
 * membro, sem papel mínimo: pelo PostgREST um `viewer` apagava ou reescrevia o
 * histórico. Continuação da 0489 (`followup-rls-por-operacao.test.ts`).
 *
 * A escrita agora espelha quem escreve pela SESSÃO:
 * - trilha: INSERT `manager` (as rotas de intervenção gravam o evento manual);
 *   UPDATE/DELETE sem policy — append-only para a equipe, só o motor reescreve;
 * - versões: DELETE `manager` (DELETE do fluxo); INSERT/UPDATE sem policy — a
 *   versão nasce só por `fn_publish_followup_flow_version` (definer, service_role).
 *
 * Os casos com ⭐ são os que a policy `for all` deixava passar.
 */
const ORG_B = "cccccccc-1915-4000-8000-00000000000b";
const CONTATO_B = "cccccccc-1915-4000-8000-0000000000cb";
const CONTATO_A = "cccccccc-1915-4000-8000-0000000000ca";
const VERSAO = "cccccccc-1915-4000-8000-000000000001";
const VERSAO_DESCARTE = "cccccccc-1915-4000-8000-000000000002";
const VERSAO_B = "cccccccc-1915-4000-8000-00000000000c";
const FLUXO = "cccccccc-1915-4000-8000-000000000003";
const FLUXO_B = "cccccccc-1915-4000-8000-00000000000d";
const INSCRICAO = "cccccccc-1915-4000-8000-000000000011";
const INSCRICAO_B = "cccccccc-1915-4000-8000-000000000013";
const EVENTO = "cccccccc-1915-4000-8000-000000000021";
const EVENTO_B = "cccccccc-1915-4000-8000-000000000023";
// Marca dos eventos que o próprio teste insere, para limpar numa nova rodada.
const MARCA = "rls-1915";

function existe(tabela: string, id: string): boolean {
  return lastLine(sql(`select exists(select 1 from public.${tabela} where id = '${id}')::text;`)) === "true";
}

/** Evento SEM idempotency_key: a guarda de geração não se mete, só a RLS decide. */
function eventoNovo(org: string, inscricao: string): string {
  return `insert into public.followup_enrollment_events (organization_id, enrollment_id, node_id, event_type, payload)
    values ('${org}', '${inscricao}', 'start', 'cancelled_manual', '{"marca":"${MARCA}"}'::jsonb)`;
}

function versaoNova(org: string): string {
  return `insert into public.followup_flow_versions (organization_id, graph) values ('${org}', '{"marca":"${MARCA}"}'::jsonb)`;
}

beforeAll(() => {
  seedGov();
  // Inscrições pausadas (sem relógio): não entram no lote de nenhum tick de outro arquivo.
  sql(`
    delete from public.followup_enrollment_events where payload->>'marca' = '${MARCA}';
    delete from public.followup_flow_versions where graph->>'marca' = '${MARCA}';

    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_B}', 'followup-rls-1915-b', 'Followup RLS 1915 B', 'Followup RLS 1915 B')
      on conflict (id) do nothing;
    insert into public.contacts (id, organization_id, display_name) values
      ('${CONTATO_A}', '${GOV_ORG}', 'Followup RLS 1915 contato A'),
      ('${CONTATO_B}', '${ORG_B}', 'Followup RLS 1915 contato B')
      on conflict (id) do nothing;
    insert into public.followup_flow_versions (id, organization_id, graph) values
      ('${VERSAO}', '${GOV_ORG}', '{}'::jsonb),
      ('${VERSAO_DESCARTE}', '${GOV_ORG}', '{}'::jsonb),
      ('${VERSAO_B}', '${ORG_B}', '{}'::jsonb)
      on conflict (id) do nothing;
    insert into public.followup_flow_pointers (id, organization_id, name, status, active_version_id) values
      ('${FLUXO}', '${GOV_ORG}', 'rls-1915 fluxo', 'active', '${VERSAO}'),
      ('${FLUXO_B}', '${ORG_B}', 'rls-1915 fluxo B', 'active', '${VERSAO_B}')
      on conflict (id) do nothing;
    insert into public.followup_enrollments (id, organization_id, pointer_id, version_id, contact_id, current_node_id, status) values
      ('${INSCRICAO}', '${GOV_ORG}', '${FLUXO}', '${VERSAO}', '${CONTATO_A}', 'start', 'paused_handoff'),
      ('${INSCRICAO_B}', '${ORG_B}', '${FLUXO_B}', '${VERSAO_B}', '${CONTATO_B}', 'start', 'paused_handoff')
      on conflict (id) do nothing;
    insert into public.followup_enrollment_events (id, organization_id, enrollment_id, node_id, event_type, payload) values
      ('${EVENTO}', '${GOV_ORG}', '${INSCRICAO}', 'start', 'paused_manual', '{}'::jsonb),
      ('${EVENTO_B}', '${ORG_B}', '${INSCRICAO_B}', 'start', 'paused_manual', '{}'::jsonb)
      on conflict (id) do nothing;
  `);
});

describe("viewer e agent leem, mas não escrevem", () => {
  for (const [papel, usuario] of [
    ["viewer", GOV_VIEWER],
    ["agent", GOV_AGENT_A],
  ] as const) {
    it(`⭐ ${papel} não apaga nem reescreve a trilha`, () => {
      expect(writeCountAs(usuario, `delete from public.followup_enrollment_events where id = '${EVENTO}'`)).toBe(0);
      expect(
        writeCountAs(usuario, `update public.followup_enrollment_events set event_type = 'cancelled_manual' where id = '${EVENTO}'`),
      ).toBe(0);
      expect(lastLine(sql(`select event_type from public.followup_enrollment_events where id = '${EVENTO}';`))).toBe(
        "paused_manual",
      );
    });

    it(`⭐ ${papel} não grava evento na trilha`, () => {
      expect(writeCountAs(usuario, eventoNovo(GOV_ORG, INSCRICAO))).toBe(0);
    });

    it(`⭐ ${papel} não apaga, não altera nem cria versão de fluxo`, () => {
      expect(writeCountAs(usuario, `delete from public.followup_flow_versions where id = '${VERSAO_DESCARTE}'`)).toBe(0);
      expect(
        writeCountAs(usuario, `update public.followup_flow_versions set graph = '{"x":1}'::jsonb where id = '${VERSAO}'`),
      ).toBe(0);
      expect(writeCountAs(usuario, versaoNova(GOV_ORG))).toBe(0);
      expect(existe("followup_flow_versions", VERSAO_DESCARTE)).toBe(true);
      expect(lastLine(sql(`select graph::text from public.followup_flow_versions where id = '${VERSAO}';`))).toBe("{}");
    });

    it(`${papel} lê a trilha e as versões (os GETs são viewer) — controle positivo`, () => {
      expect(countAs(usuario, `select count(*) from public.followup_enrollment_events where id = '${EVENTO}';`)).toBe(1);
      expect(countAs(usuario, `select count(*) from public.followup_flow_versions where id = '${VERSAO}';`)).toBe(1);
    });
  }
});

describe("a trilha é append-only para a equipe inteira", () => {
  for (const [papel, usuario] of [
    ["manager", GOV_MANAGER],
    ["admin", GOV_ADMIN],
  ] as const) {
    it(`⭐ ${papel} não apaga nem reescreve evento; também não cria nem altera versão`, () => {
      expect(writeCountAs(usuario, `delete from public.followup_enrollment_events where id = '${EVENTO}'`)).toBe(0);
      expect(
        writeCountAs(usuario, `update public.followup_enrollment_events set event_type = 'cancelled_manual' where id = '${EVENTO}'`),
      ).toBe(0);
      expect(writeCountAs(usuario, versaoNova(GOV_ORG))).toBe(0);
      expect(
        writeCountAs(usuario, `update public.followup_flow_versions set graph = '{"x":1}'::jsonb where id = '${VERSAO}'`),
      ).toBe(0);
      expect(lastLine(sql(`select event_type from public.followup_enrollment_events where id = '${EVENTO}';`))).toBe(
        "paused_manual",
      );
      expect(lastLine(sql(`select graph::text from public.followup_flow_versions where id = '${VERSAO}';`))).toBe("{}");
    });
  }
});

describe("ninguém toca outra organização", () => {
  it("manager da org A não lê, não grava nem apaga na trilha e nas versões da org B", () => {
    expect(countAs(GOV_MANAGER, `select count(*) from public.followup_enrollment_events where id = '${EVENTO_B}';`)).toBe(0);
    expect(countAs(GOV_MANAGER, `select count(*) from public.followup_flow_versions where id = '${VERSAO_B}';`)).toBe(0);
    expect(writeCountAs(GOV_MANAGER, eventoNovo(ORG_B, INSCRICAO_B))).toBe(0);
    expect(writeCountAs(GOV_MANAGER, `delete from public.followup_flow_versions where id = '${VERSAO_B}'`)).toBe(0);
    expect(existe("followup_flow_versions", VERSAO_B)).toBe(true);
  });
});

describe("manager faz o que as rotas fazem — controle positivo", () => {
  it("grava o evento manual da intervenção e apaga a versão (DELETE do fluxo)", () => {
    expect(writeCountAs(GOV_MANAGER, eventoNovo(GOV_ORG, INSCRICAO))).toBe(1);
    expect(writeCountAs(GOV_MANAGER, `delete from public.followup_flow_versions where id = '${VERSAO_DESCARTE}'`)).toBe(1);
    expect(existe("followup_flow_versions", VERSAO_DESCARTE)).toBe(false);
  });
});
