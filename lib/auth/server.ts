/**
 * Server-side auth helpers — load AuthUser, resolve active org, gate routes.
 *
 * Uses the service-role admin client to read tenant-scoped tables
 * (`user_organizations`, `platform_admins`, `organizations`) — RLS bypass is
 * intentional here because we resolve the user from the validated JWT first
 * and then filter by `user_id` (a trusted source).
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import type { AuthUser, Role, UserOrgMembership, ActiveOrg } from "./types";

const ACTIVE_ORG_COOKIE = "active_org";

interface RawMembershipRow {
  organization_id: string;
  role: string;
  organizations: { display_name: string } | { display_name: string }[] | null;
}

/**
 * Loads the AuthUser for the current request. Returns null if unauthenticated.
 * Use only in Server Components / Route Handlers / Server Actions.
 *
 * Uses the user-scoped server client (cookie session). RLS policies allow:
 * - user_organizations: user_id = auth.uid() (user_orgs_select)
 * - organizations: id IN fn_user_org_ids()  (orgs_select)
 * - platform_admins: only platform admins read (so non-admins get null — correct)
 */
export async function loadAuthUser(): Promise<AuthUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Platform admin? (active = no revoked_at). RLS returns null for non-admins.
  //
  // ⚠️ O erro é capturado de propósito: aqui `data: null` é AMBÍGUO — significa tanto
  // "não é platform admin" (RLS filtrou, estado normal) quanto "a query falhou".
  // Sem separar os dois, um banco instável rebaixa silenciosamente um super-admin.
  const { data: paRow, error: paErro } = await supabase
    .from("platform_admins")
    .select("user_id, revoked_at")
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .maybeSingle();

  // Org memberships (only active = not revoked, accepted)
  const { data: rawMemberships, error: membErro } = await supabase
    .from("user_organizations")
    .select("organization_id, role, organizations(display_name)")
    .eq("user_id", user.id)
    .is("revoked_at", null);

  /**
   * FALHA ALTO, não baixo.
   *
   * Antes, o erro destas duas queries era descartado e `rawMemberships` nulo virava
   * `[]` — ou seja, "usuário sem organização". O resultado é que uma instabilidade do
   * banco chega ao operador como **"você não pertence a nenhuma organização"**: as
   * telas de admin somem, as rotas devolvem 403, e nada indica que a causa é
   * infraestrutura.
   *
   * Medido em 2026-07-30: com o PostgREST devolvendo `name resolution failed` depois
   * de um restart do Docker, TODOS os cards de admin sumiram do hub de configurações.
   * Custou seis diagnósticos errados — build velho, processo velho, cache, filtro de
   * papel — antes de alguém olhar a causa real.
   *
   * Degradar permissão em silêncio é o pior desfecho possível num caminho de auth:
   * parece uma decisão de autorização e é um defeito de infra. Melhor estourar e
   * mostrar erro do que renderizar uma UI mentirosa.
   */
  if (paErro || membErro) {
    const detalhe = (paErro ?? membErro)!;
    logger.error("[auth] não foi possível resolver permissões do usuário", {
      user_id: user.id,
      onde: paErro ? "platform_admins" : "user_organizations",
      code: detalhe.code,
      message: detalhe.message,
    });
    throw new Error(
      `auth_permissions_unavailable: ${detalhe.message} — permissões não puderam ser ` +
        `resolvidas; a sessão NÃO foi rebaixada por decisão de autorização.`,
    );
  }

  const rows = (rawMemberships ?? []) as RawMembershipRow[];
  const memberships: UserOrgMembership[] = rows.map((row) => {
    const orgs = row.organizations;
    const name = Array.isArray(orgs) ? (orgs[0]?.display_name ?? "—") : (orgs?.display_name ?? "—");
    return {
      organization_id: row.organization_id,
      organization_name: name,
      role: row.role as Role,
    };
  });

  const fullName = (user.user_metadata?.full_name as string | undefined) ?? null;
  const avatarUrl = (user.user_metadata?.avatar_url as string | undefined) ?? null;
  const locale = (user.user_metadata?.locale as string | undefined) ?? null;

  return {
    id: user.id,
    email: user.email ?? "",
    full_name: fullName,
    avatar_url: avatarUrl,
    is_platform_admin: !!paRow,
    locale,
    organizations: memberships,
  };
}

/**
 * Resolves the active organization for the current request.
 * Priority: cookie `active_org` (if member of) → first membership.
 * Returns null if user has zero memberships.
 */
export async function resolveActiveOrg(authUser: AuthUser): Promise<ActiveOrg | null> {
  if (authUser.organizations.length === 0) return null;
  const store = await cookies();
  const cookieOrg = store.get(ACTIVE_ORG_COOKIE)?.value;
  if (cookieOrg) {
    const found = authUser.organizations.find((o) => o.organization_id === cookieOrg);
    if (found) {
      return { orgId: found.organization_id, name: found.organization_name, role: found.role };
    }
  }
  const first = authUser.organizations[0];
  if (!first) return null;
  return { orgId: first.organization_id, name: first.organization_name, role: first.role };
}

/**
 * For Server Components / Server Actions in /app/(app)/* routes — guarantees
 * an authenticated user. Redirects to /login if not.
 */
export async function requireAuth(): Promise<AuthUser> {
  const user = await loadAuthUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Returns true if the current session has at least one verified TOTP factor.
 * Use only in Server Components / Server Actions (cookie session).
 */
export async function isMfaEnrolled(): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.auth.mfa.listFactors();
  return !!data?.totp?.some((f) => f.status === "verified");
}

/**
 * MFA enforcement policy: platform admins and tenant `admin` role MUST enroll.
 * `manager`/`agent`/`viewer` are optional in MVP.
 */
export function requiresMfa(role: Role | undefined, isPlatformAdmin: boolean): boolean {
  return isPlatformAdmin || role === "admin";
}

/**
 * Nível de garantia da SESSÃO atual: `aal2` = o segundo fator foi provado nesta
 * sessão; `aal1` = só a senha.
 *
 * Isto responde uma pergunta diferente de `isMfaEnrolled()`, e a diferença é o
 * achado que motivou este helper: "tem fator cadastrado" é política de
 * CADASTRO; "provou o fator agora" é política de SESSÃO. O produto só tinha a
 * primeira, então uma sessão `aal1` de um admin com TOTP cadastrado era
 * plenamente funcional — o cenário exato que a MFA existe para conter (senha
 * vazada/phishing).
 */
export async function sessionAal(): Promise<"aal1" | "aal2" | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  // O tipo do SDK é `"aal1" | "aal2" | (string & {})` — aberto de propósito, para
  // aceitar níveis futuros. Estreitar aqui mantém a decisão em quem chama.
  const nivel: string | null | undefined = data?.currentLevel;
  return nivel === "aal1" || nivel === "aal2" ? nivel : null;
}

/**
 * A sessão está em dívida com a MFA? Verdadeiro só quando as TRÊS valem:
 * o papel exige MFA, o usuário JÁ cadastrou um fator, e a sessão é `aal1`.
 *
 * A condição do meio não é detalhe: sem ela, o admin que ainda não cadastrou
 * ficaria trancado do lado de fora — inclusive das rotas necessárias para
 * cadastrar. Quem ainda não tem fator continua sendo tratado pelo gate de
 * cadastro do `app/app/layout.tsx`.
 */
export async function mfaEmDivida(role: Role | undefined, isPlatformAdmin: boolean): Promise<boolean> {
  if (!requiresMfa(role, isPlatformAdmin)) return false;
  if (!(await isMfaEnrolled())) return false;
  return (await sessionAal()) !== "aal2";
}
