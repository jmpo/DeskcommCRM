import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { isMfaEnrolled, loadAuthUser, requiresMfa, resolveActiveOrg } from "@/lib/auth/server";
import { DEFAULT_VISIBILITY_MODE, type VisibilityMode } from "@/lib/auth/types";
import { AuthProvider } from "@/hooks/auth/AuthProvider";
import { AppShell } from "./_components/AppShell";
import { MfaEnrollGate } from "@/components/auth/MfaEnrollGate";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  IMPERSONATE_COOKIE_NAME,
  verifyImpersonateCookie,
} from "@/lib/impersonate/cookie";
import {
  ImpersonateBanner,
  type ImpersonatingInfo,
} from "@/components/app/ImpersonateBanner";
import { ConexaoCaidaBanner } from "@/components/app/ConexaoCaidaBanner";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";
import { listarConexoesCaidas, type ConexaoCaida } from "@/lib/channels/health";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await loadAuthUser();
  if (!user) redirect("/login");

  let activeOrg = await resolveActiveOrg(user);

  // EPIC-02: gate /app/* on completed onboarding.
  // EPIC-11: gate /app/* on org not being suspended (S-11.08).
  if (activeOrg) {
    const admin = createAdminClient();
    const { data: orgRow } = await admin
      .from("organizations")
      .select("onboarded_at, status, settings")
      .eq("id", activeOrg.orgId)
      .maybeSingle();
    if (orgRow && !orgRow.onboarded_at) redirect("/onboarding");
    if (orgRow?.status === "suspended") redirect("/account-suspended");
    // G4-02: expõe visibility_mode ao client (inbox decide visões visíveis).
    // Fonte confiável (admin client, org do cookie validado) — nunca do body.
    const mode = (orgRow?.settings as { visibility_mode?: VisibilityMode } | null)
      ?.visibility_mode;
    activeOrg = { ...activeOrg, visibility_mode: mode ?? DEFAULT_VISIBILITY_MODE };
  }

  // A conexão caiu? A consulta mora no seam (`lib/channels/health`), não aqui:
  // tela que monta o select de `channel_sessions` à mão foi o que deixou três
  // seletores oferecendo canal arquivado, e o invariante `canais-selecionaveis`
  // existe por causa disso. De quebra, o filtro de estados fica LITERALMENTE o
  // mesmo que decide o aviso da Central — duas listas divergiriam com o tempo.
  const conexoesCaidas: ConexaoCaida[] = activeOrg
    ? await listarConexoesCaidas(createAdminClient(), activeOrg.orgId)
    : [];

  // Read sidebar collapsed state SSR to avoid flash.
  const store = await cookies();
  const collapsed = store.get("sidebar_collapsed")?.value === "1";

  // Impersonate (S-11.07): verify cookie server-side and resolve tenant name.
  // Middleware already validates HMAC + expiry on /app/*; we re-verify here as
  // defence-in-depth and to extract the payload safely.
  let impersonating: ImpersonatingInfo | null = null;
  const impCookie = store.get(IMPERSONATE_COOKIE_NAME)?.value;
  if (impCookie) {
    const result = verifyImpersonateCookie(impCookie);
    if (result.valid && result.payload) {
      const admin = createAdminClient();
      const { data: org } = await admin
        .from("organizations")
        .select("display_name")
        .eq("id", result.payload.tenantId)
        .maybeSingle();
      if (org) {
        impersonating = {
          tenantId: result.payload.tenantId,
          tenantName: org.display_name,
          expiresAt: new Date(result.payload.exp * 1000).toISOString(),
        };
      }
    }
  }

  const enrolled = await isMfaEnrolled();
  const needsMfaGate = requiresMfa(activeOrg?.role, user.is_platform_admin);
  const shell = <AppShell sidebarCollapsed={collapsed}>{children}</AppShell>;

  return (
    // O idioma envolve a árvore inteira e recebe o código PRONTO — ele não
    // pergunta quem está logado. Ver `lib/i18n/IdiomaProvider`: foi o
    // acoplamento com a autenticação que derrubou 32 casos.
    <IdiomaProvider locale={user.locale}>
    <AuthProvider user={user} activeOrg={activeOrg}>
      <ImpersonateBanner impersonating={impersonating} />
      <ConexaoCaidaBanner caidas={conexoesCaidas} />
      {needsMfaGate ? (
        // Gate always mounted for MFA-required roles; it latches the blocking
        // decision client-side so the enroll Server Action's revalidation
        // can't tear down the recovery-codes screen mid-flow.
        <MfaEnrollGate enrolled={enrolled}>{shell}</MfaEnrollGate>
      ) : (
        shell
      )}
    </AuthProvider>
    </IdiomaProvider>
  );
}
