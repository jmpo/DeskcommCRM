/**
 * Runtime real do "Testar agente" (issue #71).
 *
 * O default do `INTERNAL_AGENT_RUN_STUB` virou `false`, então o caminho que
 * roda numa instalação nova é o runtime de verdade — e o modo de falha comum
 * dessa instalação é não ter credencial de IA. Este teste fixa o contrato
 * desse erro: a pessoa lê o porquê na tela, em vez de um 500 mudo que só
 * aparece no log do servidor.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { ROLE_RANK, type AuthUser, type Role } from "@/lib/auth/types";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/ai/runtime/agent", () => ({
  runAgent: vi.fn(async () => {
    throw new Error("AI_GATEWAY_API_KEY ausente");
  }),
}));

const ORG = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
const AGENT = "33333333-3333-4333-8333-333333333333";
const VERSION = "44444444-4444-4444-8444-444444444444";

function stubAdmin() {
  return {
    from: (table: string) => {
      if (table === "ai_agent_versions") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: VERSION,
                      agent_id: AGENT,
                      organization_id: ORG,
                      system_prompt: "oi",
                      provider: "anthropic",
                      model: "claude-sonnet-4-6",
                      channel_session_id: null,
                      max_steps: 3,
                      token_budget: 1000,
                      cost_budget_cents: 100,
                      tool_ids: [],
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      // ai_agent_runs
      return {
        insert: () => ({
          select: () => ({ single: async () => ({ data: { id: "run-1" }, error: null }) }),
        }),
        update: () => ({ eq: async () => ({ error: null }) }),
      };
    },
  };
}

describe("POST .../versions/:vid/test — runtime real", () => {
  beforeEach(() => {
    const user: AuthUser = {
      id: USER,
      email: "a@example.com",
      full_name: null,
      avatar_url: null,
      is_platform_admin: false,
      idioma: "pt-BR" as const,
      organizations: [{ organization_id: ORG, organization_name: "Org", role: "admin" }],
    };
    vi.mocked(requireRole).mockImplementation(async (min: Role) =>
      ROLE_RANK["admin"] >= ROLE_RANK[min]
        ? { ok: true, user, org: { orgId: ORG, name: "Org", role: "admin" } }
        : ({ ok: false, response: null } as never),
    );
    vi.mocked(createAdminClient).mockReturnValue(stubAdmin() as never);
  });

  it("falha do runtime vira mensagem legível, não 500 mudo", async () => {
    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sample_message: "oi" }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: AGENT, vid: VERSION }) });
    const body = (await res.json()) as { error?: { message?: string } };

    expect(res.status).toBe(500);
    expect(body.error?.message).toContain("Não consegui executar o agente");
    expect(body.error?.message).toContain("AI_GATEWAY_API_KEY ausente");
  });
});
