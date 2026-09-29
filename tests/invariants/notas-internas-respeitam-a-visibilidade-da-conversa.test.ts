/**
 * 0478 — NOTAS INTERNAS: REALTIME E VISIBILIDADE HERDADA DA CONVERSA (#1863).
 *
 * A nota interna (Onda 5.2) já existia de ponta a ponta — tabela, rotas, toggle
 * `Responder | Nota interna`, destaque amarelo. Faltavam duas peças, e este
 * arquivo mede as duas contra o BANCO, não contra o texto do repositório.
 *
 * F1 · a publicação realtime. `supabase_realtime` é uma LISTA EXPLÍCITA
 * (o `foreach` do baseline) e `conversation_notes` não estava em nenhuma. O
 * hook abria o canal, o Supabase respondia `SUBSCRIBED` e nada chegava —
 * falha muda, documentada no próprio docblock de `passagens/route.ts`.
 *
 * F2 · a visibilidade. A policy testava só `fn_user_org_ids()`, enquanto
 * `fn_can_view_conversation` (21 usos) é quem implementa `visibility_mode`
 * (`all` | `own_and_unassigned` — PADRÃO — | `own`). Em `own_and_unassigned`
 * o atendente que NÃO abria a conversa lia as notas sobre ela.
 *
 * O que este arquivo garante (comportamento, não texto):
 *   · quem é dono da conversa lê a nota dela           (controle positivo)
 *   · quem NÃO pode abrir a conversa NÃO lê a nota     (o defeito da F2)
 *   · conversa sem dono continua legível para o agent  (padrão da própria fn)
 *   · viewer/manager/admin continuam vendo tudo        (a fn já devolve true)
 *   · nota de OUTRA organização não vaza               (o `c.organization_id =`)
 *   · a tabela está na publicação                      (o defeito da F1)
 *
 * Molde: `conversation-drafts-rbac-por-papel.test.ts` (mesmos helpers
 * `seedGov`/`countAs`/`sql`). A conversa usada é `GOV_CONV_AGENT_B`,
 * atribuída a `GOV_AGENT_B` — é ela que discrimina: `GOV_AGENT_A` é da mesma
 * organização e do mesmo papel, e só não pode vê-la porque não é o dono.
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  GOV_ADMIN,
  GOV_AGENT_A,
  GOV_AGENT_B,
  GOV_CONTACT_1,
  GOV_CONV_AGENT_B,
  GOV_CONV_UNASSIGNED,
  GOV_MANAGER,
  GOV_ORG,
  GOV_SESSION,
  GOV_VIEWER,
  countAs,
  seedGov,
  sql,
} from "./gov-helpers";

const NOTA_B = "d0d0d0d0-0478-4000-8000-000000000001";
const NOTA_LIVRE = "d0d0d0d0-0478-4000-8000-000000000002";
const NOTA_OUTRA = "d0d0d0d0-0478-4000-8000-000000000003";

const ORG_2 = "d0d0d0d0-0478-4000-8000-000000000010";
const CONV_2 = "d0d0d0d0-0478-4000-8000-000000000011";

const contar = (id: string) =>
  `select count(*) from public.conversation_notes where id = '${id}';`;

beforeAll(() => {
  seedGov();
  // organização paralela: existe só para provar que o `c.organization_id =`
  // da policy nova segura dado legado apontando para conversa de outra org.
  sql(`
    insert into public.organizations (id, slug, display_name, legal_name)
      values ('${ORG_2}', 'org-2-0478', 'outra org', 'outra org')
      on conflict (id) do nothing;
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status)
      values ('${CONV_2}', '${ORG_2}', '${GOV_CONTACT_1}', '${GOV_SESSION}', 'open')
      on conflict (id) do nothing;

    insert into public.conversation_notes
      (id, organization_id, conversation_id, body, created_by_name) values
      ('${NOTA_B}',    '${GOV_ORG}', '${GOV_CONV_AGENT_B}',   'nota na conversa do B', 'seed'),
      ('${NOTA_LIVRE}', '${GOV_ORG}', '${GOV_CONV_UNASSIGNED}', 'nota em conversa livre', 'seed'),
      ('${NOTA_OUTRA}', '${ORG_2}',   '${CONV_2}',             'nota de outra org',     'seed')
      on conflict (id) do nothing;
  `);
});

describe("0478 — a nota acompanha a visibilidade da conversa", () => {
  it("CONTROLE POSITIVO: o dono da conversa lê a nota dela", () => {
    expect(countAs(GOV_AGENT_B, contar(NOTA_B))).toBe(1);
  });

  it("F2: o agent da MESMA org que não é dono NÃO lê a nota", () => {
    // sem a 0478 isto devolve 1 — era exatamente o vazamento
    expect(countAs(GOV_AGENT_A, contar(NOTA_B))).toBe(0);
  });

  it("padrão own_and_unassigned: conversa SEM dono continua legível", () => {
    expect(countAs(GOV_AGENT_A, contar(NOTA_LIVRE))).toBe(1);
  });

  it("viewer/manager/admin continuam vendo (a fn já devolve true)", () => {
    expect(countAs(GOV_VIEWER, contar(NOTA_B))).toBe(1);
    expect(countAs(GOV_MANAGER, contar(NOTA_B))).toBe(1);
    expect(countAs(GOV_ADMIN, contar(NOTA_B))).toBe(1);
  });

  it("nota de OUTRA organização não vaza", () => {
    expect(countAs(GOV_AGENT_A, contar(NOTA_OUTRA))).toBe(0);
    expect(countAs(GOV_MANAGER, contar(NOTA_OUTRA))).toBe(0);
  });
});

describe("0478 — a tabela está na publicação (F1)", () => {
  it("conversation_notes publicada em supabase_realtime", () => {
    const out = sql(`
      select count(*) from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public'
        and tablename = 'conversation_notes';
    `);
    const linha = out.trim().split("\n").pop() ?? "";
    expect(linha).toBe("1");
  });

  it("a policy da nota cita fn_can_view_conversation", () => {
    const out = sql(`
      select count(*) from pg_policies
      where schemaname = 'public' and tablename = 'conversation_notes'
        and policyname = 'conversation_notes_select'
        and qual like '%fn_can_view_conversation%';
    `);
    const linha = out.trim().split("\n").pop() ?? "";
    expect(linha).toBe("1");
  });
});
