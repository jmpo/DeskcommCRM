"use server";

/**
 * Server Action: create the tenant's first ai_agent (default) and stamp the
 * onboarding state. Uses canonical Spec 05 defaults baked into ai_agents.
 */
import { redirect } from "next/navigation";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { listSelectableChannels, type SelectableChannel } from "@/lib/channels/selectable";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiAgentDefaultSchema, type PromptTemplate } from "@/lib/schemas/onboarding";
import { capacidadesPadraoDoOnboarding } from "@/lib/ai/agents/capacidades-padrao";
import { publicarMemoriaDaOrg } from "@/lib/ai/memoria-da-org";
import { escolherModeloDoProvedor } from "@/lib/ai/agents/escolher-modelo";
import { chaveDePlataforma } from "@/lib/ai/runtime/agent";
import {
  requireOnboardingCtx,
  patchOnboardingState,
  loadOnboardingState,
  OnboardingError,
} from "./_shared";

/**
 * O jeito de falar do funcionário.
 *
 * Os corpos diziam "loja online" e "e-commerce" em dois dos três — num produto
 * que se declara multi-nicho por escrito, e cuja maioria de adopters roda em
 * clínica, imobiliária e infoproduto. Uma clínica terminava o onboarding com um
 * atendente que se apresentava como sendo de uma loja virtual.
 *
 * Recebem o nome do negócio E o ramo: um funcionário que sabe onde trabalha é o
 * mínimo que se espera de alguém contratado, e saber o QUE o lugar faz é a
 * diferença entre "Olá, como posso ajudar?" e uma primeira frase que já mostra
 * que ele entendeu onde está. O ramo é o que o dono respondeu no primeiro passo;
 * quem não respondeu recebe a versão sem ele, e não uma inventada.
 */
function ondeTrabalha(negocio: string, oQueFaz: string | undefined): string {
  return oQueFaz ? `${negocio}, que é: ${oQueFaz}` : negocio;
}

const PROMPT_BODIES: Record<PromptTemplate, (onde: string) => string> = {
  ecommerce_friendly: (n) =>
    `Você atende os clientes de ${n}. Fale de forma calorosa e próxima, como alguém que gosta de ajudar. Cumprimente, entenda o que a pessoa precisa e ofereça opções claras. Confirme os detalhes antes de agir.`,
  ecommerce_professional: (n) =>
    `Você atende os clientes de ${n}. Fale de forma objetiva, cordial e profissional. Vá direto ao ponto, sem parecer frio, e sempre termine indicando o próximo passo.`,
  support_minimal: (n) =>
    `Você atende os clientes de ${n}. Responda em frases curtas, peça apenas o que for necessário e chame uma pessoa do time assim que a dúvida sair do seu alcance.`,
};

/** O agente padrão desta organização, do jeito que este passo precisa vê-lo. */
interface AgenteDoOnboarding {
  id: string;
  published_version_id: string | null;
}

/**
 * O que aconteceu com a 1ª versão — e por que "não há canal" e "não deu para
 * saber" são desfechos SEPARADOS.
 *
 * `no_channel` é um estado CONHECIDO do produto: quem pulou o WhatsApp não tem
 * número, a versão exige `channel_session_id`, e o agente fica rascunho de
 * propósito (a lista de agentes já mostra "Rascunho"). `failed` é o estado
 * DESCONHECIDO: a consulta não respondeu, então não se sabe se há canal.
 * Colapsar os dois no mesmo `return` seria engolir erro — e engolir erro aqui
 * significa terminar o onboarding com um agente mudo sem ninguém saber por quê.
 */
type PublishOutcome =
  | { published: true }
  | { published: false; reason: "no_channel" }
  /**
   * Há provedor e modelo, mas nenhuma chave utilizável: nem credencial validada
   * da organização, nem chave da instalação no ambiente. Publicar assim entrega
   * um funcionário que morre em toda mensagem.
   */
  | { published: false; reason: "sem_chave"; provider: string }
  | {
      published: false;
      reason: "no_model";
      provider: string;
      /**
       * As duas causas pedem conselhos OPOSTOS: catálogo vazio pede esperar (ou
       * forçar) a sincronização; catálogo cheio sem nenhum modelo que sirva pede
       * trocar de provedor. Dizer "ainda não baixamos a lista" para quem já tem
       * 400 modelos é o conselho que nunca resolve.
       */
      motivo: "catalogo_vazio" | "nenhum_com_ferramentas";
    }
  | { published: false; reason: "failed"; message: string };

/**
 * O provedor de IA que a instalação escolheu.
 *
 * O instalador pergunta "qual inteligência artificial vai atender seus
 * clientes?" e grava a resposta em `organizations.settings.llm.provider`. Este
 * passo publicava `"anthropic"` literal, e como o provider da VERSÃO vence o da
 * organização em `resolveOrgLlmConfig`, quem escolheu outro terminava o wizard
 * com um agente "Publicado" que morre em toda mensagem pedindo uma chave que
 * ele nunca teve.
 *
 * `settings` é jsonb livre: leitura defensiva, igual à do agent-engine.
 */
function provedorDaInstalacao(settings: unknown): string {
  const llm = (settings as { llm?: unknown } | null)?.llm;
  const provider = (llm as { provider?: unknown } | null | undefined)?.provider;
  return typeof provider === "string" && provider.trim() !== "" ? provider : "anthropic";
}

function mensagemDoErro(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Publica a 1ª versão do agente criado no onboarding. **Nunca lança**: devolve
 * o desfecho para quem chama decidir o que a tela mostra.
 *
 * Sem isso, o passo "Configurar IA" gravava só a linha em `ai_agents` — formato
 * do `rag_bot` legado. Só que os dois runtimes atuais (o dispatcher do CRM e o
 * agent-engine) resolvem o agente por
 * `join ai_agent_versions on v.id = a.published_version_id`, então um agente
 * sem versão publicada é invisível para ambos: a pessoa terminava o onboarding
 * com um "Atendente IA" que nunca responderia uma única mensagem.
 */
async function publishFirstVersion(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  agent: AgenteDoOnboarding,
  systemPrompt: string,
  userId: string,
): Promise<PublishOutcome> {
  // Já publicado numa passagem anterior: republicar colidiria com
  // `ai_agent_versions_unique_number` sem ganhar nada.
  if (agent.published_version_id) return { published: true };

  // Mesma lista que os seletores das telas de IA: canal arquivado não é destino
  // válido de agente, e publicar uma versão apontando para um deixaria o
  // onboarding terminar com um agente que nunca receberia uma mensagem.
  //
  // Ela LANÇA em erro de banco, e isso é correto lá: um seletor que devolve
  // lista vazia quando a consulta falhou é indistinguível de "esta organização
  // não tem número", e convida a parear de novo um aparelho que já está no ar.
  // Aqui não é um seletor — é a decisão "publica ou fica rascunho", tomada
  // DEPOIS de a linha em `ai_agents` já existir. Deixar o throw subir furava o
  // `CreateAgentResult` (que trata todos os outros pontos de falha) e o passo
  // terminava sem gravar estado, sem audit, sem evento e sem dizer nada na tela.
  let canais: SelectableChannel[];
  try {
    canais = await listSelectableChannels(admin, orgId);
  } catch (err) {
    return { published: false, reason: "failed", message: mensagemDoErro(err) };
  }
  const [canal] = canais;
  if (!canal) return { published: false, reason: "no_channel" };

  // Erro de leitura aqui NÃO pode virar "assume anthropic": publicar sem saber
  // qual provedor a instalação escolheu é exatamente o defeito de origem, com
  // outra roupa.
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", orgId)
    .maybeSingle();
  if (orgErr) return { published: false, reason: "failed", message: orgErr.message };

  const provider = provedorDaInstalacao(org?.settings);

  // O modelo daquele provedor. Não existe fallback literal: um id de outro
  // provedor (ou inventado) produz o pior desfecho do produto — o agente
  // responde texto plausível e nunca cria o lead nem move o card.
  //
  // Buscar SÓ o `is_default_for_provider` travava a OpenRouter, que é a opção
  // [1] do instalador: medido num ambiente real, ela chega com 400 modelos
  // sincronizados e NENHUM marcado como padrão, porque o cron de catálogo não
  // escreve esse campo. A regra de escolha (com o requisito de ferramentas)
  // vive em `escolherModeloDoProvedor`.
  const { data: modelos } = await admin
    .from("ai_models")
    .select("model_id, is_default_for_provider, supports_tools, input_price_per_million_cents, output_price_per_million_cents")
    .eq("provider", provider)
    .is("deprecated_at", null);

  const escolha = escolherModeloDoProvedor(
    (modelos ?? []) as Parameters<typeof escolherModeloDoProvedor>[0],
  );
  if (!escolha.escolhido) {
    return { published: false, reason: "no_model", provider, motivo: escolha.motivo };
  }
  const modelId = escolha.modelId;

  // "Em que negócios ele pode mexer". Toda organização nasce com um funil de
  // entrada, criado por gatilho no INSERT de `organizations`. Sem preencher
  // isto, `pipeline_ids` fica vazio — e vazio significa NENHUM, então toda
  // escrita de lead é recusada e o card nunca sai do lugar.
  //
  // Falha ou ausência = escopo vazio, nunca um funil chutado: mexer no funil
  // errado é pior que não mexer em nenhum.
  const { data: funil } = await admin
    .from("crm_pipelines")
    .select("id")
    .eq("organization_id", orgId)
    .eq("is_default", true)
    .eq("is_archived", false)
    .maybeSingle();
  const pipelineIds = funil?.id ? [funil.id as string] : [];

  // QUAL CHAVE ESTA VERSÃO USA — e as duas origens são legítimas.
  //
  // Credencial validada da organização vence (quem colou a chave no wizard, ou
  // cadastrou pela tela); na falta dela, `credential_id: null` significa "a chave
  // da instalação", que é o caso mais comum do kit. Sem NENHUMA das duas, não se
  // publica: o agente responderia erro em toda mensagem e o dono só descobriria
  // com o primeiro cliente.
  //
  // `validated_at` não nulo é exigência de `loadCredential`, não capricho: uma
  // credencial que o provedor ainda não confirmou não é utilizável pelo turno.
  const { data: credencial } = await admin
    .from("ai_provider_credentials")
    .select("id")
    .eq("organization_id", orgId)
    .eq("provider", provider)
    .eq("is_active", true)
    .not("validated_at", "is", null)
    .limit(1)
    .maybeSingle();

  const credentialId = (credencial?.id as string | undefined) ?? null;
  if (!credentialId && !chaveDePlataforma(provider)) {
    return { published: false, reason: "sem_chave", provider };
  }

  const { data: version, error: versionErr } = await admin
    .from("ai_agent_versions")
    .insert({
      organization_id: orgId,
      agent_id: agent.id,
      version_number: 1,
      system_prompt: systemPrompt,
      // Provedor e modelo saem SEMPRE da mesma origem — o par é indivisível.
      // Emprestar só o id do modelo de outro provedor manda um nome que o
      // endpoint não conhece.
      provider,
      model: modelId,
      // Sem capacidades o turno não monta ferramenta nenhuma: o agente
      // entregue conversa e não alcança contato, lead nem funil.
      credential_id: credentialId,
      tool_ids: capacidadesPadraoDoOnboarding(),
      pipeline_ids: pipelineIds,
      channel_session_id: canal.id,
      status: "published",
      published_at: new Date().toISOString(),
      created_by: userId,
    })
    .select("id")
    .single();

  let versionId = version?.id ?? null;
  if (!versionId && versionErr?.code === "23505") {
    // A v1 já existe: uma passagem anterior gravou a versão e caiu antes de
    // apontar o agente para ela. Repetir o passo passou a ser o que o usuário
    // faz quando a tela pede — então ele não pode bater em "duplicate key"
    // para sempre. Repontar é o conserto, não um novo INSERT.
    const { data: existente } = await admin
      .from("ai_agent_versions")
      .select("id")
      .eq("organization_id", orgId)
      .eq("agent_id", agent.id)
      .eq("version_number", 1)
      .maybeSingle();
    versionId = existente?.id ?? null;
  }
  if (!versionId) {
    return {
      published: false,
      reason: "failed",
      message: versionErr?.message ?? "ai_agent_versions_insert_sem_id",
    };
  }

  const { error: pointErr } = await admin
    .from("ai_agents")
    .update({ published_version_id: versionId })
    .eq("id", agent.id)
    .eq("organization_id", orgId);
  if (pointErr) return { published: false, reason: "failed", message: pointErr.message };

  return { published: true };
}

export type CreateAgentResult =
  /**
   * O agente existe. `publish_error` presente = ficou RASCUNHO porque não deu
   * para decidir a publicação; ausente = publicado (ou rascunho deliberado por
   * ainda não haver número, caso em que o wizard já seguiu com um `redirect`).
   *
   * Mesmo contrato do passo de convites, que também recusa redirecionar quando
   * a parte que podia falhar falhou (`sendOnboardingInvites` → `undelivered`):
   * avançar calado seria a UI mentindo sobre o que o servidor conseguiu fazer.
   */
  /**
   * `publish_blocked_by` diz à tela QUAL causa explicar. Sem ele, o alerta
   * afirmava sempre a causa do canal ("não consegui ler os números de
   * WhatsApp") — e afirmar a causa errada é pior que não afirmar nenhuma:
   * manda a pessoa consertar o que não está quebrado.
   */
  | {
      ok: true;
      agent_id: string;
      publish_error?: string;
      publish_blocked_by?: "canal" | "modelo" | "chave";
      provider?: string;
      /** Catálogo vazio e catálogo sem modelo que sirva pedem conselhos opostos. */
      motivo_do_modelo?: "catalogo_vazio" | "nenhum_com_ferramentas";
      /** As regras da casa não foram gravadas — o agente existe assim mesmo. */
      regras_nao_salvas?: string;
    }
  | { ok: false; error: "auth_required" | "no_active_org" | "invalid_input" | "db_error"; details?: unknown };

export async function createDefaultAgent(formData: FormData): Promise<CreateAgentResult> {
  let ctx;
  try {
    ctx = await requireOnboardingCtx();
  } catch (err) {
    if (err instanceof OnboardingError) return { ok: false, error: err.code as never };
    throw err;
  }

  const raw = {
    name: String(formData.get("name") ?? "Atendente IA").trim(),
    prompt_template: String(formData.get("prompt_template") ?? "ecommerce_friendly"),
    regras_da_casa: String(formData.get("regras_da_casa") ?? "").trim() || undefined,
  };

  let input;
  try {
    input = aiAgentDefaultSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return { ok: false, error: "invalid_input", details: err.flatten() };
    }
    throw err;
  }

  const admin = createAdminClient();

  // O ramo que o dono escreveu no primeiro passo. Falha de leitura NÃO derruba o
  // passo: o funcionário nasce sem essa frase, que é degradação honesta — o
  // contrário seria travar a contratação por causa de um adjetivo.
  let oQueFaz: string | undefined;
  try {
    const { state } = await loadOnboardingState(ctx.orgId);
    oQueFaz = state.welcome?.o_que_faz;
  } catch {
    oQueFaz = undefined;
  }

  const systemPrompt = PROMPT_BODIES[input.prompt_template](ondeTrabalha(ctx.orgName, oQueFaz));

  // O agente padrão do onboarding é UM por organização, e o banco já garante
  // isso: `ai_agents_one_default_per_org` é índice único parcial em
  // (organization_id) where is_default. Nenhum outro caminho do produto grava
  // `is_default = true` (todos os outros INSERTs em `ai_agents` gravam false),
  // então "o default desta org" É "o agente que este passo criou" — chave de
  // reaproveitamento que não depende de nenhuma escrita anterior ter dado certo.
  //
  // O código antes fazia o oposto: rebaixava o default existente e inseria
  // outro. Enquanto o passo só terminava em redirect isso nunca aparecia; agora
  // que uma falha na publicação devolve o usuário para esta tela, o segundo
  // clique criaria um "Atendente IA" órfão por clique — todos invisíveis para o
  // runtime, e nenhum deles o padrão. Repetir o passo tem que ser inofensivo.
  const { data: reaproveitado, error: reuseErr } = await admin
    .from("ai_agents")
    .update({ name: input.name, system_prompt: systemPrompt, is_active: true })
    .eq("organization_id", ctx.orgId)
    .eq("is_default", true)
    .select("id, published_version_id")
    .maybeSingle();

  if (reuseErr) {
    return { ok: false, error: "db_error", details: reuseErr.message };
  }

  let agent: AgenteDoOnboarding | null = reaproveitado;
  if (!agent) {
    const { data, error } = await admin
      .from("ai_agents")
      .insert({
        organization_id: ctx.orgId,
        name: input.name,
        system_prompt: systemPrompt,
        // `mcp_agent`, e não o `rag_bot` que o banco tem como padrão.
        //
        // O default do banco é de quando o produto só tinha o formato antigo, e o
        // onboarding nunca escrevia este campo. O resultado: o funcionário que a
        // pessoa acabava de montar abria no EDITOR LEGADO — "Temperature",
        // "Top K", "Similarity threshold" — e as capacidades que ele recebeu
        // ligadas (mexer no contato, no negócio, no funil) ficavam invisíveis
        // para o dono. Funcionavam no runtime e não tinham superfície de
        // configuração, que é o invariante 6 do Sistema Vivo quebrado.
        //
        // O que travava a virada era o editor novo exigir `credential_id`, e
        // instalação pelo kit não ter nenhuma linha em `ai_provider_credentials`.
        // Isso foi resolvido: a versão aceita `credential_id: null` (= a chave da
        // instalação) e o seletor oferece essa opção.
        kind: "mcp_agent",
        is_default: true,
        is_active: true,
        created_by: ctx.userId,
      })
      .select("id, published_version_id")
      .single();

    if (error || !data) {
      return { ok: false, error: "db_error", details: error?.message };
    }
    agent = data;
  }

  // As regras da casa valem para QUALQUER agente da organização, então vão para
  // a memória da org — o mesmo lugar que a tela de Memória edita depois — e não
  // para o prompt deste agente. Enfiá-las no prompt faria a segunda contratação
  // nascer sem elas.
  //
  // Falha aqui NÃO derruba o passo: o agente já existe e o treinamento
  // principal aconteceu. Some do caminho crítico e vira aviso.
  let regrasNaoSalvas: string | null = null;
  if (input.regras_da_casa) {
    const pub = await publicarMemoriaDaOrg(admin, ctx.orgId, ctx.userId, input.regras_da_casa);
    if (!pub.ok) regrasNaoSalvas = pub.mensagem;
  }

  const publicacao = await publishFirstVersion(admin, ctx.orgId, agent, systemPrompt, ctx.userId);

  // Estado, audit e evento saem em QUALQUER desfecho da publicação: o agente
  // existe, e o passo do onboarding é "configurar IA", não "publicar". Deixar
  // de gravá-los por causa da versão era o que fazia o wizard esquecer um passo
  // que na verdade aconteceu.
  try {
    await patchOnboardingState(ctx.orgId, {
      ai: { agent_id: agent.id, prompt_template: input.prompt_template },
    });
  } catch (err) {
    if (err instanceof OnboardingError) return { ok: false, error: "db_error", details: err.message };
    throw err;
  }

  await audit({
    action: "onboarding.ai_configured",
    actorUserId: ctx.userId,
    organizationId: ctx.orgId,
    resourceType: "ai_agent",
    resourceId: agent.id,
    metadata: {
      prompt_template: input.prompt_template,
      name: input.name,
      published: publicacao.published,
      ...(publicacao.published ? {} : { publish_blocked_by: publicacao.reason }),
    },
  });

  // Emit a domain event for downstream listeners (Spec 01 §7 event log).
  await admin.from("event_log").insert({
    organization_id: ctx.orgId,
    event_type: "ai_agent.created",
    payload: { agent_id: agent.id, source: "onboarding", published: publicacao.published },
  });

  // Não deu para SABER se há canal: não publica (falha fechado na ação) e não
  // avança (falha aberto na informação) — a tela explica e oferece seguir. Um
  // redirect aqui deixaria como única pista um badge "Rascunho" numa tela que a
  // pessoa ainda não viu.
  if (!publicacao.published && publicacao.reason === "failed") {
    return {
      ok: true,
      agent_id: agent.id,
      publish_error: publicacao.message,
      publish_blocked_by: "canal",
      ...(regrasNaoSalvas ? { regras_nao_salvas: regrasNaoSalvas } : {}),
    };
  }

  // Mesma postura, outra causa: o provedor escolhido na instalação ainda não
  // tem modelo no catálogo desta instalação (o da OpenRouter só chega no cron
  // diário). Avançar calado deixaria a pessoa achar que o funcionário está no
  // ar — e ele não responde uma única mensagem.
  // Sem chave utilizável: o agente fica rascunho e a tela explica. Avançar
  // calado deixaria a pessoa achar que o funcionário está no ar.
  if (!publicacao.published && publicacao.reason === "sem_chave") {
    return {
      ok: true,
      agent_id: agent.id,
      publish_blocked_by: "chave",
      provider: publicacao.provider,
      ...(regrasNaoSalvas ? { regras_nao_salvas: regrasNaoSalvas } : {}),
    };
  }

  if (!publicacao.published && publicacao.reason === "no_model") {
    return {
      ok: true,
      agent_id: agent.id,
      publish_blocked_by: "modelo",
      provider: publicacao.provider,
      motivo_do_modelo: publicacao.motivo,
      ...(regrasNaoSalvas ? { regras_nao_salvas: regrasNaoSalvas } : {}),
    };
  }

  // Publicou o agente, mas as regras da casa não foram gravadas. O passo
  // aconteceu; o que a pessoa escreveu, não. Redirecionar calado apagaria da
  // tela o único lugar onde esse texto existia.
  if (regrasNaoSalvas) {
    return { ok: true, agent_id: agent.id, regras_nao_salvas: regrasNaoSalvas };
  }

  redirect("/onboarding");
}

export async function skipAi(): Promise<void> {
  const ctx = await requireOnboardingCtx();
  await patchOnboardingState(ctx.orgId, {
    ai: { agent_id: "", prompt_template: "skipped", skipped: true },
  });
  redirect("/onboarding");
}
