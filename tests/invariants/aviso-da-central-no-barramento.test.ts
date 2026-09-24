import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

/**
 * `trg_aviso_da_central_criado` (migration 0405): todo aviso da Central de uma
 * organização anuncia `central.aviso_criado`, para o push decidir o que vai ao
 * celular. Aviso de plataforma não anuncia, e a função não é RPC de ninguém.
 */
const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 2,
});

const ORG = "d0399000-0000-4000-8000-000000000001";

beforeAll(async () => {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1, 'org-0405', 'Avisos LTDA', 'Avisos') on conflict (id) do nothing`,
    [ORG],
  );
});

afterAll(async () => {
  await pool.query("delete from organizations where id = $1", [ORG]);
  await pool.end();
});

describe("aviso da Central → barramento", () => {
  it("aviso da organização vira um evento central.aviso_criado com kind e ref", async () => {
    const { rows } = await pool.query<{ id: string }>(
      `insert into agent_inbox_items (organization_id, kind, severity, title, ref_kind, ref_id)
       values ($1, 'handoff', 'critical', 'Passagem', 'conversation', gen_random_uuid()) returning id`,
      [ORG],
    );
    const { rows: ev } = await pool.query<{ payload: Record<string, unknown> }>(
      `select payload from event_log where organization_id = $1 and event_type = 'central.aviso_criado'
         and entity_id = $2`,
      [ORG, rows[0]!.id],
    );
    expect(ev).toHaveLength(1);
    expect(ev[0]!.payload).toMatchObject({ item_id: rows[0]!.id, kind: "handoff", ref_kind: "conversation" });
  });

  it("aviso de plataforma (organização nula) não anuncia", async () => {
    const { rows } = await pool.query<{ id: string }>(
      `insert into agent_inbox_items (organization_id, kind, severity, title)
       values (null, 'other', 'warn', 'Plataforma') returning id`,
    );
    const { rows: ev } = await pool.query(
      `select 1 from event_log where event_type = 'central.aviso_criado' and entity_id = $1`,
      [rows[0]!.id],
    );
    expect(ev).toHaveLength(0);
    await pool.query("delete from agent_inbox_items where id = $1", [rows[0]!.id]);
  });

  it("a função do trigger não é executável por anon nem authenticated", async () => {
    const { rows } = await pool.query<{ anon: boolean; auth: boolean }>(
      `select has_function_privilege('anon', 'public.fn_emit_aviso_da_central()', 'execute') as anon,
              has_function_privilege('authenticated', 'public.fn_emit_aviso_da_central()', 'execute') as auth`,
    );
    expect(rows[0]).toEqual({ anon: false, auth: false });
  });
});
