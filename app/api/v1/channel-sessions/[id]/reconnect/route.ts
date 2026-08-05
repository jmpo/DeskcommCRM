/**
 * POST /api/v1/channel-sessions/[id]/reconnect — reconecta um canal caído.
 *
 * Dois modos, porque "caiu" tem duas causas com custos bem diferentes:
 *
 *  - PADRÃO (stop + start): soluço de rede, container reiniciado, sessão que
 *    parou sozinha. As credenciais em `/app/.sessions` continuam válidas e o
 *    engine volta sozinho para WORKING — sem QR, sem incomodar o usuário.
 *  - `{ force: true }` (stop + LOGOUT + start): o aparelho foi desvinculado
 *    pelo celular e o WhatsApp revogou a credencial. Aí o start comum
 *    reaproveita uma credencial morta e a sessão vai direto para FAILED, sem
 *    NUNCA passar por SCAN_QR_CODE — era exatamente esse o buraco em que a tela
 *    ficava presa esperando um QR que nunca vinha. O logout descarta a
 *    credencial e o pareamento recomeça do zero.
 *
 * O padrão é o modo suave de propósito: forçar logout sempre custaria um
 * reescaneamento a cada queda passageira. A UI só oferece o `force` depois que
 * o modo suave falhou.
 *
 * Admin only. organization_id vem da sessão — nunca do path/body.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { getWahaClient, wahaFriendlyError } from "@/lib/waha/client";

export const dynamic = "force-dynamic";

const reconnectSchema = z.object({ force: z.boolean().optional() });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await params;

  let rawBody: unknown = {};
  try {
    rawBody = await req.json();
  } catch {
    rawBody = {};
  }
  const parsedBody = reconnectSchema.safeParse(rawBody ?? {});
  const force = parsedBody.success ? (parsedBody.data.force ?? false) : false;

  const authz = await requireRole("admin", {
    requestId,
    resource: "channel_sessions",
    allowPlatformAdmin: true,
  });
  if (!authz.ok) return authz.response;
  const { user, org: activeOrg } = authz;

  const supabase = await createClient();
  const { data: session } = await supabase
    .from("channel_sessions")
    .select("id, waha_session_name")
    .eq("organization_id", activeOrg.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!session) return fail("not_found", "Canal não encontrado.", 404, { requestId });

  const waha = getWahaClient();
  if (!waha) {
    return fail(
      "waha_not_configured",
      "O serviço do WhatsApp (WAHA) não está ativo. Suba o container e tente de novo.",
      503,
      { requestId },
    );
  }

  try {
    await waha.stopSession(session.waha_session_name);
    // Só no modo forçado: descartar a credencial é irreversível — obriga a
    // reescanear o QR mesmo que ela ainda estivesse boa.
    if (force) await waha.logoutSession(session.waha_session_name);
    const remote = (await waha.startSession(session.waha_session_name)) as { status?: string };
    const nextStatus = remote.status ?? "STARTING";
    await supabase
      .from("channel_sessions")
      .update({
        status: "STARTING",
        last_status_change_at: new Date().toISOString(),
        consecutive_health_fails: 0,
      })
      .eq("organization_id", activeOrg.orgId)
      .eq("id", id);

    void audit({
      action: "channel.reconnected",
      actorUserId: user.id,
      organizationId: activeOrg.orgId,
      resourceType: "channel_session",
      resourceId: id,
      requestId,
      metadata: { waha_session_name: session.waha_session_name, force },
    });

    return ok({ id, status: nextStatus, force }, { requestId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return fail("waha_error", wahaFriendlyError(msg), 502, { requestId });
  }
}
