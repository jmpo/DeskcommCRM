import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  FamiliaDaBaseIlegivelError,
  familiaDaBase,
  resolverChaveDeEmbedding,
} from "@/lib/ai/embeddings/chave";
import { enfileirarTodosOsMateriais } from "@/lib/ai/knowledge/reprepara-tudo";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * PUT /api/v1/ai/knowledge/provedor — OpenAI ou Google prepara a base (#1130, @vgamkt).
 *
 * O que se trava aqui:
 *  * admin, organização da sessão;
 *  * a escolha é GRAVADA em `organizations.settings.base_de_conhecimento.familia`,
 *    em merge — `settings` é jsonb compartilhado com marca, MFA e o resto;
 *  * a troca não aponta para família sem chave (422);
 *  * trocar REFAZ A BASE no mesmo pedido, e pedir o provedor que já vale não
 *    refaz nada nem audita.
 */

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/ai/knowledge/reprepara-tudo", () => ({ enfileirarTodosOsMateriais: vi.fn() }));
vi.mock("@/lib/ai/embeddings/chave", () => ({
  resolverChaveDeEmbedding: vi.fn(),
  familiaDaBase: vi.fn(),
  FamiliaDaBaseIlegivelError: class FamiliaDaBaseIlegivelError extends Error {},
  // Cópia da função pura: o módulo real puxa env e banco no import.
  provedorDaBase: (c: { provedor: string }) => (c.provedor === "google" ? "google" : "openai"),
}));

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";

let settingsNoBanco: Record<string, unknown> | null;
let updates: Array<{ valores: Record<string, unknown>; filtros: Array<[string, unknown]> }>;
let linhasGravadas: number;

function pedido(corpo: unknown): Request {
  return new Request("http://x/api/v1/ai/knowledge/provedor", {
    method: "PUT",
    body: JSON.stringify(corpo),
    headers: { "content-type": "application/json" },
  });
}

async function chamar(corpo: unknown): Promise<Response> {
  const { PUT } = await import("./route");
  return PUT(pedido(corpo) as never);
}

/** Qual família tem chave: o resolvedor restrito a ela responde, ou não. */
function chavesDisponiveis(...familias: Array<"openai" | "google">) {
  vi.mocked(resolverChaveDeEmbedding).mockImplementation((async (
    _org: string,
    _ponto: string,
    opcoes?: { familia?: "openai" | "google" | null },
  ) => {
    const f = opcoes?.familia;
    if (f) return familias.includes(f) ? { provedor: f } : null;
    return familias[0] ? { provedor: familias[0] } : null;
  }) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  settingsNoBanco = { branding: { name: "Clínica X" }, base_de_conhecimento: { outro: 1 } };
  updates = [];
  linhasGravadas = 1;

  vi.mocked(requireSupportWrite).mockResolvedValue(null as never);
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: USER_ID, idioma: "pt-BR" },
    org: { orgId: ORG_ID, role: "admin" },
  } as never);
  vi.mocked(enfileirarTodosOsMateriais).mockResolvedValue({
    total: 3,
    prioridade1: 0,
    prioridade2: 3,
    emitidos: 3,
  });
  // Hoje: base indexada com a OpenAI, e as duas famílias têm chave.
  vi.mocked(familiaDaBase).mockResolvedValue({ familia: "openai", origem: "indice" });
  chavesDisponiveis("openai", "google");

  vi.mocked(createAdminClient).mockReturnValue({
    from: (tabela: string) => {
      if (tabela !== "organizations") throw new Error(`tabela não dublada: ${tabela}`);
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({
          data: settingsNoBanco === null ? null : { settings: settingsNoBanco },
          error: null,
        }),
        update: (valores: Record<string, unknown>) => {
          const filtros: Array<[string, unknown]> = [];
          updates.push({ valores, filtros });
          const u = {
            eq: (c: string, v: unknown) => (filtros.push([c, v]), u),
            select: () => u,
            maybeSingle: async () => ({
              data: linhasGravadas ? { id: ORG_ID } : null,
              error: null,
            }),
          };
          return u;
        },
      };
      return q;
    },
  } as never);
});

describe("PUT /api/v1/ai/knowledge/provedor", () => {
  it("exige admin e recusa quem não é", async () => {
    vi.mocked(requireRole).mockResolvedValueOnce({
      ok: false,
      response: new Response(null, { status: 403 }),
    } as never);
    const r = await chamar({ provedor: "google" });
    expect(r.status).toBe(403);
    expect(requireRole).toHaveBeenCalledWith(
      "admin",
      expect.objectContaining({ resource: "ai_knowledge" }),
    );
    expect(updates).toHaveLength(0);
    expect(enfileirarTodosOsMateriais).not.toHaveBeenCalled();
  });

  it("corpo fora do contrato: 422, e organização no corpo é recusada (strict)", async () => {
    expect((await chamar({ provedor: "anthropic" })).status).toBe(422);
    expect((await chamar({ provedor: "google", organization_id: "outra" })).status).toBe(422);
    expect(updates).toHaveLength(0);
  });

  it("para o Google: GRAVA a família da organização da sessão, em merge, refaz a base e audita", async () => {
    const r = await chamar({ provedor: "google" });
    expect(r.status).toBe(200);

    expect(updates).toHaveLength(1);
    expect(updates[0]!.filtros).toEqual([["id", ORG_ID]]);
    expect(updates[0]!.valores).toEqual({
      settings: {
        branding: { name: "Clínica X" },
        base_de_conhecimento: { outro: 1, familia: "google" },
      },
    });
    expect(enfileirarTodosOsMateriais).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_ID, motivo: "troca_de_provedor" }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai.knowledge_provider_changed",
        organizationId: ORG_ID,
        metadata: expect.objectContaining({ de: "openai", para: "google" }),
      }),
    );
  });

  it("para o Google sem chave do Google validada: 422 e nada muda", async () => {
    chavesDisponiveis("openai");
    const r = await chamar({ provedor: "google" });
    expect(r.status).toBe(422);
    expect(updates).toHaveLength(0);
    expect(enfileirarTodosOsMateriais).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("pedir o provedor que já vale não grava, não refaz a base nem audita", async () => {
    const r = await chamar({ provedor: "openai" });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { data: { mudou: boolean } }).data.mudou).toBe(false);
    expect(updates).toHaveLength(0);
    expect(enfileirarTodosOsMateriais).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("sem base nem escolha, o provedor atual é o da escada", async () => {
    vi.mocked(familiaDaBase).mockResolvedValue(null);
    chavesDisponiveis("google");
    const r = await chamar({ provedor: "google" });
    expect(((await r.json()) as { data: { mudou: boolean } }).data.mudou).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("de volta para a OpenAI: grava a família openai e refaz a base", async () => {
    vi.mocked(familiaDaBase).mockResolvedValue({ familia: "google", origem: "escolha" });
    const r = await chamar({ provedor: "openai" });
    expect(r.status).toBe(200);
    expect(updates[0]!.valores).toMatchObject({
      settings: { base_de_conhecimento: { familia: "openai" } },
    });
    expect(enfileirarTodosOsMateriais).toHaveBeenCalledTimes(1);
  });

  it("de volta para a OpenAI sem nenhuma chave OpenAI: 422 e a escolha do Google fica", async () => {
    vi.mocked(familiaDaBase).mockResolvedValue({ familia: "google", origem: "escolha" });
    chavesDisponiveis("google");
    const r = await chamar({ provedor: "openai" });
    expect(r.status).toBe(422);
    expect(updates).toHaveLength(0);
    expect(enfileirarTodosOsMateriais).not.toHaveBeenCalled();
  });

  it("escrita que casa zero linhas é 500, não 'trocado'", async () => {
    linhasGravadas = 0;
    const r = await chamar({ provedor: "google" });
    expect(r.status).toBe(500);
    expect(enfileirarTodosOsMateriais).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("organização não lida: não grava settings em branco por cima de tudo", async () => {
    settingsNoBanco = null;
    const r = await chamar({ provedor: "google" });
    expect(r.status).toBe(500);
    expect(updates).toHaveLength(0);
  });

  it("a troca vale mesmo se a fila falhar — e a resposta diz que a base não começou a ser refeita", async () => {
    vi.mocked(enfileirarTodosOsMateriais).mockRejectedValueOnce(
      new Error("listar_materiais_falhou"),
    );
    const r = await chamar({ provedor: "google" });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { data: { fila: unknown } }).data.fila).toBeNull();
    expect(updates).toHaveLength(1);
  });

  it("a família não pôde ser lida: 503, sem gravar, sem refazer a base", async () => {
    vi.mocked(familiaDaBase).mockRejectedValue(new FamiliaDaBaseIlegivelError(ORG_ID, "banco fora"));

    const res = await chamar({ provedor: "google" });

    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("upstream_unavailable");
    expect(updates).toEqual([]);
    expect(enfileirarTodosOsMateriais).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
});
