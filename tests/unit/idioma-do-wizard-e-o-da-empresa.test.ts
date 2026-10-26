/**
 * O seletor de idioma DO WIZARD troca também o idioma da EMPRESA nova — e só
 * enquanto ela está no onboarding, e só para quem a administra.
 *
 * O seletor do topo de `/app` grava só a preferência da pessoa, e de propósito
 * (lá a empresa tem colegas). No wizard, trocar só a pessoa deixaria a tela em
 * espanhol e o agente nascendo em português — o defeito do QA de 26/10/2026 por
 * outra porta.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  papel: "admin",
  linhasAtualizadas: [{ id: "org-1" }] as unknown[],
  updates: [] as { payload: Record<string, unknown>; filtros: Record<string, unknown> }[],
  updateUser: vi.fn(async () => ({ error: null })),
  localizar: vi.fn(async () => ({ etapas: 8, tipos: 1 })),
}));

vi.mock("next/headers", () => ({ headers: vi.fn(async () => ({ get: () => null })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/onboarding/semeadura-no-idioma", () => ({ localizarSemeadura: h.localizar }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { updateUser: h.updateUser } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const e = { payload: {} as Record<string, unknown>, filtros: {} as Record<string, unknown> };
      const b = {
        update: (p: Record<string, unknown>) => ((e.payload = p), b),
        eq: (c: string, v: unknown) => ((e.filtros[c] = v), b),
        is: (c: string, v: unknown) => ((e.filtros[c] = v), b),
        select: async () => {
          h.updates.push(e);
          return { data: h.linhasAtualizadas, error: null };
        },
      };
      return b;
    },
  }),
}));
vi.mock("@/app/actions/onboarding/_shared", () => ({
  requireOnboardingCtx: async () => ({
    userId: "u-1",
    orgId: "org-1",
    orgName: "X",
    role: h.papel,
  }),
  OnboardingError: class extends Error {
    code = "x";
  },
}));

import { trocarIdiomaNoOnboarding } from "@/app/actions/onboarding/trocarIdiomaNoOnboarding";

beforeEach(() => {
  h.papel = "admin";
  h.linhasAtualizadas = [{ id: "org-1" }];
  h.updates.length = 0;
  h.updateUser.mockClear();
  h.localizar.mockClear();
});

describe("trocarIdiomaNoOnboarding", () => {
  it("⭐ admin no wizard: a pessoa, a EMPRESA (só a que ainda não terminou) e os nomes semeados", async () => {
    expect(await trocarIdiomaNoOnboarding("es")).toEqual({ ok: true });
    expect(h.updateUser).toHaveBeenCalledWith({ data: { locale: "es" } });
    expect(h.updates[0]).toEqual({
      payload: { locale: "es" },
      filtros: { id: "org-1", onboarded_at: null },
    });
    expect(h.localizar).toHaveBeenCalledWith(expect.anything(), "org-1", "es");
  });

  it("empresa que já terminou o onboarding (a escrita casa zero linhas): os nomes ficam como estão", async () => {
    h.linhasAtualizadas = [];
    await trocarIdiomaNoOnboarding("es");
    expect(h.localizar).not.toHaveBeenCalled();
  });

  it("quem não administra a empresa troca só o próprio idioma", async () => {
    h.papel = "agent";
    await trocarIdiomaNoOnboarding("es");
    expect(h.updateUser).toHaveBeenCalled();
    expect(h.updates).toHaveLength(0);
  });

  it("idioma que o produto não serve é recusado antes de tocar em qualquer coisa", async () => {
    expect(await trocarIdiomaNoOnboarding("zh-CN" as never)).toEqual({
      ok: false,
      error: "idioma_desconhecido",
    });
    expect(h.updateUser).not.toHaveBeenCalled();
  });
});
