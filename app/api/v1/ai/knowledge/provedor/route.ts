import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * PUT /api/v1/ai/knowledge/provedor — quem prepara a base: OpenAI ou Google.
 *
 * Contribuição de @vgamkt (#1130): a base de conhecimento exigia uma chave da
 * OpenAI, e quem só tinha a do Google ficava sem base.
 *
 * A escolha mora em `organizations.settings.base_de_conhecimento.familia`, e
 * este é o ÚNICO lugar que a escreve. É ela que fixa a família dos dois pontos
 * (indexar e consultar) em `lib/ai/embeddings/chave.ts` — cadastrar ou remover
 * credencial não a troca; antes, a família saía da credencial que aparecia
 * primeiro na escada, e uma chave OpenAI cadastrada depois fazia a busca de
 * uma base do Google devolver zero trechos, calada (revisão do #1864).
 *
 * A troca só vale se a família pedida TEM chave utilizável agora
 * (`resolverChaveDeEmbedding` restrito a ela); sem, 422 — gravar uma família
 * sem chave deixaria a base parada.
 *
 * Trocar REFAZ A BASE: a busca só compara trechos do mesmo modelo, e o indexador
 * reembeda toda fonte cujo modelo mudou. A fila sai neste mesmo pedido
 * (`enfileirarTodosOsMateriais`), não num segundo clique.
 *
 * Auth: admin — decide para qual fornecedor o texto do material vai. A
 * organização vem da sessão, nunca do corpo. Audita `ai.knowledge_provider_changed`
 * quando a troca acontece; pedir o provedor que já está valendo não é mutação.
 *
 * `organizations` só aceita escrita de platform admin pela RLS, então a escrita
 * é pelo admin client com `.eq("id", orgId)` da sessão, e em MERGE: `settings`
 * é jsonb compartilhado (precedente: `lib/ai/pontos/padrao-da-organizacao.ts`).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import {
  FamiliaDaBaseIlegivelError,
  familiaDaBase,
  provedorDaBase,
  resolverChaveDeEmbedding,
} from "@/lib/ai/embeddings/chave";
import { enfileirarTodosOsMateriais } from "@/lib/ai/knowledge/reprepara-tudo";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const corpoSchema = z.object({ provedor: z.enum(["openai", "google"]) }).strict();

export async function PUT(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "ai_knowledge" });
  if (!authz.ok) return authz.response;
  const { org, user } = authz;
  const t = (texto: string) => traduzir(texto, user.idioma);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("invalid_request", t("Body JSON inválido."), 400, { requestId });
  }
  const parsed = corpoSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", t("Campos inválidos."), 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const { provedor } = parsed.data;

  let familia: Awaited<ReturnType<typeof familiaDaBase>>;
  try {
    familia = await familiaDaBase(org.orgId);
  } catch (err) {
    if (!(err instanceof FamiliaDaBaseIlegivelError)) throw err;
    // Sem saber de onde a base parte, a troca não decide nada nem grava nada.
    return fail(
      "upstream_unavailable",
      t("Não consegui confirmar agora com que provedor a base é preparada. Tente de novo em instantes."),
      503,
      { requestId },
    );
  }
  const semFamilia = familia
    ? null
    : await resolverChaveDeEmbedding(org.orgId, "embedding_indexar", { familia: null });
  const provedorAnterior = familia?.familia ?? (semFamilia ? provedorDaBase(semFamilia) : null);
  if (provedorAnterior === provedor) {
    return ok({ provedor, mudou: false, fila: null }, { requestId });
  }

  const destino = await resolverChaveDeEmbedding(org.orgId, "embedding_indexar", {
    familia: provedor,
  });
  if (!destino) {
    return fail(
      "sem_chave_do_provedor",
      provedor === "google"
        ? t("Cadastre e valide uma chave do Google em IA › Credenciais antes de trocar.")
        : t(
            "Cadastre e valide uma chave da OpenAI ou OpenRouter em IA › Credenciais antes de trocar.",
          ),
      422,
      { requestId },
    );
  }

  const admin = createAdminClient();
  const { data: orgAtual } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", org.orgId)
    .maybeSingle();
  const settingsAtuais = ((orgAtual as { settings?: Record<string, unknown> } | null)?.settings ??
    {}) as Record<string, unknown>;
  const baseAtual = (settingsAtuais.base_de_conhecimento ?? {}) as Record<string, unknown>;
  const { data: gravado, error: escritaErr } = orgAtual
    ? await admin
        .from("organizations")
        .update({
          settings: {
            ...settingsAtuais,
            base_de_conhecimento: { ...baseAtual, familia: provedor },
          },
        })
        .eq("id", org.orgId)
        .select("id")
        .maybeSingle()
    : { data: null, error: null };
  // Leitura vazia não pode virar `settings` novo em branco (apagaria marca, MFA
  // e o resto), e zero linhas na escrita volta como SUCESSO no PostgREST: sem
  // esta conferência, a tela diria "trocado" sem nada gravado.
  if (escritaErr || !gravado) {
    logger.error("[ai-knowledge-provedor] falha ao gravar a escolha", {
      error: escritaErr?.message ?? "nenhuma_linha",
      requestId,
    });
    return fail("internal_error", t("Não foi possível trocar o provedor."), 500, { requestId });
  }

  // A troca já valeu; a fila é o que refaz a base. Se ela falhar, o botão
  // "Preparar tudo de novo" da mesma tela é o caminho de volta — e a resposta
  // diz isso em vez de fingir sucesso inteiro.
  let fila = null;
  try {
    fila = await enfileirarTodosOsMateriais({
      leitura: await createClient(),
      admin,
      organizationId: org.orgId,
      requestId,
      motivo: "troca_de_provedor",
    });
  } catch (err) {
    logger.error("[ai-knowledge-provedor] troca feita, fila de reindexação não saiu", {
      error: err instanceof Error ? err.message : String(err),
      requestId,
    });
  }

  void audit({
    action: "ai.knowledge_provider_changed",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "organization",
    resourceId: org.orgId,
    requestId,
    metadata: { de: provedorAnterior, para: provedor, fila },
  });

  return ok({ provedor, mudou: true, fila }, { requestId });
}
