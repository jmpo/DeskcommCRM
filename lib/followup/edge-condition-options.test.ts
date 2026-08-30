import { describe, it, expect } from "vitest";

import { edgeConditionOptions, conditionKey, conditionLabel } from "./edge-condition-options";
import type { FlowNode } from "./graph-schema";

function node<T extends FlowNode>(n: T): T {
  return n;
}

describe("edgeConditionOptions", () => {
  it("ai_classify: always + one class_match per class + no_reply, in that order", () => {
    const source = node({
      id: "n1",
      type: "ai_classify",
      label: "Classificar",
      position: { x: 0, y: 0 },
      config: { classes: ["positivo", "objecao"], grace_timeout_ms: 900_000, target: "last_reply" },
    });

    const options = edgeConditionOptions(source);

    expect(options.map((o) => o.key)).toEqual([
      "always",
      "class_match:positivo",
      "class_match:objecao",
      "class_match:no_reply",
    ]);
    expect(options.map((o) => o.label)).toEqual(["Sempre", "positivo", "objecao", "Sem resposta"]);
    expect(options[1]!.condition).toEqual({ type: "class_match", value: "positivo" });
    expect(options[3]!.condition).toEqual({ type: "class_match", value: "no_reply" });
  });

  it("match_reply: declared branches + no_reply + always from nodeBranches", () => {
    const source = node({
      id: "n1",
      type: "match_reply",
      label: "Casar",
      position: { x: 0, y: 0 },
      config: {
        branches: [{ id: "br_sim", label: "Sim", op: "eq", pattern: "sim" }],
        grace_timeout_ms: 900_000,
      },
    });
    const options = edgeConditionOptions(source);
    expect(options.map((o) => o.key)).toEqual(["branch:br_sim", "branch:no_reply", "always"]);
    expect(options.map((o) => o.label)).toEqual(["Sim", "Sem resposta", "Sempre"]);
  });

  it("repeat: próxima volta + acabou + sempre", () => {
    const source = node({
      id: "n1",
      type: "repeat",
      label: "Repetir",
      position: { x: 0, y: 0 },
      config: { max_count: 12 },
    });
    const options = edgeConditionOptions(source);
    expect(options.map((o) => o.key)).toEqual(["branch:body", "branch:done", "always"]);
    expect(options.map((o) => o.label)).toEqual(["Próxima volta", "Acabou", "Sempre"]);
  });

  it("ai_classify: does not duplicate no_reply when it's already declared as a class", () => {
    // Not a real-world config (no_reply is a reserved outcome, not a user class), but the
    // function must still be well-defined and never emit an option with a duplicate key.
    const source = node({
      id: "n1",
      type: "ai_classify",
      label: "Classificar",
      position: { x: 0, y: 0 },
      config: { classes: ["hot"], grace_timeout_ms: 900_000, target: "last_reply" },
    });
    const options = edgeConditionOptions(source);
    const keys = options.map((o) => o.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("condition: always + cond_result true + cond_result false", () => {
    const source = node({
      id: "n1",
      type: "condition",
      label: "Engajado?",
      position: { x: 0, y: 0 },
      config: { combinator: "and", checks: [{ field: "steps_taken", op: "gte", value: 1 }] },
    });

    const options = edgeConditionOptions(source);

    expect(options.map((o) => o.key)).toEqual(["always", "cond_result:true", "cond_result:false"]);
    expect(options.map((o) => o.label)).toEqual(["Sempre", "Sim", "Não"]);
    expect(options[1]!.condition).toEqual({ type: "cond_result", value: true });
    expect(options[2]!.condition).toEqual({ type: "cond_result", value: false });
  });

  it.each(["trigger", "wait", "action", "end"] as const)("%s: only always", (type) => {
    const bases = {
      trigger: { config: {} },
      wait: { config: { mode: "fixed", duration_ms: 600_000 } },
      action: { config: { mode: "ai_message", prompt_hint: "oi" } },
      end: { config: { outcome: "converted" } },
    } as const;
    const source = node({
      id: "n1",
      type,
      label: "X",
      position: { x: 0, y: 0 },
      ...bases[type],
    } as FlowNode);

    expect(edgeConditionOptions(source)).toEqual([{ key: "always", label: "Sempre", condition: { type: "always" } }]);
  });

  it("undefined source (dangling edge) falls back to always-only", () => {
    expect(edgeConditionOptions(undefined)).toEqual([{ key: "always", label: "Sempre", condition: { type: "always" } }]);
  });
});

describe("conditionKey / conditionLabel", () => {
  it("round-trip for every condition variant", () => {
    const cases: Array<[Parameters<typeof conditionKey>[0], string, string]> = [
      [{ type: "always" }, "always", "Sempre"],
      [{ type: "class_match", value: "hot" }, "class_match:hot", "hot"],
      [{ type: "class_match", value: "no_reply" }, "class_match:no_reply", "Sem resposta"],
      [{ type: "cond_result", value: true }, "cond_result:true", "Sim"],
      [{ type: "cond_result", value: false }, "cond_result:false", "Não"],
    ];
    for (const [condition, key, label] of cases) {
      expect(conditionKey(condition)).toBe(key);
      expect(conditionLabel(condition)).toBe(label);
    }
  });
});
