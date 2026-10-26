import { NextResponse, type NextRequest } from "next/server";

import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * A segunda metade da volta da conexão por UM CLIQUE: decide ONDE a tela que
 * conclui a conexão está.
 *
 * `/auth/partner-return/<estado>` é pública (o cookie Strict não vem na volta
 * de outro site) e só repassa à ponte same-origin. Até aqui ela repassava
 * direto a `/app/connections` — e isso quebrava quem conectava DENTRO do
 * onboarding: o layout de `/app` manda toda empresa sem `onboarded_at` para
 * `/onboarding`, e o redirect jogava fora `parceiro_estado`/`parceiro_conta`.
 * A pessoa autorizava na Meta, voltava ao passo do telefone com a pergunta de
 * novo, e a conexão nunca era concluída.
 *
 * Esta rota já roda COM sessão (a ponte é same-origin), lê se a empresa está no
 * onboarding e manda para a tela certa — o passo do telefone ou Conexões —,
 * levando só os parâmetros da volta, que a tela entrega ao servidor para
 * conferir. Não grava nada.
 */
const PARAMETROS_DA_VOLTA = [
  "parceiro_estado",
  "parceiro_conta",
  "parceiro_perfil",
  "parceiro_erro",
] as const;

export async function GET(request: NextRequest) {
  const para = (caminho: string) =>
    NextResponse.redirect(new URL(caminho, env.NEXT_PUBLIC_APP_URL));
  const user = await loadAuthUser();
  if (!user) return para("/login");

  const q = new URLSearchParams();
  for (const p of PARAMETROS_DA_VOLTA) {
    const v = request.nextUrl.searchParams.get(p);
    if (v) q.set(p, v);
  }

  const org = await resolveActiveOrg(user);
  let noOnboarding = false;
  if (org && !user.support) {
    const { data } = await createAdminClient()
      .from("organizations")
      .select("onboarded_at")
      .eq("id", org.orgId)
      .maybeSingle();
    noOnboarding = Boolean(data) && !(data as { onboarded_at: string | null }).onboarded_at;
  }

  if (noOnboarding) {
    q.set("forma", "parceiro");
    return para(`/onboarding/connect-whatsapp?${q.toString()}`);
  }
  q.set("aba", "parceiro");
  return para(`/app/connections?${q.toString()}`);
}
