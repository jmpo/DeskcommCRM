/**
 * SEAM ÚNICO de chamada de modelo: TODA chamada de LLM do harness passa por
 * runModelCall — agente, classificadores auxiliares e compaction usam esta MESMA
 * função (nenhum call site instancia provider).
 *
 * Por chamada: resolve a config da org no DB (BYOK em ai_provider_credentials +
 * knobs em organizations.settings->'llm'; troca de modelo/provider = UPDATE na
 * config, vale no run seguinte, sem restart) → checa o budget mensal ANTES de
 * sair byte para o provider → generateText do AI SDK → grava usage/custo em
 * llm_calls. A chave da org nunca entra em prompt, tool result ou log — ela só
 * cruza a fronteira na instância do provider.
 *
 * Shape do usage: `LanguageModelUsage` (node_modules/ai/dist/index.d.ts):
 * inputTokens/outputTokens totais + inputTokenDetails.{cacheReadTokens,
 * cacheWriteTokens}. Validado no ai@7 via scripts/smoke-llm.sh (modelo real) —
 * upgrade de major re-valida esses paths pelo mesmo gate (regra dura 16).
 */
import { generateText, stepCountIs, type ModelMessage, type ToolSet } from 'ai';
import type pg from 'pg';
import { z } from 'zod';

import { scrubMessage } from '@/lib/sentry/scrub';

import type { Logger } from '../../obs/logger';
import { decidirParaOSeam } from './binding-do-ponto';
import { resolveOrgLlmConfig, type LlmEdgeConfig } from './credentials';
import { costCents } from './pricing';
import { createDefaultRegistry, type ProviderRegistry } from './providers';
import { buildStablePrefix } from './stable-prefix';

// Call sites FORA da camada importam os tipos daqui — nunca de 'ai' direto
// (o seam é a única porta). `tool` idem: é como o agente define ToolSet sem
// tocar no SDK.
export { tool } from 'ai';
export type { ModelMessage, ToolSet } from 'ai';
export type { LlmEdgeConfig } from './credentials';
export { llmEdgeConfigFromEnv, LlmNotConfiguredError } from './credentials';

/** Teto mensal da org esgotado — runs recusados ANTES do provider (zero tokens). */
export class LlmBudgetExceededError extends Error {
  override readonly name = 'llm_budget_exceeded';
  constructor() {
    super('orçamento mensal de LLM da org esgotado — chamada recusada; ajuste o teto ou aguarde a virada do mês (agent_inbox_items kind=budget_exceeded)');
  }
}

/** Provider da config sem entrada no registry — erro de config, nunca fallback. */
export class LlmProviderUnknownError extends Error {
  override readonly name = 'llm_provider_unknown';
  constructor(provider: string) {
    super(`provider LLM desconhecido na config da org: ${provider}`);
  }
}

/** Modelo pedido fora de enabled_models da org. */
export class LlmModelNotEnabledError extends Error {
  override readonly name = 'llm_model_not_enabled';
  constructor(model: string) {
    super(`modelo não habilitado para a org (enabled_models): ${model}`);
  }
}

// Whitelist de params da org (jsonb livre no DB → só o que o seam entende passa).
const paramsSchema = z
  .object({
    temperature: z.number().optional(),
    topP: z.number().optional(),
    topK: z.number().int().optional(),
    maxOutputTokens: z.number().int().positive().optional(),
  })
  .passthrough();

export interface RunModelCallInput {
  tenantId: string;
  leadId?: string | null;
  jobId?: string | null;
  variantId?: string | null;
  /** atribuição de custo: 'agent_turn' (default) | 'classifier' | 'compaction' | 'connection_test' */
  purpose?: string;
  system?: string;
  messages: ModelMessage[];
  tools?: ToolSet;
  /**
   * Override do modelo default da org — é como classificador/compaction usam um
   * modelo pequeno pela MESMA camada. Sujeito a enabled_models quando a lista
   * não é vazia. NUNCA um id hardcoded: o valor vem de config de quem chama.
   */
  model?: string;
  /**
   * Teto do loop de tool-calls do generateText (vira stopWhen: stepCountIs). Sem
   * ele o SDK para no 1º step (default stepCountIs(1)) — tools executam mas o
   * modelo não vê o resultado. Quem chama passa o knob (ex.: AGENT_MAX_STEPS do
   * agente), nunca constante.
   */
  maxSteps?: number;
  /**
   * Override de provider/credencial vindo da versão PUBLICADA do agente (Fase
   * 2B) — resolvido no seam, nunca no call site. Sem ele, config da org.
   */
  llmOverride?: import('./credentials').LlmResolveOverride;
}

export interface RunModelCallDeps {
  registry?: ProviderRegistry;
  log?: Logger;
}

/**
 * Budget é enforcement do harness: agregado mensal de llm_calls × teto da org
 * (organizations.settings.llm.monthly_budget_cents), checado antes de QUALQUER
 * byte ao provider. Estouro → agent_inbox_items (1 por episódio: enquanto houver
 * item 'budget_exceeded' aberto, recusas novas não duplicam o alerta) + erro
 * tipado. ponytail: o insert-if-not-exists é um único statement; duas recusas
 * exatamente simultâneas podem duplicar o alerta — inócuo.
 */
async function assertBudget(db: pg.Pool, organizationId: string, budgetCents: number | null): Promise<void> {
  if (budgetCents === null) {
    return;
  }
  const { rows } = await db.query<{ spent: number }>(
    `select coalesce(sum(cost_cents), 0)::float8 as spent
     from llm_calls
     where organization_id = $1 and created_at >= date_trunc('month', now())`,
    [organizationId],
  );
  const spent = rows[0]?.spent ?? 0;
  if (spent < budgetCents) {
    return;
  }
  await db.query(
    `insert into agent_inbox_items (organization_id, kind, severity, title, body)
     select $1, 'budget_exceeded', 'critical',
            'Orçamento mensal de LLM esgotado — agente pausado para esta org',
            'gasto do mês atingiu o teto configurado em organizations.settings.llm.monthly_budget_cents; aumente o teto ou aguarde a virada do mês'
     where not exists (
       select 1 from agent_inbox_items
       where organization_id = $1 and kind = 'budget_exceeded' and status = 'open'
     )`,
    [organizationId],
  );
  throw new LlmBudgetExceededError();
}

export async function runModelCall(db: pg.Pool, cfg: LlmEdgeConfig, input: RunModelCallInput, deps: RunModelCallDeps = {}) {
  const registry = deps.registry ?? createDefaultRegistry();
  const purpose = input.purpose ?? 'agent_turn';

  // A config da org é lida ANTES da decisão porque o resolvedor precisa dela
  // como último degrau da precedência (o padrão, quando ninguém mais opinou).
  const padrao = await resolveOrgLlmConfig(db, cfg, input.tenantId, input.llmOverride);

  // O painel de provedores entra AQUI, e é o que faz `purpose` deixar de ser
  // só um rótulo de custo e virar decisão. Sem binding configurado, `decisao`
  // reproduz exatamente o comportamento anterior — a origem volta como
  // 'variavel_de_ambiente' ou 'padrao_da_organizacao'.
  const decisao = await decidirParaOSeam(db, {
    organizationId: input.tenantId,
    purpose,
    modeloDoCallSite: input.model,
    overrideDoAgente:
      input.llmOverride === undefined
        ? null
        : {
            provider: input.llmOverride.provider ?? padrao.provider,
            credentialId: input.llmOverride.credentialId ?? null,
            model: input.model,
          },
    padraoDaOrganizacao: { provider: padrao.provider, defaultModel: padrao.defaultModel },
  }, deps.log ? { log: deps.log } : {});

  // Só re-resolve a credencial quando o painel apontou para OUTRA que não a já
  // carregada — decifrar duas vezes a mesma chave é custo puro no caminho
  // quente, e cada decifragem é mais um instante com plaintext em memória.
  const precisaOutraCredencial =
    decisao.origem === 'binding' &&
    (decisao.provider !== padrao.provider || decisao.credentialId !== null);

  const config = precisaOutraCredencial
    ? await resolveOrgLlmConfig(db, cfg, input.tenantId, {
        provider: decisao.provider,
        credentialId: decisao.credentialId,
      })
    : padrao;

  await assertBudget(db, input.tenantId, config.monthlyBudgetCents);

  const model = decisao.modelId;
  if (model === null || model === undefined) {
    throw new Error(
      'modelo LLM não definido — configure o ponto no painel de provedores, ' +
        'organizations.settings.llm.default_model, ou passe input.model',
    );
  }
  if (config.enabledModels.length > 0 && !config.enabledModels.includes(model)) {
    throw new LlmModelNotEnabledError(model);
  }
  const factory = registry[config.provider];
  if (factory === undefined) {
    throw new LlmProviderUnknownError(config.provider);
  }
  const parsedParams = paramsSchema.safeParse(config.params);
  if (!parsedParams.success) {
    throw new Error('params inválidos em organizations.settings.llm.params — corrija a config da org');
  }
  const { temperature, topP, topK, maxOutputTokens } = parsedParams.data;

  // Disciplina de cache: o prefixo estável org-wide (system do playbook + tools
  // em ordem determinística) ganha os breakpoints AQUI, no seam — call sites
  // passam system/tools crus. Tudo por-lead vive em input.messages, DEPOIS do
  // breakpoint. TTL: knob LLM_CACHE_TTL; '1h' é a doutrina.
  const prefix = buildStablePrefix({
    system: input.system,
    tools: input.tools,
    cacheTtl: cfg.cacheTtl ?? '1h',
  });

  const startedAt = Date.now();
  let result: Awaited<ReturnType<typeof generateText>>;
  try {
    // `system` aceita SystemModelMessage (com providerOptions de cache) — igual
    // em v6 e v7 (smoke prova que o cacheControl continua virando cache_control).
    result = await generateText({
      // `decisao.baseUrl` só é preenchido quando o painel apontou um endpoint
      // (gateway OpenAI-compatível, ou modelo local). Providers canônicos
      // ignoram o terceiro argumento e vão ao endpoint intrínseco.
      model: factory(config.apiKey, model, decisao.baseUrl ?? undefined),
      system: prefix.system,
      messages: input.messages,
      tools: prefix.tools,
      stopWhen: input.maxSteps === undefined ? undefined : stepCountIs(input.maxSteps),
      temperature,
      topP,
      topK,
      maxOutputTokens,
    });
  } catch (err) {
    // ─── A LINHA QUE FALTAVA ────────────────────────────────────────────────
    //
    // Até aqui o INSERT em llm_calls vivia só DEPOIS desta chamada, sem `try`
    // em volta. Provedor recusou a chave, modelo não existe, conta sem saldo? A
    // exceção subia e NADA ficava gravado. A tabela que deveria explicar era
    // justamente a que ficava vazia no caso que precisa de explicação — e é a
    // causa direta de "o agente não responde e não aparece erro em lugar
    // nenhum".
    //
    // Grava e RELANÇA: quem chama continua decidindo o que fazer com a falha
    // (o worker reagenda, o dry-run mostra na tela). Engolir aqui trocaria uma
    // falha invisível por uma silenciosa, que é pior.
    await registrarFalha(db, {
      input,
      purpose,
      provider: config.provider,
      model,
      origem: decisao.origem,
      latencyMs: Date.now() - startedAt,
      erro: err,
    }).catch(() => {
      // O log da falha não pode causar uma segunda falha. Se o próprio INSERT
      // de erro falhar, o erro ORIGINAL é o que interessa a quem chamou.
    });
    deps.log?.error('llm: chamada falhou', {
      organization_id: input.tenantId,
      purpose,
      provider: config.provider,
      model,
      origem_da_escolha: decisao.origem,
      ...normalizarErro(err),
    });
    throw err;
  }
  const latencyMs = Date.now() - startedAt;

  const usage = {
    inputTokens: result.usage.inputTokens ?? 0,
    outputTokens: result.usage.outputTokens ?? 0,
    cacheReadTokens: result.usage.inputTokenDetails.cacheReadTokens ?? 0,
    cacheWriteTokens: result.usage.inputTokenDetails.cacheWriteTokens ?? 0,
  };
  const cost = costCents(model, usage);

  const { rows } = await db.query<{ id: string }>(
    `insert into llm_calls
       (organization_id, contact_id, job_id, variant_id, purpose, provider, model,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_cents, latency_ms,
        status, origem_da_escolha)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'ok', $14)
     returning id`,
    [
      input.tenantId,
      input.leadId ?? null,
      input.jobId ?? null,
      input.variantId ?? null,
      purpose,
      config.provider,
      model,
      usage.inputTokens,
      usage.outputTokens,
      usage.cacheReadTokens,
      usage.cacheWriteTokens,
      cost,
      latencyMs,
      decisao.origem,
    ],
  );

  // Só métricas — nunca conteúdo de mensagem (PII) nem chave.
  deps.log?.info('llm: chamada concluída', {
    organization_id: input.tenantId,
    provider: config.provider,
    model,
    purpose,
    // POR QUE este modelo, e não só QUAL: é a diferença entre um log que
    // confirma o que aconteceu e um que explica uma configuração que não
    // pegou. Vira coluna em llm_calls na frente de logs.
    origem_da_escolha: decisao.origem,
    ...usage,
    cost_cents: cost,
    latency_ms: latencyMs,
  });
  for (const aviso of decisao.avisos) {
    deps.log?.warn('llm: configuração do ponto tem incoerência', {
      organization_id: input.tenantId,
      purpose,
      aviso,
    });
  }

  return {
    result,
    callId: rows[0]?.id ?? null,
    provider: config.provider,
    model,
    usage,
    costCents: cost,
    latencyMs,
    /** De onde veio a escolha — o painel lê isto para explicar cada ponto. */
    origem: decisao.origem,
    avisos: decisao.avisos,
  };
}

/**
 * Classifica o erro do provedor num vocabulário nosso.
 *
 * Existe porque provedores diferentes relatam o MESMO problema de formas
 * diferentes: a mesma chave inválida vira `AI_APICallError` num, `401
 * Unauthorized` noutro e `authentication_error` num terceiro. Sem normalizar, a
 * tela de execuções mostraria três textos distintos e o operador não saberia
 * que os três são a mesma conversa — "a chave está errada".
 *
 * Os baldes são escolhidos pela AÇÃO que cada um exige de quem instalou:
 * trocar a chave, escolher outro modelo, esperar/pagar, ou aguardar o provedor.
 */
function normalizarErro(err: unknown): {
  error_code: string;
  error_message: string;
  http_status: number | null;
} {
  const bruto = err instanceof Error ? err.message : String(err);
  const status =
    (err as { statusCode?: number; status?: number })?.statusCode ??
    (err as { statusCode?: number; status?: number })?.status ??
    null;

  let codigo = 'erro_desconhecido';
  if (status === 401 || status === 403 || /unauthor|invalid.*api.?key|authentication|incorrect api key/i.test(bruto)) {
    codigo = 'credencial_recusada';
  } else if (status === 404 || /model.*not.*found|does not exist/i.test(bruto)) {
    codigo = 'modelo_inexistente';
  } else if (status === 429 || /rate.?limit|quota|insufficient.*credit/i.test(bruto)) {
    codigo = 'limite_ou_saldo';
  } else if ((status !== null && status >= 500) || /timeout|ECONNREFUSED|fetch failed|network/i.test(bruto)) {
    codigo = 'provedor_indisponivel';
  } else if (/tool|function.?call/i.test(bruto)) {
    codigo = 'modelo_sem_ferramentas';
  }

  return {
    error_code: codigo,
    // Redigida E truncada. O comentário anterior dizia "sem
    // prompt/resposta/chave" e o único tratamento era o `slice` — a garantia
    // estava escrita e não existia, que é pior que não existir e ninguém
    // achar que existe.
    //
    // A mensagem crua do provedor vai para `llm_calls.error_message`, sai no
    // JSON de `GET /api/v1/ai/runs` e é renderizada na tela de Execuções para
    // qualquer `manager` da organização. Um endpoint OpenAI-compatível
    // apontado por `base_url` — caminho que o painel de provedores abre — pode
    // ecoar no corpo de erro o header de autorização ou o prompt recebido.
    error_message: redigirMensagemDoProvedor(bruto),
    http_status: typeof status === 'number' ? status : null,
  };
}

/**
 * Tira da mensagem do provedor o que não pode aparecer numa tela: segredo e
 * dado do titular. Trunca DEPOIS de redigir — cortar antes deixaria meia chave
 * passar, e meia chave ainda identifica de quem ela é.
 *
 * Os padrões de chave (`sk-…`, `Bearer …`) vêm daqui e não do
 * `lib/sentry/scrub.ts` porque lá o alvo é PII de titular; os dois se somam.
 */
export function redigirMensagemDoProvedor(bruto: string): string {
  const semSegredo = bruto
    // Chaves de API dos provedores que este produto fala: `sk-ant-…`,
    // `sk-or-v1-…`, `sk-proj-…`, `sk-…`, e as do Google (`AIza…`).
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[CHAVE]')
    .replace(/AIza[A-Za-z0-9_-]{10,}/g, '[CHAVE]')
    // O header inteiro, em qualquer caixa, com ou sem `Authorization:` na
    // frente — é assim que ele costuma aparecer ecoado num corpo de erro.
    .replace(/[Bb]earer\s+[A-Za-z0-9._-]{8,}/g, 'Bearer [CHAVE]')
    .replace(/(x-api-key|api[-_]?key|authorization)\s*[:=]\s*\S+/gi, '$1: [CHAVE]');
  return scrubMessage(semSegredo).slice(0, 500);
}

/**
 * Grava a chamada que FALHOU, na MESMA tabela do sucesso.
 *
 * Mesma tabela de propósito: a tela de execuções conta a história de um ponto em
 * ordem, e separar erros noutra tabela faria a leitura precisar de dois lugares
 * — que é exatamente como um dos dois para de ser olhado.
 *
 * Tokens ficam em zero e o custo em NULL: a chamada não consumiu nada, e `null`
 * é "não sei", nunca "de graça" — mesma doutrina da coluna `cost_cents`.
 */
async function registrarFalha(
  db: pg.Pool,
  d: {
    input: RunModelCallInput;
    purpose: string;
    provider: string;
    model: string;
    origem: string;
    latencyMs: number;
    erro: unknown;
  },
): Promise<void> {
  const { error_code, error_message, http_status } = normalizarErro(d.erro);
  await db.query(
    `insert into llm_calls
       (organization_id, contact_id, job_id, variant_id, purpose, provider, model,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_cents, latency_ms,
        status, error_code, error_message, http_status, origem_da_escolha)
     values ($1, $2, $3, $4, $5, $6, $7, 0, 0, 0, 0, null, $8, 'erro', $9, $10, $11, $12)`,
    [
      d.input.tenantId,
      d.input.leadId ?? null,
      d.input.jobId ?? null,
      d.input.variantId ?? null,
      d.purpose,
      d.provider,
      d.model,
      d.latencyMs,
      error_code,
      error_message,
      http_status,
      d.origem,
    ],
  );
}
