/**
 * A volta da Meta (conexão por um clique) DURANTE o onboarding.
 *
 * O defeito: `/auth/partner-return` mandava direto a `/app/connections`, e o
 * layout de `/app` manda toda empresa sem `onboarded_at` para `/onboarding` —
 * jogando fora `parceiro_estado`. Quem conectava pelo wizard autorizava na Meta,
 * voltava à pergunta do telefone e a conexão nunca era concluída.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: null as unknown,
  org: null as unknown,
  onboardedAt: null as string | null,
}));
vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: vi.fn(async () => h.user),
  resolveActiveOrg: vi.fn(async () => h.org),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const b = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => ({ data: { onboarded_at: h.onboardedAt }, error: null }),
      };
      return b;
    },
  }),
}));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://crm.exemplo" } }));

import { NextRequest } from "next/server";
import { GET } from "@/app/app/connections/volta-do-parceiro/route";

const pedir = (q: string) =>
  GET(new NextRequest(`https://crm.exemplo/app/connections/volta-do-parceiro?${q}`));

beforeEach(() => {
  h.user = { id: "u-1", support: null };
  h.org = { orgId: "org-1" };
  h.onboardedAt = null;
});

describe("/app/connections/volta-do-parceiro", () => {
  it("⭐ empresa no onboarding: volta ao PASSO DO TELEFONE, no caminho do parceiro, com os dados da volta", async () => {
    const r = await pedir("parceiro_estado=e1&parceiro_conta=c1&parceiro_perfil=p1&lixo=x");
    const destino = new URL(r.headers.get("location")!);
    expect(destino.pathname).toBe("/onboarding/connect-whatsapp");
    expect(Object.fromEntries(destino.searchParams)).toEqual({
      parceiro_estado: "e1",
      parceiro_conta: "c1",
      parceiro_perfil: "p1",
      forma: "parceiro",
    });
  });

  it("empresa já configurada: Conexões, aba do parceiro (o caminho de antes)", async () => {
    h.onboardedAt = "2026-10-01T00:00:00Z";
    const r = await pedir("parceiro_estado=e1&parceiro_erro=connection_cancelled");
    const destino = new URL(r.headers.get("location")!);
    expect(destino.pathname).toBe("/app/connections");
    expect(destino.searchParams.get("aba")).toBe("parceiro");
    expect(destino.searchParams.get("parceiro_erro")).toBe("connection_cancelled");
  });

  it("sem sessão: login", async () => {
    h.user = null;
    const r = await pedir("parceiro_estado=e1");
    expect(new URL(r.headers.get("location")!).pathname).toBe("/login");
  });
});
