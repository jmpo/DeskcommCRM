/**
 * O caso aberto aparece na Central NA HORA e sai quando fecha.
 *
 * Medido: a IA abriu o caso "cliente pergunta a transportadora" e ele só existia
 * na tela de Casos — o sino não mostrava nada, e a cobrança da Central só chega
 * depois de 24 horas. O aviso nasce com texto genérico (o título do caso fala do
 * cliente, e ficaria fora da anonimização de LGPD) e aponta para o caso.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { createAdminClient } from "@/lib/supabase/admin";
import { casoNaCentralHandler } from "@/lib/escalacao/caso-na-central.handler";
import { somDoAviso } from "@/lib/notifications/sons-da-org";
import type { EventRow } from "@/lib/event-log/dispatcher";

const ORG = "11111111-1111-4111-8111-111111111111";
const CASO = "22222222-2222-4222-8222-222222222222";

let inseridos: Record<string, unknown>[] = [];
let atualizados: Record<string, unknown>[] = [];

function banco(t: { status?: string | null; jaAberto?: boolean; abertosParaFechar?: number }) {
  inseridos = [];
  atualizados = [];
  return {
    from(tabela: string) {
      const q: Record<string, unknown> = {
        select: () => q, eq: () => q, in: () => q, limit: () => q,
        maybeSingle: async () => ({
          data: tabela === "agent_cases" ? (t.status ? { status: t.status } : null)
            : tabela === "organizations" ? { locale: "es" } : null,
          error: null,
        }),
        insert: async (v: Record<string, unknown>) => { inseridos.push(v); return { error: null }; },
        update: (v: Record<string, unknown>) => {
          atualizados.push(v);
          const u: Record<string, unknown> = {
            eq: () => u, in: () => u,
            select: async () => ({ data: Array.from({ length: t.abertosParaFechar ?? 0 }, (_, i) => ({ id: `i${i}` })), error: null }),
          };
          return u;
        },
        then: (ok: (r: unknown) => unknown) => ok({ data: t.jaAberto ? [{ id: "x" }] : [], error: null }),
      };
      return q;
    },
  };
}

const evento = (event_type: string): EventRow => ({
  id: "evt", organization_id: ORG, event_type, entity_kind: "agent_case", entity_id: CASO,
  payload: { case_id: CASO }, metadata: {}, consumed_by: [], attempts: 0, created_at: new Date().toISOString(),
});

beforeEach(() => vi.mocked(createAdminClient).mockReset());

describe("caso aberto → aviso na Central", () => {
  it("escuta abertura e fechamento", () => {
    expect(casoNaCentralHandler.events).toEqual(["ai.case_opened", "ai.case_closed"]);
  });

  it("caso esperando pessoa: aviso genérico em espanhol, apontando para o caso", async () => {
    vi.mocked(createAdminClient).mockReturnValue(banco({ status: "awaiting_human" }) as never);
    const r = await casoNaCentralHandler.handle(evento("ai.case_opened"));
    expect(r.status).toBe("ok");
    expect(inseridos[0]).toMatchObject({
      organization_id: ORG,
      kind: "other",
      title: "La IA pidió ayuda al equipo",
      ref_kind: "agent_case",
      ref_id: CASO,
    });
    // O aviso toca o som de "pessoa" — é o mesmo momento do handoff.
    expect(somDoAviso(inseridos[0] as { kind: string; ref_kind: string })).toBe("pessoa");
  });

  it("reprocessar o evento não empilha um segundo aviso", async () => {
    vi.mocked(createAdminClient).mockReturnValue(banco({ status: "awaiting_human", jaAberto: true }) as never);
    expect((await casoNaCentralHandler.handle(evento("ai.case_opened"))).detail).toBe("aviso_ja_aberto");
    expect(inseridos).toHaveLength(0);
  });

  it("caso que fechou antes do dreno: nada entra", async () => {
    vi.mocked(createAdminClient).mockReturnValue(banco({ status: "resolved" }) as never);
    expect((await casoNaCentralHandler.handle(evento("ai.case_opened"))).detail).toBe("caso_ja_fechado");
    expect(inseridos).toHaveLength(0);
  });

  it("caso fechado: o aviso sai do sino", async () => {
    vi.mocked(createAdminClient).mockReturnValue(banco({ abertosParaFechar: 1 }) as never);
    const r = await casoNaCentralHandler.handle(evento("ai.case_closed"));
    expect(r.detail).toBe("aviso_resolvido");
    expect(atualizados[0]).toMatchObject({ status: "resolved" });
  });
});
