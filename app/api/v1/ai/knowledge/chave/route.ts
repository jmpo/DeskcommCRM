/**
 * GET /api/v1/ai/knowledge/chave — a base de conhecimento consegue indexar?
 *
 * Existe porque a tela de conhecimento prometia "a indexação começa em
 * instantes" sem nunca perguntar se havia chave para isso. Numa instalação sem
 * `OPENAI_API_KEY` — que é o estado de TODO primeiro deploy, já que o campo do
 * instalador é opcional e pulável com Enter — o material subia, a fonte nascia
 * `ready`, e nada acontecia nunca. Nenhuma das rotas de conhecimento chamava
 * uma linha de verificação de chave.
 *
 * A resposta diz três coisas, e as três são acionáveis na tela:
 *   * se dá para indexar agora;
 *   * de ONDE a chave sai (a pessoa precisa saber qual está valendo);
 *   * quais chaves de embedding a organização já tem, para escolher em vez de digitar
 *     outra.
 *
 * Nunca devolve material de credencial: só rótulo e os quatro últimos dígitos,
 * que é o que a view `ai_provider_credentials_safe` expõe.
 */

import { randomUUID } from "node:crypto";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { montarEstadoDaChave } from "@/lib/ai/embeddings/estado";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("manager", { requestId, resource: "ai_knowledge" });
  if (!authz.ok) return authz.response;
  const { org: activeOrg } = authz;

  const estado = await montarEstadoDaChave(await createClient(), activeOrg.orgId);

  return ok(
    {
      ...estado,
      // Compatibilidade com clientes da rota anterior.
      credenciais_openai: estado.credenciais_embedding.filter((c) => c.provider === "openai"),
    },
    { requestId },
  );
}
