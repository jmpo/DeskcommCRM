import { type NextRequest } from "next/server";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HealthStatus = "ok" | "warning" | "critical";

export interface WahaSession {
  id: string;
  waha_session_name: string | null;
  status: string | null;
  last_status_change_at: string | null;
  updated_at: string | null;
}

export interface TenantHealthResponse {
  waha: {
    sessions: WahaSession[];
    overall_status: HealthStatus;
  };
  nuvemshop: {
    connected: boolean;
    expires_at: string | null;
    last_synced_at: string | null;
    days_until_expiry: number | null;
    status: HealthStatus;
  };
  ai: {
    consumed_cents: number;
    budget_cents: number | null;
    percent_used: number | null;
    status: HealthStatus;
  };
  audit: {
    last_at: string | null;
    lag_seconds: number | null;
    status: HealthStatus;
  };
}

// ---------------------------------------------------------------------------
// Status computation
// ---------------------------------------------------------------------------

function wahaOverallStatus(sessions: WahaSession[]): HealthStatus {
  if (sessions.length === 0) return "warning";
  const hasWorking = sessions.some(
    (s) => s.status === "WORKING" || s.status === "CONNECTED",
  );
  const hasFailed = sessions.some(
    (s) => s.status === "FAILED" || s.status === "STOPPED",
  );
  if (hasFailed && !hasWorking) return "critical";
  if (!hasWorking) return "warning";
  return "ok";
}

function nuvemshopOverallStatus(
  connected: boolean,
  daysUntilExpiry: number | null,
): HealthStatus {
  if (!connected) return "warning";
  if (daysUntilExpiry !== null && daysUntilExpiry <= 0) return "critical";
  if (daysUntilExpiry !== null && daysUntilExpiry <= 7) return "warning";
  return "ok";
}

function aiOverallStatus(percentUsed: number | null): HealthStatus {
  if (percentUsed === null) return "ok";
  if (percentUsed >= 100) return "critical";
  if (percentUsed >= 80) return "warning";
  return "ok";
}

function auditOverallStatus(lagSeconds: number | null): HealthStatus {
  if (lagSeconds === null) return "warning";
  if (lagSeconds > 600) return "critical"; // > 10 min
  if (lagSeconds > 120) return "warning";  // > 2 min
  return "ok";
}

// ---------------------------------------------------------------------------
// GET /api/v1/admin/tenants/[id]/health
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = randomUUID();
  const { id } = await params;

  let adminCtx: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try {
    adminCtx = await requirePlatformAdmin();
  } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }

  const admin = createAdminClient();

  // 4 parallel queries — service-role, intentional cross-tenant reads.
  // organization_id is resolved from path (trusted), never from body.
  const [wahaRes, nuvemshopRes, aiRes, auditRes] = await Promise.all([
    admin
      .from("channel_sessions")
      // `last_qr_at` não existe em channel_sessions; o equivalente real é
      // `last_status_change_at` (quando a sessão mudou de estado pela última
      // vez — inclusive ao entrar em SCAN_QR_CODE).
      .select("id, waha_session_name, status, last_status_change_at, updated_at")
      .eq("organization_id", id),

    admin
      .from("tenant_integrations")
      // Duas colunas imaginadas aqui: `credentials` (o expires_at é coluna
      // própria da tabela, não uma chave dentro de um jsonb) e `last_synced_at`
      // (a real é `last_sync_at`, sem o "ed").
      .select("id, status, expires_at, last_sync_at, updated_at")
      .eq("organization_id", id)
      .eq("provider", "nuvemshop")
      .limit(1),

    admin
      .from("ai_budgets")
      // `monthly_budget_cents` → `monthly_limit_cents`: mesmo dado, nome real.
      .select("current_month_consumed_cents, monthly_limit_cents")
      .eq("organization_id", id),

    admin
      .from("api_audit_log")
      .select("created_at")
      .eq("organization_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  // --- WAHA ---
  const sessions = (wahaRes.data ?? []) as WahaSession[];
  const wahaStatus = wahaOverallStatus(sessions);

  // --- Nuvemshop ---
  type NuvemshopRow = {
    id: string;
    status: string | null;
    expires_at: string | null;
    last_sync_at: string | null;
    updated_at: string | null;
  };
  const nuRow = (nuvemshopRes.data?.[0] as NuvemshopRow | undefined) ?? null;
  const nuConnected = !!nuRow && nuRow.status === "active";
  const nuExpiresAt = nuRow?.expires_at ?? null;
  const nuDaysUntilExpiry = nuExpiresAt
    ? Math.floor(
        (new Date(nuExpiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      )
    : null;
  const nuStatus = nuvemshopOverallStatus(nuConnected, nuDaysUntilExpiry);

  // --- AI Budget ---
  type AiBudgetRow = {
    current_month_consumed_cents: number | null;
    monthly_limit_cents: number | null;
  };
  const aiRows = (aiRes.data ?? []) as AiBudgetRow[];
  const consumedCents = aiRows.reduce(
    (acc, r) => acc + (r.current_month_consumed_cents ?? 0),
    0,
  );
  const firstAiRow = aiRows[0];
  const budgetCents = firstAiRow ? (firstAiRow.monthly_limit_cents ?? null) : null;
  const percentUsed =
    budgetCents && budgetCents > 0
      ? Math.round((consumedCents / budgetCents) * 100)
      : null;
  const aiStatus = aiOverallStatus(percentUsed);

  // --- Audit lag ---
  const lastAuditAt = auditRes.data?.created_at ?? null;
  const lagSeconds = lastAuditAt
    ? Math.round((Date.now() - new Date(lastAuditAt).getTime()) / 1000)
    : null;
  const auditStatus = auditOverallStatus(lagSeconds);

  const health: TenantHealthResponse = {
    waha: { sessions, overall_status: wahaStatus },
    nuvemshop: {
      connected: nuConnected,
      expires_at: nuExpiresAt,
      // Nome de SAÍDA fica `last_synced_at` de propósito: é o que o HealthGrid
      // já lê. Só a coluna de origem estava errada.
      last_synced_at: nuRow?.last_sync_at ?? null,
      days_until_expiry: nuDaysUntilExpiry,
      status: nuStatus,
    },
    ai: {
      consumed_cents: consumedCents,
      budget_cents: budgetCents,
      percent_used: percentUsed,
      status: aiStatus,
    },
    audit: {
      last_at: lastAuditAt,
      lag_seconds: lagSeconds,
      status: auditStatus,
    },
  };

  // Audit lightweight — fire-and-forget
  void audit({
    action: "platform_admin.tenant_health_viewed",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: id,
    resourceType: "organization",
    resourceId: id,
    requestId,
  });

  return ok(health, { requestId });
}
