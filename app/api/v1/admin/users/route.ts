import { type NextRequest } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const querySchema = z.object({
  tenant_id: z.string().uuid().optional(),
  role: z.enum(["viewer", "agent", "manager", "admin"]).optional(),
  q: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

// ---------------------------------------------------------------------------
// Cursor helpers
// ---------------------------------------------------------------------------

interface CursorPayload {
  last_sign_in_at: string | null;
  user_id: string;
  organization_id: string;
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeCursor(cursor: string): CursorPayload | null {
  try {
    return JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf-8"),
    ) as CursorPayload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/admin/users
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const requestId = randomUUID();

  let adminCtx: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try {
    adminCtx = await requirePlatformAdmin();
  } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }

  const parsed = querySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  if (!parsed.success) {
    return fail("validation_error", "Invalid query params", 400, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const { tenant_id, role, q, cursor, limit } = parsed.data;
  const admin = createAdminClient();
  const cursorPayload = cursor ? decodeCursor(cursor) : null;

  // Build raw SQL — Supabase JS client cannot do cross-schema JOINs to auth.users
  // via the normal .from() API. We use rpc or raw query via postgrest.
  // Strategy: query user_organizations joined with organizations and auth.users.
  // Since supabase-js can't directly query auth.users, we use the admin auth API
  // to list users and join in application memory — but that's N+1 for large sets.
  //
  // Better: use rpc with a postgres function, or query via service-role
  // which CAN access auth.users through the postgres connection.
  // We'll use admin.rpc with a custom query approach.
  //
  // For simplicity and correctness, we'll use admin.from() on user_organizations
  // and then enrich with auth.admin.listUsers() — but that's paginated differently.
  //
  // Cleanest approach: execute raw SQL via supabase-js's .rpc() calling pg function,
  // or use the fact that service-role can SELECT from auth.users via
  // admin.schema('auth').from('users').
  //
  // Supabase admin client with service role can access auth schema views.
  // We use admin.schema('auth').from('users') for the user data.

  // Step 1: query user_organizations + organizations
  type UoRow = {
    user_id: string;
    organization_id: string;
    role: string;
    accepted_at: string | null;
    revoked_at: string | null;
    organizations: {
      display_name: string;
      slug: string;
    } | null;
  };

  let uoQuery = admin
    .from("user_organizations")
    .select(
      `
      user_id,
      organization_id,
      role,
      accepted_at,
      revoked_at,
      organizations!inner(display_name, slug)
    `,
    )
    .order("user_id", { ascending: false });

  if (tenant_id) {
    uoQuery = uoQuery.eq("organization_id", tenant_id);
  }
  if (role) {
    uoQuery = uoQuery.eq("role", role);
  }

  const { data: uoRows, error: uoError } = await uoQuery;

  if (uoError) {
    return fail("internal_error", "Query failed", 500, {
      requestId,
      details: uoError.message,
    });
  }

  if (!uoRows || uoRows.length === 0) {
    void audit({
      action: "platform_admin.users_listed",
      actorUserId: adminCtx.user.id,
      actingAsPlatformAdmin: true,
      bypassedRls: true,
      requestId,
      metadata: { filters: { tenant_id, role, has_q: !!q }, result_count: 0 },
    });
    return ok([], { requestId, meta: { has_more: false, cursor: null } });
  }

  // Step 2: get unique user IDs
  const userIds = [...new Set((uoRows as unknown as UoRow[]).map((r) => r.user_id))];

  // Step 3: fetch auth users via the Auth Admin API.
  //
  // O comentário acima (mantido como histórico do raciocínio) apostava que o
  // service role conseguiria ler `auth.users` pelo PostgREST. Não consegue: o
  // Supabase expõe apenas `public` e `graphql_public`, então `.schema("auth")`
  // responde PGRST106 ("Invalid schema: auth") e esta listagem devolvia 500 em
  // toda requisição. `getUserById` fala com o GoTrue, que não tem essa
  // restrição.
  type AuthUser = {
    id: string;
    email: string | null;
    last_sign_in_at: string | null;
    created_at: string;
    raw_user_meta_data: Record<string, unknown> | null;
  };

  const resolvedUsers = await Promise.all(
    userIds.map(async (uid) => {
      const { data, error } = await admin.auth.admin.getUserById(uid);
      // Vínculo apontando para usuário já removido do Auth: some da lista em
      // vez de derrubar a página inteira.
      if (error || !data?.user) return null;
      return {
        id: data.user.id,
        email: data.user.email ?? null,
        last_sign_in_at: data.user.last_sign_in_at ?? null,
        created_at: data.user.created_at,
        raw_user_meta_data:
          (data.user.user_metadata as Record<string, unknown> | null) ?? null,
      } satisfies AuthUser;
    }),
  );

  const authMap = new Map<string, AuthUser>(
    resolvedUsers.filter((u): u is AuthUser => u !== null).map((u) => [u.id, u]),
  );

  // Step 4: build joined rows
  type JoinedRow = {
    user_id: string;
    organization_id: string;
    role: string;
    accepted_at: string | null;
    revoked_at: string | null;
    tenant_name: string;
    tenant_slug: string;
    email: string | null;
    full_name: string | null;
    last_sign_in_at: string | null;
    created_at: string;
  };

  let joined: JoinedRow[] = (uoRows as unknown as UoRow[]).flatMap((uo) => {
    const u = authMap.get(uo.user_id);
    if (!u) return [];
    const org = uo.organizations;
    if (!org) return [];
    return [
      {
        user_id: uo.user_id,
        organization_id: uo.organization_id,
        role: uo.role,
        accepted_at: uo.accepted_at,
        revoked_at: uo.revoked_at,
        tenant_name: org.display_name,
        tenant_slug: org.slug,
        email: u.email ?? null,
        full_name:
          (u.raw_user_meta_data?.full_name as string | undefined) ?? null,
        last_sign_in_at: u.last_sign_in_at,
        created_at: u.created_at,
      },
    ];
  });

  // Step 5: apply q filter (email or full_name ilike)
  if (q) {
    const lq = q.toLowerCase();
    joined = joined.filter(
      (r) =>
        r.email?.toLowerCase().includes(lq) ||
        r.full_name?.toLowerCase().includes(lq),
    );
  }

  // Step 6: sort by last_sign_in_at desc nulls last, then user_id+org_id
  joined.sort((a, b) => {
    if (!a.last_sign_in_at && !b.last_sign_in_at) {
      return a.user_id < b.user_id ? -1 : 1;
    }
    if (!a.last_sign_in_at) return 1;
    if (!b.last_sign_in_at) return -1;
    const diff =
      new Date(b.last_sign_in_at).getTime() -
      new Date(a.last_sign_in_at).getTime();
    if (diff !== 0) return diff;
    const uid = a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0;
    if (uid !== 0) return uid;
    return a.organization_id < b.organization_id ? -1 : 1;
  });

  // Step 7: apply cursor
  if (cursorPayload) {
    const { last_sign_in_at: cLsi, user_id: cUid, organization_id: cOid } =
      cursorPayload;
    const cursorIdx = joined.findIndex(
      (r) =>
        r.last_sign_in_at === cLsi &&
        r.user_id === cUid &&
        r.organization_id === cOid,
    );
    if (cursorIdx !== -1) {
      joined = joined.slice(cursorIdx + 1);
    }
  }

  // Step 8: paginate
  const has_more = joined.length > limit;
  const page = has_more ? joined.slice(0, limit) : joined;
  const lastRow = page.at(-1);
  const nextCursor =
    has_more && lastRow
      ? encodeCursor({
          last_sign_in_at: lastRow.last_sign_in_at,
          user_id: lastRow.user_id,
          organization_id: lastRow.organization_id,
        })
      : null;

  void audit({
    action: "platform_admin.users_listed",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    requestId,
    metadata: {
      filters: { tenant_id, role, has_q: !!q },
      result_count: page.length,
    },
  });

  return ok(page, { requestId, meta: { has_more, cursor: nextCursor } });
}
