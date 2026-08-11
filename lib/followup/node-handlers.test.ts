import { describe, it, expect } from "vitest";

import {
  BACKOFF_MS,
  processNode,
  resolveWaitPhase,
  selectEdge,
  type EnrollmentRow,
  type LeadFacts,
} from "./node-handlers";
import type { FlowEdge, FlowNode } from "./graph-schema";

const NOW = new Date("2026-07-21T12:00:00.000Z");
const clock = () => NOW;

function enrollment(overrides: Partial<EnrollmentRow> = {}): EnrollmentRow {
  return {
    id: "enr-1",
    organization_id: "org-1",
    pointer_id: "ptr-1",
    version_id: "ver-1",
    contact_id: "contact-1",
    conversation_id: null,
    current_node_id: "n1",
    status: "active",
    next_eval_at: NOW.toISOString(),
    claimed_until: null,
    attempts: 0,
    max_attempts: 5,
    last_error: null,
    steps_taken: 3,
    outcome: null,
    cancel_reason: null,
    started_at: NOW.toISOString(),
    completed_at: null,
    updated_at: NOW.toISOString(),
    ...overrides,
  };
}

function lead(overrides: Partial<LeadFacts> = {}): LeadFacts {
  return { lead_stage: null, tags: [], steps_taken: 0, last_outcome: null, ...overrides };
}

function edge(overrides: Partial<FlowEdge> & Pick<FlowEdge, "source" | "target" | "condition">): FlowEdge {
  return { id: `${overrides.source}->${overrides.target}`, priority: 0, ...overrides };
}

describe("BACKOFF_MS", () => {
  it("is the exact 5-slot ladder from 30s to 1h", () => {
    expect(BACKOFF_MS).toEqual([30_000, 60_000, 300_000, 900_000, 3_600_000]);
  });
});

describe("selectEdge", () => {
  const edges: FlowEdge[] = [
    edge({ source: "n1", target: "low", condition: { type: "always" }, priority: 0 }),
    edge({ source: "n1", target: "high", condition: { type: "always" }, priority: 10 }),
    edge({ source: "n1", target: "hot", condition: { type: "class_match", value: "hot" }, priority: 5 }),
    edge({ source: "n1", target: "yes", condition: { type: "cond_result", value: true }, priority: 5 }),
    edge({ source: "n1", target: "ramo", condition: { type: "branch", branch_id: "chk_vip" }, priority: 5 }),
    edge({ source: "other", target: "x", condition: { type: "always" }, priority: 99 }),
  ];

  it("picks highest-priority 'always' edge when asked for always", () => {
    const picked = selectEdge(edges, "n1", { type: "always" });
    expect(picked?.target).toBe("high");
  });

  it("picks the exact class_match edge over the always fallback", () => {
    const picked = selectEdge(edges, "n1", { type: "class_match", value: "hot" });
    expect(picked?.target).toBe("hot");
  });

  it("falls back to 'always' when no class_match edge matches the value", () => {
    const picked = selectEdge(edges, "n1", { type: "class_match", value: "cold" });
    expect(picked?.target).toBe("high");
  });

  it("picks the exact cond_result edge over the always fallback", () => {
    const picked = selectEdge(edges, "n1", { type: "cond_result", value: true });
    expect(picked?.target).toBe("yes");
  });

  it("falls back to 'always' when cond_result value doesn't match", () => {
    const picked = selectEdge(edges, "n1", { type: "cond_result", value: false });
    expect(picked?.target).toBe("high");
  });

  it("picks the exact branch edge over the always fallback", () => {
    expect(selectEdge(edges, "n1", { type: "branch", branch_id: "chk_vip" })?.target).toBe("ramo");
  });

  it("falls back to 'always' for a branch nobody wired — escape, não lead preso", () => {
    expect(selectEdge(edges, "n1", { type: "branch", branch_id: "chk_orfao" })?.target).toBe("high");
  });

  it("não confunde branch com class_match de mesmo nome", () => {
    const homonimos: FlowEdge[] = [
      edge({ source: "n1", target: "por-classe", condition: { type: "class_match", value: "vip" } }),
      edge({ source: "n1", target: "por-ramo", condition: { type: "branch", branch_id: "vip" } }),
    ];
    expect(selectEdge(homonimos, "n1", { type: "branch", branch_id: "vip" })?.target).toBe("por-ramo");
    expect(selectEdge(homonimos, "n1", { type: "class_match", value: "vip" })?.target).toBe("por-classe");
  });

  it("returns null when the node has no outbound edges at all", () => {
    expect(selectEdge(edges, "ghost", { type: "always" })).toBeNull();
  });

  it("returns null when no exact match and no always fallback exists", () => {
    const onlyClassMatch: FlowEdge[] = [
      edge({ source: "n1", target: "hot", condition: { type: "class_match", value: "hot" } }),
    ];
    expect(selectEdge(onlyClassMatch, "n1", { type: "class_match", value: "cold" })).toBeNull();
  });
});

describe("resolveWaitPhase", () => {
  it("false on first entry (no prior-step event for this node)", () => {
    expect(resolveWaitPhase([], "wait1", 5)).toBe(false);
  });

  it("true once the prior-step event for this node exists", () => {
    const events = [{ node_id: "wait1", idempotency_key: "wait1:4" }];
    expect(resolveWaitPhase(events, "wait1", 5)).toBe(true);
  });

  it("ignores prior-step events belonging to a different node", () => {
    const events = [{ node_id: "other", idempotency_key: "wait1:4" }];
    expect(resolveWaitPhase(events, "wait1", 5)).toBe(false);
  });
});

describe("processNode — trigger", () => {
  it("advances via the 'always' edge immediately", () => {
    const node: FlowNode = { id: "t1", type: "trigger", label: "Start", position: { x: 0, y: 0 }, config: {} };
    const edges = [edge({ source: "t1", target: "n2", condition: { type: "always" } })];
    const result = processNode({ node, edges, enrollment: enrollment(), lead: lead(), clock });
    expect(result).toEqual({ kind: "advance", next_node_id: "n2", next_eval_at: NOW });
  });

  it("fails when the trigger has no outbound edge", () => {
    const node: FlowNode = { id: "t1", type: "trigger", label: "Start", position: { x: 0, y: 0 }, config: {} };
    const result = processNode({ node, edges: [], enrollment: enrollment(), lead: lead(), clock });
    expect(result.kind).toBe("fail");
  });
});

describe("processNode — wait (fixed)", () => {
  const node: FlowNode = {
    id: "w1",
    type: "wait",
    label: "Wait 5min",
    position: { x: 0, y: 0 },
    config: { mode: "fixed", duration_ms: 300_000 },
  };
  const edges = [edge({ source: "w1", target: "n2", condition: { type: "always" } })];

  it("first entry: schedules next_eval_at = now + duration_ms, stays put", () => {
    const result = processNode({ node, edges, enrollment: enrollment(), lead: lead(), clock, waitElapsed: false });
    expect(result).toEqual({ kind: "wait", next_eval_at: new Date(NOW.getTime() + 300_000) });
  });

  it("elapsed: advances via the 'always' edge", () => {
    const result = processNode({ node, edges, enrollment: enrollment(), lead: lead(), clock, waitElapsed: true });
    expect(result).toEqual({ kind: "advance", next_node_id: "n2", next_eval_at: NOW });
  });

  it("elapsed but no outbound edge: fails", () => {
    const result = processNode({ node, edges: [], enrollment: enrollment(), lead: lead(), clock, waitElapsed: true });
    expect(result.kind).toBe("fail");
  });
});

describe("processNode — wait (smart): o instante vem do plano de tempo do enrollment", () => {
  const node: FlowNode = {
    id: "w2",
    type: "wait",
    label: "Wait smart",
    position: { x: 0, y: 0 },
    config: { mode: "smart", min_ms: 600_000, max_ms: 1_800_000 },
  };

  function comPlano(escolhidoMs: number, nodeId = "w2"): EnrollmentRow {
    return enrollment({
      timing_plan: {
        decidido_em: NOW.toISOString(),
        modelo: "anthropic/claude-sonnet-4-6",
        esperas: {
          [nodeId]: {
            escolhido_ms: escolhidoMs,
            min_ms: 600_000,
            max_ms: 1_800_000,
            proposto_ms: escolhidoMs,
            clampado: false,
            motivo: "lead respondeu rápido nas últimas trocas",
          },
        },
      },
    });
  }

  // ESTE é o caso que reprova a versão anterior: com plano, ela ainda esperava
  // max_ms (1_800_000) — a tela oferecia o modo adaptativo e o motor ignorava.
  it("com plano: espera o instante planejado, NÃO o máximo", () => {
    const result = processNode({
      node,
      edges: [],
      enrollment: comPlano(900_000),
      lead: lead(),
      clock,
      waitElapsed: false,
    });
    expect(result).toEqual({ kind: "wait", next_eval_at: new Date(NOW.getTime() + 900_000) });
  });

  it("com plano no MÍNIMO: espera o mínimo (prova que o plano manda, e não um teto qualquer)", () => {
    const result = processNode({
      node,
      edges: [],
      enrollment: comPlano(600_000),
      lead: lead(),
      clock,
      waitElapsed: false,
    });
    expect(result).toEqual({ kind: "wait", next_eval_at: new Date(NOW.getTime() + 600_000) });
  });

  it("plano de OUTRO nó: este nó não se serve dele — cai no máximo", () => {
    const result = processNode({
      node,
      edges: [],
      enrollment: comPlano(900_000, "outro-no"),
      lead: lead(),
      clock,
      waitElapsed: false,
    });
    expect(result).toEqual({ kind: "wait", next_eval_at: new Date(NOW.getTime() + 1_800_000) });
  });

  it("sem plano (enrollment de antes da feature): máximo — compatibilidade v1", () => {
    const result = processNode({ node, edges: [], enrollment: enrollment(), lead: lead(), clock, waitElapsed: false });
    expect(result).toEqual({ kind: "wait", next_eval_at: new Date(NOW.getTime() + 1_800_000) });
  });

  // "Quem decide o intervalo é o nó" só é invariante se valer também na leitura:
  // `timing_plan` é jsonb num banco que o self-hoster administra, e uma linha
  // adulterada (ou um bug futuro que grave sem clampar) prenderia o lead muito
  // além do que a tela configurou, em silêncio.
  it("plano com valor ACIMA do máximo do nó é grampeado na leitura", () => {
    const result = processNode({
      node,
      edges: [],
      enrollment: comPlano(30 * 86_400_000), // 30 dias, contra um máximo de 30min
      lead: lead(),
      clock,
      waitElapsed: false,
    });
    expect(result).toEqual({ kind: "wait", next_eval_at: new Date(NOW.getTime() + 1_800_000) });
  });

  it("plano com valor ABAIXO do mínimo do nó é grampeado na leitura", () => {
    const result = processNode({
      node,
      edges: [],
      enrollment: comPlano(1_000), // 1s, contra um mínimo de 10min
      lead: lead(),
      clock,
      waitElapsed: false,
    });
    expect(result).toEqual({ kind: "wait", next_eval_at: new Date(NOW.getTime() + 600_000) });
  });

  it("plano corrompido (jsonb de clone com lixo): máximo, sem lançar", () => {
    const result = processNode({
      node,
      edges: [],
      enrollment: enrollment({ timing_plan: { esperas: "isto não é um objeto" } }),
      lead: lead(),
      clock,
      waitElapsed: false,
    });
    expect(result).toEqual({ kind: "wait", next_eval_at: new Date(NOW.getTime() + 1_800_000) });
  });
});

describe("processNode — condition", () => {
  const edges = [
    edge({ source: "c1", target: "yes", condition: { type: "cond_result", value: true } }),
    edge({ source: "c1", target: "no", condition: { type: "cond_result", value: false } }),
  ];

  function conditionNode(config: Extract<FlowNode, { type: "condition" }>["config"]): FlowNode {
    return { id: "c1", type: "condition", label: "Check", position: { x: 0, y: 0 }, config };
  }

  it("eq true routes to the true edge", () => {
    const node = conditionNode({ combinator: "and", checks: [{ field: "lead_stage", op: "eq", value: "hot" }] });
    const result = processNode({ node, edges, enrollment: enrollment(), lead: lead({ lead_stage: "hot" }), clock });
    expect(result).toMatchObject({ kind: "advance", next_node_id: "yes" });
  });

  it("neq false routes to the false edge", () => {
    const node = conditionNode({ combinator: "and", checks: [{ field: "lead_stage", op: "neq", value: "hot" }] });
    const result = processNode({ node, edges, enrollment: enrollment(), lead: lead({ lead_stage: "hot" }), clock });
    expect(result).toMatchObject({ kind: "advance", next_node_id: "no" });
  });

  it("gte on steps_taken", () => {
    const node = conditionNode({ combinator: "and", checks: [{ field: "steps_taken", op: "gte", value: 3 }] });
    const result = processNode({ node, edges, enrollment: enrollment(), lead: lead({ steps_taken: 3 }), clock });
    expect(result).toMatchObject({ kind: "advance", next_node_id: "yes" });
  });

  it("lte on steps_taken", () => {
    const node = conditionNode({ combinator: "and", checks: [{ field: "steps_taken", op: "lte", value: 2 }] });
    const result = processNode({ node, edges, enrollment: enrollment(), lead: lead({ steps_taken: 3 }), clock });
    expect(result).toMatchObject({ kind: "advance", next_node_id: "no" });
  });

  it("contains on tag (array membership)", () => {
    const node = conditionNode({ combinator: "and", checks: [{ field: "tag", op: "contains", value: "vip" }] });
    const result = processNode({ node, edges, enrollment: enrollment(), lead: lead({ tags: ["vip", "b2b"] }), clock });
    expect(result).toMatchObject({ kind: "advance", next_node_id: "yes" });
  });

  it("contains on last_outcome substring", () => {
    const node = conditionNode({ combinator: "and", checks: [{ field: "last_outcome", op: "contains", value: "hot" }] });
    const result = processNode({
      node,
      edges,
      enrollment: enrollment(),
      lead: lead({ last_outcome: "classified_hot" }),
      clock,
    });
    expect(result).toMatchObject({ kind: "advance", next_node_id: "yes" });
  });

  it("combinator 'and': all checks must pass", () => {
    const node = conditionNode({
      combinator: "and",
      checks: [
        { field: "lead_stage", op: "eq", value: "hot" },
        { field: "steps_taken", op: "gte", value: 10 },
      ],
    });
    const result = processNode({
      node,
      edges,
      enrollment: enrollment(),
      lead: lead({ lead_stage: "hot", steps_taken: 1 }),
      clock,
    });
    expect(result).toMatchObject({ kind: "advance", next_node_id: "no" });
  });

  it("combinator 'or': any check passing is enough", () => {
    const node = conditionNode({
      combinator: "or",
      checks: [
        { field: "lead_stage", op: "eq", value: "cold" },
        { field: "steps_taken", op: "gte", value: 1 },
      ],
    });
    const result = processNode({
      node,
      edges,
      enrollment: enrollment(),
      lead: lead({ lead_stage: "hot", steps_taken: 1 }),
      clock,
    });
    expect(result).toMatchObject({ kind: "advance", next_node_id: "yes" });
  });

  it("fails when no edge matches the evaluated result", () => {
    const node = conditionNode({ combinator: "and", checks: [{ field: "lead_stage", op: "eq", value: "hot" }] });
    const result = processNode({
      node,
      edges: [edge({ source: "c1", target: "yes", condition: { type: "cond_result", value: true } })],
      enrollment: enrollment(),
      lead: lead({ lead_stage: "cold" }),
      clock,
    });
    expect(result.kind).toBe("fail");
  });
});

/**
 * `branching: 'per_check'` — a queixa original do Rafael: N regras, N saídas.
 * O nó deixa de dobrar as regras num booleano e passa a rotear pelo `branch_id`
 * da regra que passou.
 */
describe("processNode — condition com uma saída por regra", () => {
  const VIP = { id: "chk_vip", field: "tag" as const, op: "contains" as const, value: "vip" };
  const FRIO = { id: "chk_frio", field: "steps_taken" as const, op: "gte" as const, value: 3 };

  function perCheckNode(): FlowNode {
    return {
      id: "c1",
      type: "condition",
      label: "Triagem",
      position: { x: 0, y: 0 },
      config: { combinator: "and", branching: "per_check", checks: [VIP, FRIO] },
    };
  }

  const edges = [
    edge({ source: "c1", target: "caminho-vip", condition: { type: "branch", branch_id: "chk_vip" } }),
    edge({ source: "c1", target: "caminho-frio", condition: { type: "branch", branch_id: "chk_frio" } }),
    edge({ source: "c1", target: "nenhuma-delas", condition: { type: "always" } }),
  ];

  it("cada regra manda o lead pelo SEU caminho", () => {
    const soVip = processNode({
      node: perCheckNode(),
      edges,
      enrollment: enrollment(),
      lead: lead({ tags: ["vip"], steps_taken: 0 }),
      clock,
    });
    expect(soVip).toMatchObject({ kind: "advance", next_node_id: "caminho-vip" });

    const soFrio = processNode({
      node: perCheckNode(),
      edges,
      enrollment: enrollment(),
      lead: lead({ tags: [], steps_taken: 5 }),
      clock,
    });
    expect(soFrio).toMatchObject({ kind: "advance", next_node_id: "caminho-frio" });
  });

  it("nenhuma regra passando cai no ramo obrigatório 'nenhuma delas'", () => {
    const result = processNode({
      node: perCheckNode(),
      edges,
      enrollment: enrollment(),
      lead: lead({ tags: [], steps_taken: 0 }),
      clock,
    });
    expect(result).toMatchObject({ kind: "advance", next_node_id: "nenhuma-delas" });
  });

  it("duas regras verdadeiras: vence a PRIMEIRA da lista, não é sorteio", () => {
    const result = processNode({
      node: perCheckNode(),
      edges,
      enrollment: enrollment(),
      lead: lead({ tags: ["vip"], steps_taken: 9 }), // as duas passam
      clock,
    });
    expect(result).toMatchObject({ kind: "advance", next_node_id: "caminho-vip" });
  });

  it("a ordem é a da lista, não a do id: invertidas as regras, inverte o vencedor", () => {
    const invertido: FlowNode = {
      id: "c1",
      type: "condition",
      label: "Triagem",
      position: { x: 0, y: 0 },
      config: { combinator: "and", branching: "per_check", checks: [FRIO, VIP] },
    };
    const result = processNode({
      node: invertido,
      edges,
      enrollment: enrollment(),
      lead: lead({ tags: ["vip"], steps_taken: 9 }), // as duas passam, de novo
      clock,
    });
    expect(result).toMatchObject({ kind: "advance", next_node_id: "caminho-frio" });
  });

  it("ramo sem aresta sai pela escape em vez de prender o lead no nó", () => {
    const semArestaDoFrio = [
      edge({ source: "c1", target: "caminho-vip", condition: { type: "branch", branch_id: "chk_vip" } }),
      edge({ source: "c1", target: "nenhuma-delas", condition: { type: "always" } }),
    ];
    const result = processNode({
      node: perCheckNode(),
      edges: semArestaDoFrio,
      enrollment: enrollment(),
      lead: lead({ tags: [], steps_taken: 5 }), // bate na regra do frio, que ninguém ligou
      clock,
    });
    expect(result).toMatchObject({ kind: "advance", next_node_id: "nenhuma-delas" });
  });

  it("'combinator' não é consultado neste modo — 'and' com uma só regra batendo ainda roteia", () => {
    // No modo combinado este mesmo nó daria FALSE (uma das duas regras falha) e
    // iria para a saída do 'não'. Aqui ele vai pelo caminho da regra que passou.
    const result = processNode({
      node: perCheckNode(),
      edges,
      enrollment: enrollment(),
      lead: lead({ tags: ["vip"], steps_taken: 0 }),
      clock,
    });
    expect(result).toMatchObject({ kind: "advance", next_node_id: "caminho-vip" });
  });
});

describe("processNode — ai_classify / action", () => {
  it("ai_classify enqueues a classify turn and wakes to waiting_reply", () => {
    const node: FlowNode = {
      id: "ac1",
      type: "ai_classify",
      label: "Classify",
      position: { x: 0, y: 0 },
      config: { classes: ["hot", "cold"], grace_timeout_ms: 900_000, target: "last_reply" },
    };
    const result = processNode({ node, edges: [], enrollment: enrollment(), lead: lead(), clock });
    expect(result).toEqual({ kind: "enqueue_turn", purpose: "classify", wake_status: "waiting_reply" });
  });

  it("ai_classify re-entry (grace elapsed, no completed classify): routes via 'no_reply' class_match edge without enqueuing another turn", () => {
    const node: FlowNode = {
      id: "ac1",
      type: "ai_classify",
      label: "Classify",
      position: { x: 0, y: 0 },
      config: { classes: ["hot", "cold"], grace_timeout_ms: 900_000, target: "last_reply" },
    };
    const edges = [
      edge({ source: "ac1", target: "hot-node", condition: { type: "class_match", value: "hot" } }),
      edge({ source: "ac1", target: "no-reply-node", condition: { type: "class_match", value: "no_reply" } }),
    ];
    const result = processNode({ node, edges, enrollment: enrollment(), lead: lead(), clock, waitElapsed: true });
    expect(result).toEqual({ kind: "advance", next_node_id: "no-reply-node", next_eval_at: NOW });
  });

  it("ai_classify re-entry without an explicit no_reply edge falls back to the 'always' edge", () => {
    const node: FlowNode = {
      id: "ac1",
      type: "ai_classify",
      label: "Classify",
      position: { x: 0, y: 0 },
      config: { classes: ["hot", "cold"], grace_timeout_ms: 900_000, target: "last_reply" },
    };
    const edges = [
      edge({ source: "ac1", target: "hot-node", condition: { type: "class_match", value: "hot" } }),
      edge({ source: "ac1", target: "fallback-node", condition: { type: "always" } }),
    ];
    const result = processNode({ node, edges, enrollment: enrollment(), lead: lead(), clock, waitElapsed: true });
    expect(result).toEqual({ kind: "advance", next_node_id: "fallback-node", next_eval_at: NOW });
  });

  it("ai_classify re-entry with neither a no_reply nor an always edge: fails", () => {
    const node: FlowNode = {
      id: "ac1",
      type: "ai_classify",
      label: "Classify",
      position: { x: 0, y: 0 },
      config: { classes: ["hot", "cold"], grace_timeout_ms: 900_000, target: "last_reply" },
    };
    const edges = [edge({ source: "ac1", target: "hot-node", condition: { type: "class_match", value: "hot" } })];
    const result = processNode({ node, edges, enrollment: enrollment(), lead: lead(), clock, waitElapsed: true });
    expect(result.kind).toBe("fail");
  });

  it("ai_classify re-entry with waitElapsed=true AND wokeEarly=true (reactivity's inbound signal): re-enqueues classify instead of routing no_reply — the classify-lento race fix", () => {
    const node: FlowNode = {
      id: "ac1",
      type: "ai_classify",
      label: "Classify",
      position: { x: 0, y: 0 },
      config: { classes: ["hot", "cold"], grace_timeout_ms: 900_000, target: "last_reply" },
    };
    const edges = [
      edge({ source: "ac1", target: "hot-node", condition: { type: "class_match", value: "hot" } }),
      edge({ source: "ac1", target: "no-reply-node", condition: { type: "class_match", value: "no_reply" } }),
    ];
    const result = processNode({ node, edges, enrollment: enrollment(), lead: lead(), clock, waitElapsed: true, wokeEarly: true });
    expect(result).toEqual({ kind: "enqueue_turn", purpose: "classify", wake_status: "waiting_reply" });
  });

  it("ai_classify re-entry with waitElapsed=false and wokeEarly=true (defensive — shouldn't happen, but wokeEarly alone never blocks the normal 1st-entry path): still enqueues classify", () => {
    const node: FlowNode = {
      id: "ac1",
      type: "ai_classify",
      label: "Classify",
      position: { x: 0, y: 0 },
      config: { classes: ["hot", "cold"], grace_timeout_ms: 900_000, target: "last_reply" },
    };
    const result = processNode({ node, edges: [], enrollment: enrollment(), lead: lead(), clock, waitElapsed: false, wokeEarly: true });
    expect(result).toEqual({ kind: "enqueue_turn", purpose: "classify", wake_status: "waiting_reply" });
  });

  it("action enqueues a send_message turn and keeps status active", () => {
    const node: FlowNode = {
      id: "a1",
      type: "action",
      label: "Send",
      position: { x: 0, y: 0 },
      config: { mode: "ai_message", prompt_hint: "lembre o lead" },
    };
    const result = processNode({ node, edges: [], enrollment: enrollment(), lead: lead(), clock });
    expect(result).toEqual({ kind: "enqueue_turn", purpose: "send_message", wake_status: "active" });
  });
});

describe("processNode — end", () => {
  it("converted maps straight through", () => {
    const node: FlowNode = { id: "e1", type: "end", label: "Done", position: { x: 0, y: 0 }, config: { outcome: "converted" } };
    const result = processNode({ node, edges: [], enrollment: enrollment(), lead: lead(), clock });
    expect(result).toEqual({ kind: "complete", outcome: "converted" });
  });

  it("exhausted maps straight through", () => {
    const node: FlowNode = { id: "e1", type: "end", label: "Done", position: { x: 0, y: 0 }, config: { outcome: "exhausted" } };
    const result = processNode({ node, edges: [], enrollment: enrollment(), lead: lead(), clock });
    expect(result).toEqual({ kind: "complete", outcome: "exhausted" });
  });

  it("custom maps to null outcome + cancel_reason = note", () => {
    const node: FlowNode = {
      id: "e1",
      type: "end",
      label: "Done",
      position: { x: 0, y: 0 },
      config: { outcome: "custom", note: "lead pediu pra sair" },
    };
    const result = processNode({ node, edges: [], enrollment: enrollment(), lead: lead(), clock });
    expect(result).toEqual({ kind: "complete", outcome: null, cancel_reason: "lead pediu pra sair" });
  });
});

/**
 * A IRMÃ do defeito dos ramos, achada pelo DevVivo na revisão: eu ensinei o
 * `selectEdge` a casar `branch` e usei isso SÓ no `condition`. O `ai_classify`
 * continuou resolvendo a saída por TEXTO — e num nó já migrado para ramos ele
 * não acha aresta nenhuma, cai no fallback `always` e manda todo mundo pelo
 * mesmo caminho, calado.
 *
 * O `no_reply` é o pior lugar para isso acontecer: é o caminho de quem NÃO
 * respondeu, que num follow-up é o caso mais comum.
 */
describe("processNode — ai_classify migrado para ramos nomeados", () => {
  const RAMOS = [
    { id: "br_quente", label: "quente" },
    { id: "br_frio", label: "frio" },
  ];

  function classifyV2(): FlowNode {
    return {
      id: "ac1",
      type: "ai_classify",
      label: "Classificar",
      position: { x: 0, y: 0 },
      config: {
        classes: ["quente", "frio"],
        branches: RAMOS,
        grace_timeout_ms: 900_000,
        target: "last_reply",
      },
    };
  }

  const edges = [
    edge({ source: "ac1", target: "no-quente", condition: { type: "branch", branch_id: "br_quente" } }),
    edge({ source: "ac1", target: "no-frio", condition: { type: "branch", branch_id: "br_frio" } }),
    edge({ source: "ac1", target: "no-sem-resposta", condition: { type: "branch", branch_id: "no_reply" } }),
    edge({ source: "ac1", target: "escape", condition: { type: "always" } }),
  ];

  it("grace vencido sem resposta sai pelo ramo 'sem resposta', não pela escape", () => {
    const result = processNode({
      node: classifyV2(),
      edges,
      enrollment: enrollment(),
      lead: lead(),
      clock,
      waitElapsed: true,
      wokeEarly: false,
    });
    expect(result).toMatchObject({ kind: "advance", next_node_id: "no-sem-resposta" });
  });

  it("um nó v1 continua saindo pela aresta class_match de 'no_reply'", () => {
    const v1: FlowNode = {
      id: "ac1",
      type: "ai_classify",
      label: "Classificar",
      position: { x: 0, y: 0 },
      config: { classes: ["quente"], grace_timeout_ms: 900_000, target: "last_reply" },
    };
    const arestasV1 = [
      edge({ source: "ac1", target: "no-sem-resposta", condition: { type: "class_match", value: "no_reply" } }),
      edge({ source: "ac1", target: "escape", condition: { type: "always" } }),
    ];
    const result = processNode({
      node: v1,
      edges: arestasV1,
      enrollment: enrollment(),
      lead: lead(),
      clock,
      waitElapsed: true,
      wokeEarly: false,
    });
    expect(result).toMatchObject({ kind: "advance", next_node_id: "no-sem-resposta" });
  });
});
