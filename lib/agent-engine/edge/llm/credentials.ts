/**
 * Config LLM por org, pós-fusão (PORT-NOTES): a credencial BYOK vive em
 * `ai_provider_credentials` do CRM (AES-256-GCM via lib/crypto/aes_gcm — colunas
 * api_key_encrypted/api_key_iv/api_key_tag) e os knobs de modelo/params/teto vivem
 * em `organizations.settings->'llm'`. Sem BYOK, o fallback é a chave de plataforma
 * do env (ANTHROPIC_API_KEY ou OPENAI_API_KEY, conforme o provider). O plaintext da chave
 * existe apenas em memória do processo no instante da chamada; nunca em log.
 *
 * A config é lida do DB A CADA chamada (resolveOrgLlmConfig) — trocar modelo/
 * provider/teto é UPDATE na config, sem restart nem deploy.
 */
import type pg from 'pg';
import { z } from 'zod';

import { byteaToBuffer, decryptKey } from '@/lib/crypto/aes_gcm';
import type { CacheTtl } from './stable-prefix';

/** Config da camada LLM montada do env validado (padrão crmEdgeConfigFromEnv). */
export interface LlmEdgeConfig {
  /** chave de plataforma (fallback quando a org não tem BYOK). Opcional no boot. */
  anthropicApiKey?: string;
  /**
   * Mesma ideia para OpenAI. Existia só a da Anthropic, e isso quebrava a
   * transcrição de áudio: o Whisper é da OpenAI, mas a org que usa Anthropic
   * como provedor de chat não tem credencial OpenAI cadastrada — e o
   * instalador coleta OPENAI_API_KEY justamente para isso. Sem este fallback
   * a chave do instalador não chegava a lugar nenhum.
   */
  openaiApiKey?: string;
  /**
   * Mesma ideia para a OpenRouter — e o buraco era pior, porque o instalador
   * passou a OFERECER OpenRouter como primeira opção. Quem escolhia e não
   * cadastrava chave da Anthropic tinha `LlmNotConfiguredError` em tudo que
   * passa por este seam, com a mensagem de erro mandando cadastrar justamente
   * as duas chaves que ele decidiu não usar. Na derivação de mídia o desfecho
   * era mudo: 5 tentativas, `media_derived_status='failed'`, zero avisos.
   */
  openrouterApiKey?: string;
  /**
   * TTL do prefixo estável de cache (knob LLM_CACHE_TTL). Opcional para quem
   * monta a config na mão (testes) — o seam aplica a doutrina '1h' quando ausente.
   */
  cacheTtl?: CacheTtl;
}

/**
 * ⚠️ `OPENAI_API_KEY` entra aqui, e não entrava antes — o campo `openaiApiKey`
 * existia no tipo e era lido em `resolveOrgLlmConfig`, mas NENHUM caminho do
 * agente o preenchia (só o worker de transcrição de áudio montava a config na
 * mão). O efeito: numa instalação com a chave da OpenAI no `.env`, um agente com
 * modelo OpenAI caía em `LlmNotConfiguredError` — a chave estava lá, coletada
 * pelo instalador, e o turno morria como se não estivesse. Um campo declarado que
 * ninguém preenche é pior que um campo ausente: faz quem lê o código concluir que
 * o caminho existe.
 */
export function llmEdgeConfigFromEnv(env: {
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  LLM_CACHE_TTL?: string;
}): LlmEdgeConfig {
  const ttl = env.LLM_CACHE_TTL ?? '1h';
  if (ttl !== '5m' && ttl !== '1h') {
    throw new Error("LLM_CACHE_TTL inválido — use '5m' ou '1h' (default 1h)");
  }
  return {
    ...(env.ANTHROPIC_API_KEY ? { anthropicApiKey: env.ANTHROPIC_API_KEY } : {}),
    ...(env.OPENAI_API_KEY ? { openaiApiKey: env.OPENAI_API_KEY } : {}),
    ...(env.OPENROUTER_API_KEY ? { openrouterApiKey: env.OPENROUTER_API_KEY } : {}),
    cacheTtl: ttl,
  };
}

/** Org sem credencial LLM utilizável — erro tipado, mensagem sem valores (credencial fora). */
export class LlmNotConfiguredError extends Error {
  override readonly name = 'llm_not_configured';
  constructor() {
    super(
      'org sem credencial LLM utilizável — cadastre uma chave BYOK ativa/validada em ai_provider_credentials ou defina ANTHROPIC_API_KEY / OPENAI_API_KEY (fallback de plataforma, conforme o provider do modelo)',
    );
  }
}

export interface OrgLlmConfig {
  provider: string;
  /** plaintext decifrado — existe só em memória, jamais logado/persistido */
  apiKey: string;
  defaultModel: string | null;
  params: Record<string, unknown>;
  enabledModels: string[];
  monthlyBudgetCents: number | null;
}

// Leitura DEFENSIVA de organizations.settings->'llm' (jsonb livre): campo com
// shape errado cai no default, nunca derruba o turno.
const llmSettingsSchema = z
  .object({
    provider: z.string().min(1).catch('anthropic'),
    default_model: z.string().min(1).nullable().catch(null),
    params: z.record(z.string(), z.unknown()).catch({}),
    enabled_models: z.array(z.string()).catch([]),
    monthly_budget_cents: z.number().finite().nullable().catch(null),
  })
  .passthrough()
  .catch({
    provider: 'anthropic',
    default_model: null,
    params: {},
    enabled_models: [],
    monthly_budget_cents: null,
  });

/**
 * Resolve a config LLM da org: knobs de organizations.settings->'llm' + credencial
 * BYOK mais recente ativa/validada de ai_provider_credentials (decifrada com
 * aes_gcm). Sem BYOK → fallback cfg.anthropicApiKey (só anthropic). Sem nada →
 * LlmNotConfiguredError. Chamada a cada run — troca de config vale no run seguinte.
 */
/**
 * Override por-turno vindo da versão PUBLICADA do agente (Fase 2B): a tela
 * escolhe provider e credencial ESPECÍFICA; sem override, vale a config da org
 * (settings.llm + credencial mais recente do provider).
 */
export interface LlmResolveOverride {
  provider?: string;
  credentialId?: string | null;
}

export async function resolveOrgLlmConfig(
  db: pg.Pool,
  cfg: LlmEdgeConfig,
  organizationId: string,
  override?: LlmResolveOverride,
): Promise<OrgLlmConfig> {
  const { rows } = await db.query<{ llm: unknown }>(
    `select settings->'llm' as llm from organizations where id = $1`,
    [organizationId],
  );
  if (rows.length === 0) {
    throw new Error('organização inexistente ao resolver config LLM');
  }
  const settings = llmSettingsSchema.parse(rows[0]?.llm ?? {});
  const provider = override?.provider ?? settings.provider;

  // Credencial: a ESCOLHIDA na versão publicada quando houver (ainda exigindo
  // ativa+validada — publish valida, mas a credencial pode ser revogada depois);
  // senão a mais recente ativa/validada do provider. Sempre escopada pela org.
  const { rows: credRows } = override?.credentialId
    ? await db.query<{
        api_key_encrypted: unknown;
        api_key_iv: unknown;
        api_key_tag: unknown;
      }>(
        `select api_key_encrypted, api_key_iv, api_key_tag
         from ai_provider_credentials
         where organization_id = $1 and id = $2
           and is_active and validated_at is not null
         limit 1`,
        [organizationId, override.credentialId],
      )
    : await db.query<{
        api_key_encrypted: unknown;
        api_key_iv: unknown;
        api_key_tag: unknown;
      }>(
        `select api_key_encrypted, api_key_iv, api_key_tag
         from ai_provider_credentials
         where organization_id = $1 and provider = $2
           and is_active and validated_at is not null
         order by created_at desc
         limit 1`,
        [organizationId, provider],
      );

  let apiKey: string;
  const cred = credRows[0];
  if (cred !== undefined) {
    apiKey = decryptKey({
      ciphertext: byteaToBuffer(cred.api_key_encrypted),
      iv: byteaToBuffer(cred.api_key_iv),
      tag: byteaToBuffer(cred.api_key_tag),
    });
  } else if (provider === 'anthropic' && cfg.anthropicApiKey) {
    apiKey = cfg.anthropicApiKey;
  } else if (provider === 'openai' && cfg.openaiApiKey) {
    apiKey = cfg.openaiApiKey;
  } else if (provider === 'openrouter' && cfg.openrouterApiKey) {
    apiKey = cfg.openrouterApiKey;
  } else {
    throw new LlmNotConfiguredError();
  }

  return {
    provider,
    apiKey,
    defaultModel: settings.default_model ?? null,
    params: settings.params,
    enabledModels: settings.enabled_models,
    monthlyBudgetCents: settings.monthly_budget_cents ?? null,
  };
}
