/**
 * PATCH /api/v1/demandas/[id] — marca o PRÓXIMO PASSO de uma demanda aberta.
 *
 * ## Por que esta rota existe
 *
 * O invariante 4 da doutrina ("nenhuma demanda sem próximo passo") já era
 * VISÍVEL em três lugares: contagem no painel de atrito, lista no Radar, e as
 * demandas do contato no painel do inbox. Em nenhum deles dava para RESOLVER —
 * o atendente enxergava o vazamento e tinha de sair da tela para agir.
 *
 * Isso foi denunciado pelo gate dos mapas de arquitetura
 * (`tests/unit/mapas-de-arquitetura.test.ts`): o node do inbox tinha UMA aresta,
 * só de entrada. Peça que só recebe é ilha pelo invariante 1, e o remédio certo
 * não era afrouxar o gate.
 *
 * ## As duas escritas, e por que a segunda existe
 *
 * `proximo_passo` sozinho seria uma anotação. Com `proximo_passo_em` ele vira
 * compromisso datado, que é o que o Radar e o índice sabem cobrar. O texto é
 * obrigatório; a data é opcional — obrigá-la faria o atendente inventar uma
 * para se livrar do campo, e data inventada é pior que data ausente.
 *
 * ## Piso `agent`, e não `manager`
 *
 * Quem atende é quem sabe o que vem a seguir. Exigir gerente aqui empurraria o
 * registro para depois — e "depois" é exatamente o estado que esta rota existe
 * para eliminar.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  proximo_passo: z.string().trim().min(3).max(500),
  /** ISO 8601 absoluto. Ausente é legítimo: nem todo passo tem hora marcada. */
  proximo_passo_em: z.string().datetime({ offset: true }).nullish(),
});

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;

  const authz = await requireRole("agent", { requestId, resource: "demandas" });
  if (!authz.ok) return authz.response;
  const { org: activeOrg, user } = authz;

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return fail("validation_failed", "Corpo inválido.", 422, { requestId });
  }
  const parsed = patchSchema.safeParse(corpo);
  if (!parsed.success) {
    return fail(
      "validation_failed",
      "O próximo passo precisa ter de 3 a 500 caracteres.",
      422,
      { details: parsed.error.flatten().fieldErrors as Record<string, unknown>, requestId },
    );
  }

  const admin = createAdminClient();

  // Service role bypassa RLS: o `organization_id` vem do CONTEXTO autenticado e
  // é filtro explícito no update, nunca do corpo. E `fechada_em is null` porque
  // marcar o próximo passo de uma demanda encerrada é reabrir pela porta dos
  // fundos — sem desfecho, sem registro, sem ninguém saber.
  const { data, error } = await admin
    .from("demandas")
    .update({
      proximo_passo: parsed.data.proximo_passo,
      proximo_passo_em: parsed.data.proximo_passo_em ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("organization_id", activeOrg.orgId)
    .is("fechada_em", null)
    .select("id, proximo_passo, proximo_passo_em")
    .maybeSingle();

  if (error) return fail("internal_error", error.message, 500, { requestId });
  // Zero linhas é indistinguível de sucesso no PostgREST — o bug conhecido de
  // `organizations` engana exatamente assim. Aqui o `select` de volta é o que
  // separa "gravou" de "não achou/já fechada".
  if (!data) {
    return fail("not_found", "Demanda não encontrada, ou já encerrada.", 404, { requestId });
  }

  void audit({
    action: "demanda.proximo_passo_definido",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "demanda",
    resourceId: id,
    requestId,
    metadata: {
      proximo_passo: parsed.data.proximo_passo,
      proximo_passo_em: parsed.data.proximo_passo_em ?? null,
    },
  });

  return ok(data, { requestId });
}
