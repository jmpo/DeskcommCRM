/**
 * O TURNO DE FLUXO NÃO FALA POR CIMA DE QUEM ASSUMIU A CONVERSA — o cabo.
 *
 * O SQL de `aplicarPessoaNoComandoAoTurno` (quem está no comando, qual a
 * política, a pausa/cancelamento idempotente) é provado no banco em
 * `tests/invariants/followup-pessoa-no-comando-no-turno.test.ts`. Este arquivo
 * prova o que o handler faz com o desfecho:
 * - a checagem roda ANTES de qualquer efeito, com a conversa da fronteira;
 * - pausada → nada sai, nada completa, e o `turn_discarded` da #2262 é gravado
 *   (é ele que faz a retomada reenfileirar o passo);
 * - cancelada → nada sai, sem rastro (não há retomada);
 * - `null` (ninguém no comando, ou política `allow`) → o envio segue como antes.
 *
 * O pool é um dublê: a pausa/cancelamento é simulada mudando o status que a
 * checagem de inscrição viva lê em seguida, como o UPDATE real faria.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { JobRow } from "@/lib/agent-engine/queue/queue";

const runBeforeSend = vi.fn(async (args: Record<string, unknown>) => {
  await (args.send as (b: string) => Promise<unknown>)(args.body as string);
  return { status: "sent", outcome: { kind: "sent" }, trace: [] };
});
vi.mock("@/lib/agent-engine/guardrails/before-send", () => ({ runBeforeSend }));
vi.mock("@/lib/agent-engine/agent/human-handoff", () => ({ isLeadInHandoff: vi.fn(async () => false) }));
vi.mock("@/lib/agent-engine/edge/crm/get-lead-context", () => ({
  getLeadContext: vi.fn(async () => ({
    ok: true,
    context: { contact: { is_blocked: false } },
    lgpd: { isAnonymized: false, isProspecting: false, legalBasis: {} },
  })),
}));
vi.mock("@/lib/agent-engine/agent/inbound-turn", async (original) => ({
  ...(await original<typeof import("@/lib/agent-engine/agent/inbound-turn")>()),
  runAgentTurn: vi.fn(async () => undefined),
}));
vi.mock("@/lib/agent-engine/edge/crm/send-ledger", () => ({
  resultadoDoEnvioDoFollowup: vi.fn(async () => ({ kind: "sent" })),
}));

let estado = "active";
const aplicarPessoaNoComandoAoTurno = vi.fn(
  async (_pool: unknown, _alvo: unknown, _agora: unknown): Promise<"pausada" | "cancelada" | null> => null,
);
vi.mock("@/lib/followup/pessoa-no-comando-no-turno", () => ({ aplicarPessoaNoComandoAoTurno }));

const ORG = "org-1";
const LEAD = "lead-1";
const CONVERSA = "conversa-1";
const INSCRICAO = "11111111-1111-4111-8111-111111111111";
const NO = "passo";
const boundary = {
  organization_id: ORG,
  contact_id: LEAD,
  conversation_id: CONVERSA,
  service_revision: 1,
  demanda_id: null,
  demanda_revision: null,
};

function job(): JobRow {
  return {
    id: "job-1",
    organization_id: ORG,
    contact_id: LEAD,
    kind: "followup_turn",
    source_event_id: null,
    payload: {
      followup_enrollment_id: INSCRICAO,
      node_id: NO,
      source_step_key: `${NO}:1`,
      purpose: "send_message",
      fixed_body: "Oi! Passando para retomar.",
      service_boundary: boundary,
    },
    status: "running",
    priority: 0,
    run_after: new Date(),
    attempts: 1,
    max_attempts: 3,
    last_error: null,
    locked_by: "w1",
    locked_at: new Date(),
    created_at: new Date(),
  } as JobRow;
}

let inserts: string[] = [];
function fakePool() {
  const query = vi.fn(async (sql: string): Promise<{ rows: Array<Record<string, unknown>> }> => {
    if (/insert into followup_enrollment_events/.test(sql)) {
      inserts.push(sql);
      return { rows: [] };
    }
    if (sql.includes("d.fechada_em::text")) return { rows: [{ ...boundary, status: "open", demanda_fechada_em: null }] };
    if (/from conversations/.test(sql)) return { rows: [{ id: CONVERSA, channel_session_id: "canal-1", archived_at: null }] };
    if (/from followup_enrollments/.test(sql) && !/left join ai_agents/.test(sql))
      return { rows: [{ current_node_id: NO, status: estado }] };
    return { rows: [] };
  });
  return { query } as never;
}

function deps() {
  const send = vi.fn(async () => ({ ok: true }));
  const completeFollowupTurn = vi.fn(async () => undefined);
  const d = {
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    crmCfg: {},
    llmCfg: {},
    knobs: {},
    channel: () => ({ send }),
    completeFollowupTurn,
  } as never;
  return { d, send, completeFollowupTurn };
}

let criarHandler: typeof import("@/lib/agent-engine/agent/followup-turn").createFollowupTurnHandler;
beforeAll(async () => {
  ({ createFollowupTurnHandler: criarHandler } = await import("@/lib/agent-engine/agent/followup-turn"));
}, 60_000);

beforeEach(() => {
  estado = "active";
  inserts = [];
  runBeforeSend.mockClear();
  aplicarPessoaNoComandoAoTurno.mockReset();
  aplicarPessoaNoComandoAoTurno.mockImplementation(async () => null);
});

describe("o turno de fluxo diante de uma pessoa no comando da conversa", () => {
  it("pergunta quem está no comando ANTES do envio, pela conversa da fronteira e o nó do turno", async () => {
    const { d } = deps();
    await criarHandler(d)(job(), fakePool(), { workerId: "w1" });
    expect(aplicarPessoaNoComandoAoTurno).toHaveBeenCalledTimes(1);
    expect(aplicarPessoaNoComandoAoTurno.mock.calls[0]![1]).toEqual({
      organizationId: ORG,
      enrollmentId: INSCRICAO,
      nodeId: NO,
      conversationId: CONVERSA,
    });
  });

  it("⭐ pausada (alguém assumiu): nada sai, nada completa, e fica o rastro que a retomada lê", async () => {
    aplicarPessoaNoComandoAoTurno.mockImplementation(async () => {
      estado = "paused_handoff";
      return "pausada";
    });
    const { d, send, completeFollowupTurn } = deps();
    await criarHandler(d)(job(), fakePool(), { workerId: "w1" });
    expect(runBeforeSend, "o passo do fluxo falou por cima de quem assumiu a conversa").not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(completeFollowupTurn).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatch(/'turn_discarded'/);
  });

  it("cancelada (política cancel): nada sai e não há rastro — não haverá retomada", async () => {
    aplicarPessoaNoComandoAoTurno.mockImplementation(async () => {
      estado = "cancelled";
      return "cancelada";
    });
    const { d, send } = deps();
    await criarHandler(d)(job(), fakePool(), { workerId: "w1" });
    expect(send).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it("controle: ninguém no comando (ou política allow), o envio segue", async () => {
    const { d, send, completeFollowupTurn } = deps();
    await criarHandler(d)(job(), fakePool(), { workerId: "w1" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(completeFollowupTurn).toHaveBeenCalledTimes(1);
  });
});
