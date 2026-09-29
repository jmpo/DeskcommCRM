import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/ai/knowledge/reindex-all
 *
 * Reindexa TODOS os materiais ativos da organização de uma vez, emitindo
 * `knowledge_source.updated` por fonte (o worker re-processa; nada é apagado).
 *
 * Por que existe: depois de cadastrar a chave, ou de uma leva de materiais
 * que falhou, reindexar fonte a fonte numa loja com dezenas de materiais é onde
 * a pessoa desiste no meio. O worker PULA a fonte cujo conteúdo não mudou
 * (`content_hash`, migration 0409), então "Preparar tudo" não reembeda à toa.
 *
 * Auth: cookie session, role >= manager (o mesmo papel do reindexar de UMA
 * fonte). `organization_id` vem do JWT, nunca do corpo — e a rota não lê corpo
 * nenhum, então não há entrada externa para validar.
 *
 * Audita (`ai.knowledge_reindex_all`) quando há material; sem material não
 * houve mutação e não há o que auditar.
 */
import { randomUUID } from "node:crypto";

import { enfileirarTodosOsMateriais } from "@/lib/ai/knowledge/reprepara-tudo";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "ai_knowledge" });
  if (!authz.ok) return authz.response;
  const { org, user } = authz;

  // RLS via cliente user-scoped; o filtro de organização é explícito e a fonte
  // é a sessão — nunca o corpo.
  let fila;
  try {
    fila = await enfileirarTodosOsMateriais({
      leitura: await createClient(),
      admin: createAdminClient(),
      organizationId: org.orgId,
      requestId,
      motivo: "manual_reindex_all",
    });
  } catch (err) {
    logger.error("[ai-knowledge-reindex-all] falha ao listar os materiais", {
      error: err instanceof Error ? err.message : String(err),
      requestId,
    });
    return fail("internal_error", "Erro ao listar os materiais.", 500, { requestId });
  }

  if (fila.total > 0) {
    void audit({
      action: "ai.knowledge_reindex_all",
      actorUserId: user.id,
      organizationId: org.orgId,
      resourceType: "ai_knowledge_source",
      requestId,
      metadata: { ...fila },
    });
  }

  return ok(fila, { requestId });
}
