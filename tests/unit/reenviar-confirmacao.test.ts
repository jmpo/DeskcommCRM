/**
 * "Reenviar e-mail de confirmação" (QA de 26/10/2026): o e-mail caiu no spam e
 * a pessoa não tinha como pedir outro. A resposta é a MESMA para qualquer
 * endereço — a tela nunca vira oráculo de quem tem conta.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  audit: vi.fn(async () => undefined),
}));

const reenviar = vi.fn();

beforeEach(() => {
  vi.resetModules();
  reenviar.mockReset();
  vi.mocked(headers).mockResolvedValue({
    get: (k: string) =>
      k === "x-forwarded-for"
        ? `192.0.2.${Math.floor(Math.random() * 250)}`
        : k === "origin"
          ? "https://crm.exemplo"
          : null,
  } as never);
  vi.mocked(createClient).mockResolvedValue({ auth: { resend: reenviar } } as never);
});

describe("reenviarConfirmacao", () => {
  it("⭐ pede ao provedor o reenvio do CADASTRO, voltando para /auth/confirm?type=signup", async () => {
    reenviar.mockResolvedValue({ data: {}, error: null });
    const { reenviarConfirmacao } = await import("@/app/actions/auth/reenviarConfirmacao");
    expect(await reenviarConfirmacao("alguem@exemplo.py")).toEqual({ ok: true });
    expect(reenviar).toHaveBeenCalledWith({
      type: "signup",
      email: "alguem@exemplo.py",
      options: { emailRedirectTo: "https://crm.exemplo/auth/confirm?type=signup" },
    });
  });

  it("⭐ erro do provedor que depende do ENDEREÇO não aparece: a resposta é a mesma", async () => {
    reenviar.mockResolvedValue({
      data: null,
      error: { status: 400, message: "Email address not confirmed or not found" },
    });
    const { reenviarConfirmacao } = await import("@/app/actions/auth/reenviarConfirmacao");
    expect(await reenviarConfirmacao("nao-existe@exemplo.py")).toEqual({ ok: true });
  });

  it("instalação sem e-mail configurado: diz isso (depende da instalação, não do endereço)", async () => {
    reenviar.mockResolvedValue({
      data: null,
      error: { status: 500, message: "Error sending confirmation email" },
    });
    const { reenviarConfirmacao } = await import("@/app/actions/auth/reenviarConfirmacao");
    expect(await reenviarConfirmacao("x@exemplo.py")).toEqual({
      ok: false,
      error: "email_indisponivel",
    });
  });

  it("teto por endereço: a 4ª tentativa na hora não chega ao provedor", async () => {
    reenviar.mockResolvedValue({ data: {}, error: null });
    const { reenviarConfirmacao } = await import("@/app/actions/auth/reenviarConfirmacao");
    const r: unknown[] = [];
    for (let i = 0; i < 4; i++) r.push(await reenviarConfirmacao("insistente@exemplo.py"));
    expect(r[3]).toEqual({ ok: false, error: "rate_limited" });
    expect(reenviar).toHaveBeenCalledTimes(3);
  });

  it("e-mail inválido nem chega ao provedor", async () => {
    const { reenviarConfirmacao } = await import("@/app/actions/auth/reenviarConfirmacao");
    expect(await reenviarConfirmacao("nao-e-email")).toEqual({
      ok: false,
      error: "validation_error",
    });
    expect(reenviar).not.toHaveBeenCalled();
  });
});
