/**
 * Conversa programática p/ automação: acha a conversa aberta do contato na
 * sessão, REABRE a fechada, ou cria uma nova. Distinto da ingestão WAHA (que
 * usa RPCs de identidade) — aqui contato e sessão já são conhecidos.
 *
 * Por que reabrir: o índice uniq_conversations_1to1_per_contact_session é
 * único por (org, contato, sessão) SEM filtro de status — um contato cuja
 * única conversa está closed/archived tornaria o INSERT impossível (23505) e
 * o envio automatizado falharia pra sempre. Reabrir é também o comportamento
 * certo de produto: a conversa É o thread com aquele contato naquele número.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ARCHIVED_AT, queryTolerantToMissingArchived } from "@/lib/channels/archived";

const OPEN_STATUSES = ["open", "pending", "claimed", "ai_handling"];

/** Sessão viva da org: WORKING primeiro; senão qualquer uma não arquivada. */
export async function sessaoProntaParaEnvio(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<string | null> {
  const listar = (soWorking: boolean, ignorarArquivadas: boolean) => {
    let q = supabase
      .from("channel_sessions")
      .select("id")
      .eq("organization_id", organizationId);
    if (soWorking) q = q.eq("status", "WORKING");
    if (ignorarArquivadas) q = q.is(ARCHIVED_AT, null);
    return q.order("created_at", { ascending: true }).limit(1);
  };
  const tentar = async (soWorking: boolean) => {
    const { data } = await queryTolerantToMissingArchived(
      () => listar(soWorking, true),
      () => listar(soWorking, false),
    );
    return (data as Array<{ id: string }> | null)?.[0]?.id ?? null;
  };
  return (await tentar(true)) ?? (await tentar(false));
}

export async function ensureConversation(
  admin: SupabaseClient,
  organizationId: string,
  contactId: string,
  channelSessionId: string,
): Promise<string> {
  const { data: existing } = await admin
    .from("conversations")
    .select("id, status")
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId)
    .eq("channel_session_id", channelSessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const row = existing as { id: string; status: string };
    if (OPEN_STATUSES.includes(row.status)) return row.id;
    const { error: reopenErr } = await admin
      .from("conversations")
      .update({ status: "open", updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("organization_id", organizationId);
    if (reopenErr) throw new Error(reopenErr.message);
    return row.id;
  }

  const { data: created, error } = await admin
    .from("conversations")
    .insert({
      organization_id: organizationId,
      contact_id: contactId,
      channel_session_id: channelSessionId,
      channel: "whatsapp",
      status: "open",
      metadata: { created_by: "automation" },
    })
    .select("id")
    .single();
  if (error || !created) {
    // Corrida: outro processo criou a conversa 1:1 entre o select e o insert.
    if ((error as { code?: string } | null)?.code === "23505") {
      const { data: winner } = await admin
        .from("conversations")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("contact_id", contactId)
        .eq("channel_session_id", channelSessionId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (winner) return (winner as { id: string }).id;
    }
    throw new Error(error?.message ?? "conversation_insert_failed");
  }
  return (created as { id: string }).id;
}
