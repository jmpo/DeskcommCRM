"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import {
  ativarAgenteDoOnboarding,
  type ResultadoDaAtivacao,
} from "@/lib/ai/agents/ativar-agente-do-onboarding";
import { loadAuthUser, mfaEmDivida, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { supportWriteError } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * O botão "Ativar agora" da faixa do topo: o número já está conectado e o
 * agente que o onboarding montou segue em rascunho (conectado por um caminho
 * que não o ativa sozinho — o código no celular, por exemplo).
 *
 * Mesma régua de quem publica agente pela API (`admin`), sem acompanhamento e
 * com o MFA em dia. A organização vem da sessão, nunca do corpo.
 */
export async function ativarAgente(): Promise<
  { ok: true; estado: ResultadoDaAtivacao["estado"] } | { ok: false; error: string }
> {
  const user = await loadAuthUser();
  if (!user) return { ok: false, error: "unauthenticated" };
  if (supportWriteError(user.support)) return { ok: false, error: "forbidden" };
  const org = await resolveActiveOrg(user);
  if (!org) return { ok: false, error: "forbidden_tenant" };
  if (ROLE_RANK[org.role] < ROLE_RANK.admin) return { ok: false, error: "forbidden_role" };
  if (await mfaEmDivida()) return { ok: false, error: "mfa_required" };

  const resultado = await ativarAgenteDoOnboarding(createAdminClient(), org.orgId, user.id, {
    origem: "faixa_do_topo",
    requestId: (await headers()).get("x-request-id"),
  });
  revalidatePath("/app", "layout");
  return { ok: true, estado: resultado.estado };
}
