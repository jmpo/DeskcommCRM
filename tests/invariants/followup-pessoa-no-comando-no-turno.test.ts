/**
 * PESSOA NO COMANDO NA HORA DO TURNO DO FLUXO — contra o Postgres do baseline.
 *
 * ## O defeito
 *
 * Numa instalação real (06/10/2026), a equipe assumiu à mão uma conversa que a
 * IA tinha devolvido, e o passo de IA do remarketing — inscrito antes — falou
 * por cima da pessoa uma hora depois. A política de handoff do fluxo
 * (`handoff_policy`) só reagia ao EVENTO `ai.handoff_triggered`; assumir pela
 * tela não o emite, e o turno não olhava quem está no comando.
 *
 * ## O que este arquivo prende
 *
 * `aplicarPessoaNoComandoAoTurno` aplica a MESMA política na hora do turno, com
 * a mesma régua da varredura de silêncio (conversa `assignee_kind='user'`,
 * contato `force_human`, IA silenciada agora):
 * - `pause` → `paused_handoff` + evento `handoff_paused`;
 * - `cancel` → `cancelled`, `outcome='handoff'`, motivo `pessoa_no_comando`;
 * - `allow`, ninguém no comando ou inscrição em outro nó → nada muda;
 * - idempotente por ocupação do nó: a segunda chamada não grava nem muda nada.
 *
 * O SQL (CTE com INSERT + UPDATE condicional) só se prova aqui, no banco.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { aplicarPessoaNoComandoAoTurno } from "@/lib/followup/pessoa-no-comando-no-turno";
import { flowGraphSchema } from "@/lib/followup/graph-schema";

import { criarOrigemDeFollowup } from "./followup-service-origin";

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 4,
});

const ORG = "c0de0601-face-4000-8000-000000000001";
const PESSOA = "c0de0601-face-4000-8000-0000000000a1";
const NO = "a1";

const GRAFO = flowGraphSchema.parse({
  nodes: [
    { id: "t1", type: "trigger", label: "Start", position: { x: 0, y: 0 }, config: {} },
    { id: NO, type: "action", label: "IA", position: { x: 0, y: 0 }, config: { mode: "ai_message", prompt_hint: "retome" } },
    { id: "e1", type: "end", label: "Fim", position: { x: 0, y: 0 }, config: { outcome: "converted" } },
  ],
  edges: [
    { id: "t1-a1", source: "t1", target: NO, priority: 0, condition: { type: "always" } },
    { id: "a1-e1", source: NO, target: "e1", priority: 0, condition: { type: "always" } },
  ],
});

beforeAll(async () => {
  await pool.query(`insert into auth.users (id, email) values ($1, 'pessoa-no-comando@invariant.test') on conflict (id) do nothing`, [PESSOA]);
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name) values ($1, 'pessoa-no-comando', 'Pessoa no comando', 'Pessoa no comando') on conflict (id) do nothing`,
    [ORG],
  );
  await pool.query(
    `insert into user_organizations (user_id, organization_id, role) values ($1, $2, 'agent') on conflict do nothing`,
    [PESSOA, ORG],
  );
});

afterAll(async () => {
  await pool.end();
});

type Comando = "assumida" | "force_human" | "silenciada" | "ninguem";

async function cenario(politica: "pause" | "cancel" | "allow", comando: Comando) {
  const { rows: c } = await pool.query<{ id: string }>(
    `insert into contacts (organization_id, display_name, force_human) values ($1, 'Cliente', $2) returning id`,
    [ORG, comando === "force_human"],
  );
  const contato = c[0]!.id;
  const origem = await criarOrigemDeFollowup(pool, ORG, contato);
  if (comando === "assumida") {
    await pool.query(
      `update conversations set assignee_kind = 'user', assigned_to_user_id = $3 where organization_id = $1 and id = $2`,
      [ORG, origem.conversation_id, PESSOA],
    );
  }
  if (comando === "silenciada") {
    await pool.query(
      `update conversations set bot_silenced_until = now() + interval '1 hour' where organization_id = $1 and id = $2`,
      [ORG, origem.conversation_id],
    );
  }
  const { rows: v } = await pool.query<{ id: string }>(
    `insert into followup_flow_versions (organization_id, graph) values ($1, $2) returning id`,
    [ORG, JSON.stringify(GRAFO)],
  );
  const { rows: p } = await pool.query<{ id: string }>(
    `insert into followup_flow_pointers (organization_id, name, status, active_version_id, handoff_policy, trigger_config)
     values ($1, $2, 'active', $3, $4, '{"kind":"manual"}'::jsonb) returning id`,
    [ORG, `Fluxo ${Math.random()}`, v[0]!.id, politica],
  );
  const { rows: e } = await pool.query<{ id: string }>(
    `insert into followup_enrollments
       (organization_id, pointer_id, version_id, contact_id, current_node_id, status, next_eval_at, steps_taken, conversation_id, service_boundary)
     values ($1, $2, $3, $4, $5, 'active', now() + interval '1 hour', 3, $6, $7::jsonb) returning id`,
    [ORG, p[0]!.id, v[0]!.id, contato, NO, origem.conversation_id, JSON.stringify(origem)],
  );
  return { inscricao: e[0]!.id, conversa: origem.conversation_id };
}

async function inscricao(id: string) {
  const { rows } = await pool.query(
    `select status, outcome, cancel_reason, next_eval_at, completed_at from followup_enrollments where organization_id = $1 and id = $2`,
    [ORG, id],
  );
  return rows[0] as { status: string; outcome: string | null; cancel_reason: string | null; next_eval_at: Date | null; completed_at: Date | null };
}

async function eventos(id: string) {
  const { rows } = await pool.query<{ event_type: string; idempotency_key: string; payload: Record<string, unknown> }>(
    `select event_type, idempotency_key, payload from followup_enrollment_events where enrollment_id = $1 order by created_at`,
    [id],
  );
  return rows;
}

const aplicar = (s: { inscricao: string; conversa: string }, no = NO) =>
  aplicarPessoaNoComandoAoTurno(pool, { organizationId: ORG, enrollmentId: s.inscricao, nodeId: no, conversationId: s.conversa }, new Date());

describe("a política de handoff do fluxo na hora do turno, com uma pessoa no comando", () => {
  it("conversa assumida + política pause: a inscrição pausa, com o evento que a retomada lê", async () => {
    const s = await cenario("pause", "assumida");
    expect(await aplicar(s)).toBe("pausada");
    const e = await inscricao(s.inscricao);
    expect(e.status).toBe("paused_handoff");
    expect(e.next_eval_at, "pausada não pode ter próxima avaliação").toBeNull();
    const ev = await eventos(s.inscricao);
    expect(ev.map((x) => x.event_type)).toEqual(["handoff_paused"]);
    expect(ev[0]!.payload).toMatchObject({ prior_status: "active", reason: "pessoa_no_comando" });
    expect(ev[0]!.idempotency_key).toBe(`pessoa_no_comando:${NO}:3`);
  });

  it("conversa assumida + política cancel: a inscrição termina como handoff", async () => {
    const s = await cenario("cancel", "assumida");
    expect(await aplicar(s)).toBe("cancelada");
    const e = await inscricao(s.inscricao);
    expect(e).toMatchObject({ status: "cancelled", outcome: "handoff", cancel_reason: "pessoa_no_comando" });
    expect(e.completed_at).not.toBeNull();
    expect((await eventos(s.inscricao)).map((x) => x.event_type)).toEqual(["reactivity_handoff_cancel"]);
  });

  it("contato em force_human e IA silenciada contam como pessoa no comando", async () => {
    const a = await cenario("pause", "force_human");
    expect(await aplicar(a)).toBe("pausada");
    const b = await cenario("pause", "silenciada");
    expect(await aplicar(b)).toBe("pausada");
  });

  it("política allow: o fluxo segue, nada muda", async () => {
    const s = await cenario("allow", "assumida");
    expect(await aplicar(s)).toBeNull();
    expect((await inscricao(s.inscricao)).status).toBe("active");
    expect(await eventos(s.inscricao)).toEqual([]);
  });

  it("controle: ninguém no comando, nada muda", async () => {
    const s = await cenario("pause", "ninguem");
    expect(await aplicar(s)).toBeNull();
    expect((await inscricao(s.inscricao)).status).toBe("active");
    expect(await eventos(s.inscricao)).toEqual([]);
  });

  it("turno de outro nó não mexe na inscrição", async () => {
    const s = await cenario("pause", "assumida");
    expect(await aplicar(s, "outro-no")).toBeNull();
    expect((await inscricao(s.inscricao)).status).toBe("active");
  });

  it("idempotente: a segunda chamada não grava outro evento nem muda o estado", async () => {
    const s = await cenario("pause", "assumida");
    expect(await aplicar(s)).toBe("pausada");
    expect(await aplicar(s)).toBeNull();
    expect((await eventos(s.inscricao)).length).toBe(1);
    expect((await inscricao(s.inscricao)).status).toBe("paused_handoff");
  });
});
