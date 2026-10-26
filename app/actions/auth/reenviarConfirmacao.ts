"use server";

import { headers } from "next/headers";

import { audit, hashEmail } from "@/lib/audit";
import { AUTH_LIMITS, authRateLimited } from "@/lib/auth/rate-limit";
import { forgotPasswordSchema } from "@/lib/auth/schemas";
import { env } from "@/lib/env";
import { ipDoCliente } from "@/lib/http/ip-do-cliente";
import { createClient } from "@/lib/supabase/server";

export type ReenviarConfirmacaoResult =
  { ok: true } | { ok: false; error: "validation_error" | "rate_limited" | "email_indisponivel" };

/**
 * Reenvia o e-mail de confirmação do cadastro.
 *
 * ─── O beco que isto fecha ─────────────────────────────────────────────────
 *
 * Medido em produção (QA de 26/10/2026): o e-mail de confirmação caiu no spam,
 * a pessoa tentou entrar e leu "E-mail ou senha incorretos" — falso, a senha
 * estava certa — e a tela "Confirme seu e-mail" não tinha botão nenhum. O único
 * caminho era criar a conta de novo, e o cadastro com o mesmo e-mail responde
 * sucesso sem mandar nada (anti-enumeração).
 *
 * ─── Anti-enumeração ───────────────────────────────────────────────────────
 *
 * A resposta é a MESMA para e-mail que existe, que não existe ou que já foi
 * confirmado: `auth.resend` do GoTrue não revela qual é o caso, e esta action
 * não distingue o que ele devolve além de "limite" e "sem e-mail configurado"
 * (que dependem da instalação, não do endereço). O teto é o do "esqueci a
 * senha", por IP e por endereço.
 */
export async function reenviarConfirmacao(email: string): Promise<ReenviarConfirmacaoResult> {
  const parsed = forgotPasswordSchema.safeParse({ email });
  if (!parsed.success) return { ok: false, error: "validation_error" };

  const hdrs = await headers();
  const origin = hdrs.get("origin") ?? env.NEXT_PUBLIC_APP_URL;

  if (await authRateLimited("resend_signup", parsed.data.email, AUTH_LIMITS.resend_signup)) {
    return { ok: false, error: "rate_limited" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: parsed.data.email,
    // O mesmo destino do `signUp`: `?type=signup` é o que `/auth/confirm` lê
    // para saber que é a confirmação do cadastro.
    options: { emailRedirectTo: `${origin}/auth/confirm?type=signup` },
  });

  if (error) {
    if (error.status === 429) return { ok: false, error: "rate_limited" };
    // Mesmo critério do `signUp`: sem SMTP no serviço de login, tentar de novo
    // nunca funciona. Não fura a anti-enumeração — depende da instalação.
    if (/error sending/i.test(error.message)) return { ok: false, error: "email_indisponivel" };
  }

  await audit({
    action: "auth.signup_confirmation_resent",
    metadata: {
      email_hash: hashEmail(parsed.data.email),
      ...(error ? { reason: error.message.slice(0, 200) } : {}),
    },
    requestId: hdrs.get("x-request-id"),
    ip: ipDoCliente(hdrs),
    userAgent: hdrs.get("user-agent") ?? null,
  });

  return { ok: true };
}
