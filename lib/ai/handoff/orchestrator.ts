/**
 * Handoff orchestrator — central point que executa a transição bot→humano
 * para os 4 gatilhos OR-lógicos (G1/G2/G3/G4) do EPIC-06.
 *
 * Efeitos colaterais (atomic-ish; falhas não-críticas são logadas e ignoradas):
 *   1. UPDATE conversations
 *        SET status='pending',
 *            bot_silenced_until='infinity',
 *            last_handoff_at=now(),
 *            last_handoff_reason=<reason>,
 *            active_ai_agent_id=null, active_intent=null, active_agent_set_at=null
 *      (idempotente: se outro handoff aconteceu nos últimos 5s com mesma reason,
 *       skip — tratamento de race G2 vs G3 vs G4 simultâneos.)
 *   2. INSERT em crm_lead_activities (timeline) se houver lead_id
 *   3. emit_event('ai.handoff_triggered') no event_log
 *   4. Realtime broadcast no channel 'org:<org>:queue' (event 'handoff_pending')
 *   5. api_audit_log action='ai.handoff_triggered'
 *
 * IMPORTANTE: nunca propaga exceção pro caller. O worker chamador segue feliz.
 *
 * Service-role bypassa RLS — filtro `organization_id` programático em toda query.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

export type HandoffReason =
  | "requested_human"
  | "low_sentiment"
  | "low_confidence"
  | "critical_stage"
  | "legal_mention"
  | "refund_mention"
  /**
   * O teto de gasto com IA parou o atendimento automático. NÃO é pedido do lead —
   * quem lê `last_handoff_reason` precisa distinguir, porque a primeira frase que
   * o humano digita depende disso.
   *
   * O literal vem de `HANDOFF_REASON_ORCAMENTO` (`lib/agent-engine/edge/llm/orcamento.ts`),
   * a MESMA constante que o engine grava: dois caminhos param a IA pelo mesmo
   * motivo, e duas grafias fariam quem filtra por uma achar metade das conversas.
   */
  | "orcamento_de_ia";

export interface TriggerHandoffInput {
  conversationId: string;
  organizationId: string;
  reason: HandoffReason;
  leadId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface TriggerHandoffResult {
  triggered: boolean;
  reason: string;
}

const IDEMPOTENCY_WINDOW_MS = 5_000;
// Postgres `infinity` literal — bot must never reassume after handoff (IA-06).
const SILENCE_INFINITY = "infinity";

export async function triggerHandoff(
  input: TriggerHandoffInput,
): Promise<TriggerHandoffResult> {
  try {
    const admin = createAdminClient();

    // Idempotency check: se um handoff aconteceu há <5s pra esta conversa COM
    // a mesma reason, é provavelmente uma race entre G2/G3/G4 disparando em
    // paralelo. Skip silenciosamente.
    const { data: convNow } = await admin
      .from("conversations")
      .select("id, organization_id, last_handoff_at, last_handoff_reason")
      .eq("id", input.conversationId)
      .eq("organization_id", input.organizationId)
      .maybeSingle();

    if (!convNow) {
      return { triggered: false, reason: "conversation_not_found" };
    }

    type ConvNowRow = {
      id: string;
      organization_id: string;
      last_handoff_at: string | null;
      last_handoff_reason: string | null;
    };
    const c = convNow as unknown as ConvNowRow;

    if (c.last_handoff_at) {
      const since = Date.now() - new Date(c.last_handoff_at).getTime();
      if (since < IDEMPOTENCY_WINDOW_MS && c.last_handoff_reason === input.reason) {
        return { triggered: false, reason: "idempotent_5s" };
      }
    }

    const nowIso = new Date().toISOString();

    // Step 1 — flip conversation to pending + silence bot indefinitely.
    // We use 'infinity' (Postgres timestamp special) so any later comparison
    // `bot_silenced_until > now()` is always true. supabase-js sends as text
    // and Postgres parses correctly for timestamptz columns.
    const { error: updErr } = await admin
      .from("conversations")
      .update({
        status: "pending",
        bot_silenced_until: SILENCE_INFINITY,
        last_handoff_at: nowIso,
        last_handoff_reason: input.reason,
        status_changed_at: nowIso,
        // Fase 3 (review T5, finding 4): zera a aderência ao agente do router — se o
        // bot for reativado, o router decide de novo (não reassume por inércia).
        active_ai_agent_id: null,
        active_intent: null,
        active_agent_set_at: null,
      })
      .eq("id", input.conversationId)
      .eq("organization_id", input.organizationId);

    if (updErr) {
      logger.warn("[handoff-orchestrator] conversation update failed", {
        conversation_id: input.conversationId,
        error: updErr.message,
      });
      return { triggered: false, reason: "orchestrator_error" };
    }

    // Step 2 — timeline activity (best-effort; missing leadId is OK).
    if (input.leadId) {
      const { error: actErr } = await admin.from("crm_lead_activities").insert({
        organization_id: input.organizationId,
        lead_id: input.leadId,
        type: "handoff_triggered",
        source_module: "ai",
        payload: {
          conversation_id: input.conversationId,
          reason: input.reason,
        },
        metadata: {
          actor_kind: "system",
          reason: input.reason,
          ...(input.metadata ?? {}),
        },
      });
      if (actErr) {
        logger.warn("[handoff-orchestrator] activity insert failed", {
          lead_id: input.leadId,
          error: actErr.message,
        });
      }
    }

    // Step 3 — durable event for any downstream consumer.
    const { error: emitErr } = await admin.rpc("emit_event" as never, {
      p_event_type: "ai.handoff_triggered",
      p_entity_kind: "conversation",
      p_entity_id: input.conversationId,
      p_payload: {
        conversation_id: input.conversationId,
        organization_id: input.organizationId,
        reason: input.reason,
        lead_id: input.leadId ?? null,
        metadata: input.metadata ?? {},
      },
      p_metadata: { source: "handoff-orchestrator" },
      p_organization_id: input.organizationId,
    } as never);
    if (emitErr) {
      logger.warn("[handoff-orchestrator] emit_event failed", {
        conversation_id: input.conversationId,
        error: (emitErr as { message?: string }).message ?? String(emitErr),
      });
    }

    // Step 4 — Realtime broadcast so the agent UI lights up immediately.
    try {
      const channel = admin.channel(`org:${input.organizationId}:queue`);
      await channel.send({
        type: "broadcast",
        event: "handoff_pending",
        payload: {
          conversation_id: input.conversationId,
          reason: input.reason,
        },
      });
      await admin.removeChannel(channel);
    } catch (err) {
      logger.warn("[handoff-orchestrator] realtime broadcast failed", {
        conversation_id: input.conversationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Step 5 — audit log (fire-and-forget; never blocks).
    const { error: auditErr } = await admin.from("api_audit_log").insert({
      action: "ai.handoff_triggered",
      organization_id: input.organizationId,
      resource_type: "conversation",
      resource_id: input.conversationId,
      metadata: {
        reason: input.reason,
        lead_id: input.leadId ?? null,
        ...(input.metadata ?? {}),
      },
    });
    if (auditErr) {
      logger.warn("[handoff-orchestrator] audit insert failed", {
        conversation_id: input.conversationId,
        error: auditErr.message,
      });
    }

    return { triggered: true, reason: input.reason };
  } catch (err) {
    logger.warn("[handoff-orchestrator] unexpected error", {
      conversation_id: input.conversationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { triggered: false, reason: "orchestrator_error" };
  }
}
