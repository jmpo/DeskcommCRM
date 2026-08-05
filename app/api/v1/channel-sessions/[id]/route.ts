/**
 * GET /api/v1/channel-sessions/[id] — health check AO VIVO de um canal.
 *
 * Consulta o status real no WAHA, grava `last_health_check_at` (+ sincroniza
 * `status`) no DB e devolve o estado atual. É a fonte de verdade quando o
 * usuário abre a Central de Conexões ou está aguardando o QR ser escaneado.
 *
 * Qualquer membro da org pode consultar. organization_id vem da sessão.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { ok, fail } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { requireRole } from "@/lib/auth/require-role";
import { isChannelStatus } from "@/lib/schemas/channels";
import { createClient } from "@/lib/supabase/server";
import { getWahaClient, wahaFriendlyError } from "@/lib/waha/client";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await params;

  const user = await loadAuthUser();
  if (!user) return fail("unauthenticated", "Auth required.", 401, { requestId });
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) return fail("forbidden_tenant", "Nenhuma organização ativa.", 403, { requestId });

  const supabase = await createClient();
  const { data: session } = await supabase
    .from("channel_sessions")
    .select("id, waha_session_name, display_name, phone_number, status")
    .eq("organization_id", activeOrg.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!session) return fail("not_found", "Canal não encontrado.", 404, { requestId });

  const waha = getWahaClient();
  if (!waha) {
    // Sem WAHA ativo: devolve o que está no DB, sinalizando que não deu p/ checar ao vivo.
    return ok({ ...session, waha_configured: false }, { requestId });
  }

  let liveStatus = session.status as string;
  let phoneNumber = session.phone_number as string | null;
  try {
    const remote = (await waha.getSessionQr(session.waha_session_name)) as {
      status?: string;
      me?: { id?: string; pushName?: string };
    };
    if (remote.status) liveStatus = remote.status;
    // WAHA expõe o número (JID `<phone>@c.us`) quando a sessão está WORKING.
    const jid = remote.me?.id;
    if (jid && !phoneNumber) phoneNumber = jid.replace(/@.*/, "");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    // 404 no WAHA = sessão não iniciada lá → considera STOPPED.
    if (msg.includes("404")) liveStatus = "STOPPED";
    // outros erros: mantém o status do DB (não sobrescreve com ruído transitório).
  }

  // Sincroniza o DB: sempre carimba o health check; atualiza status/telefone só se válido.
  const patch: Record<string, unknown> = { last_health_check_at: new Date().toISOString() };
  if (isChannelStatus(liveStatus) && liveStatus !== session.status) {
    patch.status = liveStatus;
    patch.last_status_change_at = new Date().toISOString();
  }
  if (phoneNumber && phoneNumber !== session.phone_number) patch.phone_number = phoneNumber;
  await supabase.from("channel_sessions").update(patch).eq("organization_id", activeOrg.orgId).eq("id", id);

  return ok(
    {
      id: session.id,
      waha_session_name: session.waha_session_name,
      display_name: session.display_name,
      phone_number: phoneNumber,
      status: liveStatus,
      last_health_check_at: patch.last_health_check_at,
      waha_configured: true,
    },
    { requestId },
  );
}

/**
 * DELETE /api/v1/channel-sessions/[id] — remove um canal da Central de Conexões.
 *
 * Duas saídas, escolhidas pelo banco e não por parâmetro:
 *
 *  - Canal VIRGEM (sem conversas, mensagens ou versão de agente apontando pra
 *    ele): apaga a linha de verdade. As tabelas satélite (knobs, health, warmup,
 *    pacing…) somem junto via ON DELETE CASCADE.
 *  - Canal COM HISTÓRICO: arquiva (`archived_at`). conversations, messages e
 *    ai_agent_versions referenciam channel_sessions com ON DELETE RESTRICT — o
 *    Postgres recusaria o DELETE, e forçá-lo significaria destruir o histórico
 *    de atendimento junto. Arquivar tira o canal da UI preservando tudo.
 *
 * Nos dois casos a sessão é deslogada e removida do WAHA, então o número é
 * desvinculado e para de receber webhooks.
 *
 * Admin only. organization_id vem da sessão — nunca do path/body.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await params;

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
    .select("id, waha_session_name, display_name, phone_number")
    .eq("organization_id", activeOrg.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!session) return fail("not_found", "Canal não encontrado.", 404, { requestId });

  // Só as três FKs RESTRICT decidem hard delete vs arquivar — as CASCADE se
  // resolvem sozinhas e as SET NULL não bloqueiam nada.
  const [convs, msgs, agentVersions] = await Promise.all([
    supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", activeOrg.orgId)
      .eq("channel_session_id", id),
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", activeOrg.orgId)
      .eq("channel_session_id", id),
    supabase
      .from("ai_agent_versions")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", activeOrg.orgId)
      .eq("channel_session_id", id),
  ]);
  const hasHistory =
    (convs.count ?? 0) > 0 || (msgs.count ?? 0) > 0 || (agentVersions.count ?? 0) > 0;

  // Desvincula o número no WAHA antes de mexer no DB: se isso falhar, a linha
  // continua íntegra e o usuário pode tentar de novo. A ordem inversa deixaria
  // uma sessão órfã ativa no WAHA, recebendo webhooks de um canal que a UI já
  // não mostra.
  const waha = getWahaClient();
  if (waha && session.waha_session_name) {
    try {
      await waha.logoutSession(session.waha_session_name);
      await waha.deleteSession(session.waha_session_name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      return fail("waha_error", wahaFriendlyError(msg), 502, { requestId });
    }
  }

  if (hasHistory) {
    const { error: archErr } = await supabase
      .from("channel_sessions")
      .update({
        archived_at: new Date().toISOString(),
        status: "STOPPED",
        last_status_change_at: new Date().toISOString(),
      })
      .eq("organization_id", activeOrg.orgId)
      .eq("id", id);
    if (archErr) return fail("internal_error", archErr.message, 500, { requestId });
  } else {
    const { error: delErr } = await supabase
      .from("channel_sessions")
      .delete()
      .eq("organization_id", activeOrg.orgId)
      .eq("id", id);
    if (delErr) return fail("internal_error", delErr.message, 500, { requestId });
  }

  void audit({
    action: hasHistory ? "channel.archived" : "channel.deleted",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "channel_session",
    resourceId: id,
    requestId,
    metadata: {
      waha_session_name: session.waha_session_name,
      phone_number: session.phone_number,
      conversations: convs.count ?? 0,
      messages: msgs.count ?? 0,
    },
  });

  return ok(
    {
      id,
      archived: hasHistory,
      conversations_preserved: convs.count ?? 0,
      messages_preserved: msgs.count ?? 0,
    },
    { requestId },
  );
}
