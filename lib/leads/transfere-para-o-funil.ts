import type { SupabaseClient } from "@supabase/supabase-js";

import type { HandlerCtx } from "@/lib/api/handlers/types";
import { createLeadHandler } from "@/app/api/v1/leads/_handler";
import {
  escolheEtapaDeDestino,
  montaPayloadDoClone,
  recusaTrocaDeFunil,
  type EtapaDoFunil,
  type OrigemParaClonar,
} from "@/lib/leads/clonar-para-funil";
import { encerraDemanda } from "@/lib/leads/encerramento";
import { motivoDaPerdaDaOrigem } from "@/lib/leads/motivo-da-perda";

/** As colunas que o clone precisa copiar da origem. */
export const COLUNAS_DA_ORIGEM =
  "id, pipeline_id, status, title, description, contact_id, value_cents, currency, " +
  "owner_user_id, owner_agent_id, expected_close_date, tags, source, custom_fields, source_metadata";

/** A linha COMPLETA do negócio de origem, como a automação a lê. */
export type OrigemDaTransferencia = OrigemParaClonar;

/**
 * Clona o negócio no funil de destino e encerra a origem — a ÚNICA forma de
 * trocar de funil do sistema (automação e roteador de intenção, #2155).
 *
 * Mesma ordem da rota do clone, e pelas mesmas razões: o funil de destino
 * confere a etapa, a origem confere se tem onde fechar (sem isso o clone
 * nasceria com a origem aberta — o defeito de novo, agora em dobro) e só então
 * o clone é criado e a origem encerrada como PERDIDA com o motivo da
 * transferência. O motivo é o canônico `moved_to_another_pipeline`, que não é
 * perda comercial: `fn_attendant_metrics` o exclui (migration 0266).
 *
 * `razaoNaTimeline` diz QUEM levou o card — a automação ou o roteador de
 * intenção —, porque é a única pista que o operador tem ao ler a linha do tempo.
 *
 * Devolve o erro em vez de lançar: quem chama transforma isso no `status:
 * "failed"` da execução, que é o que a aba Atividade mostra ao operador.
 */
export async function transfereParaOFunil(
  admin: SupabaseClient,
  organizationId: string,
  handlerCtx: HandlerCtx,
  origem: OrigemParaClonar,
  pipelineId: string,
  stageId: string | null,
  razaoNaTimeline: string,
): Promise<{ ok: true; clone: Record<string, unknown> } | { ok: false; error: string }> {
  const recusa = recusaTrocaDeFunil(origem, pipelineId);
  if (recusa) return { ok: false, error: recusa.code };

  const { data: etapas, error: etapasErr } = await admin
    .from("crm_stages")
    .select("id, pipeline_id, position, is_won, is_lost, is_archived")
    .eq("organization_id", organizationId)
    .eq("pipeline_id", pipelineId)
    .eq("is_archived", false)
    .order("position", { ascending: true });
  if (etapasErr) return { ok: false, error: etapasErr.message };

  const destino = escolheEtapaDeDestino((etapas ?? []) as EtapaDoFunil[], stageId);
  if (!destino.ok) return { ok: false, error: destino.code };

  const { data: etapaDePerda, error: perdaErr } = await admin
    .from("crm_stages")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("pipeline_id", origem.pipeline_id)
    .eq("is_lost", true)
    .eq("is_archived", false)
    .limit(1)
    .maybeSingle();
  if (perdaErr) return { ok: false, error: perdaErr.message };
  if (!etapaDePerda) return { ok: false, error: "origem_sem_etapa_de_perda" };

  const clone = await createLeadHandler(admin, handlerCtx, montaPayloadDoClone(origem, destino.etapa));

  await encerraDemanda(admin, handlerCtx, {
    leadId: origem.id,
    desfecho: "lost",
    motivo: motivoDaPerdaDaOrigem(null),
    razaoNaTimeline,
    payloadNaTimeline: { to_pipeline_id: pipelineId, to_lead_id: clone.id },
  });

  return { ok: true, clone: clone as unknown as Record<string, unknown> };
}
