/**
 * O primeiro número chegou: o agente do onboarding entra no ar.
 *
 * ─── O defeito, medido em produção (QA de 26/10/2026) ──────────────────────
 *
 * Quem pulava o telefone no wizard terminava com o agente em "Sem versão": o
 * passo "Treinar" parava em `no_channel` sem criar versão nenhuma, e conectar o
 * número DEPOIS (em Conexões) não fazia nada com ele. A pessoa conectava o
 * WhatsApp, o cliente escrevia, e ninguém respondia — sem nenhuma tela dizendo
 * que faltava publicar um agente que ela nem sabia que estava em rascunho.
 *
 * ─── O que ele faz, e o que NÃO faz ────────────────────────────────────────
 *
 * Faz exatamente o que o passo "Treinar" teria feito se o número já existisse:
 * `publishFirstVersion` sobre o agente PADRÃO, reaproveitando o rascunho que o
 * onboarding criou (só aponta o canal). O número nasce em modo de teste, então
 * publicar não solta respostas para o público — é o mesmo estado de quem
 * conectou o número dentro do wizard.
 *
 * Não toca agente que alguém já mexeu: versão criada no editor (mais de uma, ou
 * de outra origem) volta como `precisa_revisao`, e a tela manda para IA ›
 * Agentes. Não toca agente arquivado nem agente já publicado.
 *
 * **Nunca lança**: é chamado no fim de uma conexão que JÁ deu certo, e a
 * conexão não pode falhar por causa do agente.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";

import { publishFirstVersion } from "./first-publication";

export type ResultadoDaAtivacao =
  | { estado: "publicado"; agentId: string }
  | { estado: "ja_no_ar" }
  | { estado: "sem_agente" }
  | { estado: "sem_canal" }
  | { estado: "precisa_revisao"; motivo: string };

export async function ativarAgenteDoOnboarding(
  admin: SupabaseClient,
  orgId: string,
  /** Quem conectou o número (ou clicou em "Ativar"): é o autor da versão e da publicação. */
  userId: string,
  contexto: { origem: string; requestId?: string | null } = { origem: "conexao" },
): Promise<ResultadoDaAtivacao> {
  try {
    const { data: agente, error } = await admin
      .from("ai_agents")
      .select("id, published_version_id, system_prompt, archived_at")
      .eq("organization_id", orgId)
      .eq("is_default", true)
      .maybeSingle();
    if (error) return { estado: "precisa_revisao", motivo: error.message };
    if (!agente || agente.archived_at) return { estado: "sem_agente" };
    if (agente.published_version_id) return { estado: "ja_no_ar" };

    const resultado = await publishFirstVersion(
      admin as never,
      orgId,
      { id: agente.id as string, published_version_id: null },
      (agente.system_prompt as string | null) ?? "",
      userId,
    );

    if (resultado.published) {
      void admin
        .from("event_log")
        .insert({
          organization_id: orgId,
          event_type: "ai_agent.published",
          // NOT NULL sem default — ver `tests/unit/evento-de-publicacao-tem-dono.test.ts`.
          entity_kind: "ai_agent",
          payload: { agent_id: agente.id, source: contexto.origem },
        })
        .then(({ error: evErr }) => {
          if (evErr)
            logger.warn("[ai.ativar] event_log falhou", {
              organization_id: orgId,
              error: evErr.message,
            });
        });
      void audit({
        action: "ai_agent.published",
        actorUserId: userId,
        organizationId: orgId,
        resourceType: "ai_agent",
        resourceId: agente.id as string,
        requestId: contexto.requestId ?? null,
        metadata: { origem: contexto.origem, primeira_publicacao: true },
      });
      return { estado: "publicado", agentId: agente.id as string };
    }
    if (resultado.reason === "no_channel") return { estado: "sem_canal" };
    return {
      estado: "precisa_revisao",
      motivo: resultado.reason === "failed" ? resultado.message : resultado.reason,
    };
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    logger.warn("[ai.ativar] não consegui pôr o agente do onboarding no ar", {
      organization_id: orgId,
      error: motivo,
    });
    return { estado: "precisa_revisao", motivo };
  }
}
