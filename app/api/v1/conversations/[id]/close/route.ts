/**
 * POST /api/v1/conversations/[id]/close — fecha a conversa.
 *
 * Não bloqueia por assignee — qualquer membro com permissão (RLS) pode fechar.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import type { Conversation } from "@/lib/types/messaging";

export const dynamic = "force-dynamic";

const SELECT_COLS = `
  id, organization_id, contact_id, channel_session_id, channel, status,
  status_changed_at, assigned_to_user_id, assigned_at, last_inbound_at,
  last_outbound_at, last_message_at, last_message_preview,
  unread_count_for_assignee, is_group, group_chat_id, metadata,
  created_at, updated_at
`;

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const supabase = await createClient();

  // spec 13 §4: escrita é agent+ (viewer é read-only).
  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const user = authz.user;

  const now = new Date().toISOString();

  // FECHAR NÃO PODE DESFAZER UMA ESCALAÇÃO — e a primeira versão deste conserto
  // desfazia.
  //
  // Desde a 0173, assumir grava `bot_silenced_until='infinity'`. Fechar NÃO solta
  // o dono (de propósito: "quem atendeu é histórico") e a ingestão reusa a MESMA
  // linha de conversa quando o cliente escreve de novo (`fn_upsert_wa_conversation`,
  // `on conflict do update`), então sem limpar o silêncio o fim NORMAL de um
  // atendimento (Assumir → Fechar) deixaria o automático mudo para sempre naquele
  // cliente.
  //
  // Só que limpar INCONDICIONALMENTE era pior. O comentário anterior se justificava
  // com "quem escalou também gravou `contacts.force_human`" — **medido, é falso**
  // para `triggerHandoff` (`grep -n force_human lib/ai/handoff/orchestrator.ts` →
  // rc=1), que é o escalador do MCP `crm_request_human_handoff`, do handler de
  // sentimento, do worker legado e do teto de gasto. Nesses caminhos o silêncio é a
  // ÚNICA trava, e apagá-la fazia o robô voltar a responder um cliente que pediu
  // uma pessoa — dois atores no mesmo cliente, na direção oposta, que é o defeito
  // que esta entrega existe para matar.
  //
  // O discriminador já existe e não custa coluna nova: uma ESCALAÇÃO carimba
  // `last_handoff_at`; um humano assumindo não. Então o UPDATE do silêncio é
  // SEPARADO e condicionado — soltar de propósito é o botão "Devolver ao
  // automático", que limpa as três travas de uma vez.
  const { data, error } = await supabase
    .from("conversations")
    .update({ status: "closed", status_changed_at: now })
    .eq("id", id)
    .select(SELECT_COLS)
    .maybeSingle();

  if (error) {
    return fail("internal_error", error.message, 500, { requestId });
  }
  if (!data) {
    return fail("not_found", "Conversa não encontrada.", 404, { requestId });
  }

  const conv = data as unknown as Conversation;

  // A segunda metade: solta só o silêncio que um humano pôs ao assumir. O filtro
  // `.is("last_handoff_at", null)` é o que separa "o episódio acabou" de "a IA
  // escalou e ninguém devolveu" — na segunda, o silêncio fica.
  const { error: erroSilencio } = await supabase
    .from("conversations")
    .update({ bot_silenced_until: null })
    .eq("id", id)
    .eq("organization_id", conv.organization_id)
    .is("last_handoff_at", null);
  if (erroSilencio) {
    // Não derruba o fechamento — ele já aconteceu. Mas também não fica calado: sem
    // esta linha o automático seguiria mudo naquele cliente e ninguém saberia por quê.
    logger.warn("[conversation.close] silêncio do episódio não foi solto", {
      conversation_id: id,
      erro: erroSilencio.message,
    });
  }

  await audit({
    action: "conversation.closed",
    actorUserId: user.id,
    organizationId: conv.organization_id,
    resourceType: "conversation",
    resourceId: conv.id,
    requestId,
  });

  return ok(conv, { requestId });
}
