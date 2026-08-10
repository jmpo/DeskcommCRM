/**
 * Per-tenant rate limit for agent dispatch (S-13.07).
 *
 * Fixed-window counter on Upstash Redis: `ai-runs:<org>:<window-start>` with
 * INCR + EXPIRE. Sub-minute granularity is good enough for the 60/min default
 * and avoids pulling in `@upstash/ratelimit` (no new deps for this wave).
 *
 * In-memory fallback mirrors `lib/ai/rag/debounce.ts` — loud warn so operators
 * notice when Redis is misconfigured and the limit is effectively per-instance.
 */

import { Redis } from "@upstash/redis";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

let _redis: Redis | null = null;
let _fallbackWarned = false;

function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (!_fallbackWarned) {
      logger.warn("[ai-dispatcher.rate-limit] Redis missing — using in-memory fallback (not safe for multi-instance)");
      _fallbackWarned = true;
    }
    return null;
  }
  // `retry: false`: com Redis inalcançável (URL errada, rede caída), o default
  // do SDK re-tenta com backoff e cada chamada passa a custar SEGUNDOS. Como
  // já existe fallback em memória logo abaixo, retentar aqui só transfere a
  // indisponibilidade do Redis para a latência do login. Falhe rápido e caia
  // para a memória. Medido: com URL morta, duas chamadas somavam ~8s numa
  // requisição de recuperação de senha, estourando o timeout da tela.
  _redis = new Redis({ url, token, retry: false });
  return _redis;
}

interface MemBucket {
  count: number;
  expiresAt: number;
}
const _memBuckets = new Map<string, MemBucket>();

/**
 * VARREDURA DAS JANELAS VENCIDAS — sem ela o mapa cresce para sempre.
 *
 * A chave embute a janela (`<bucket>:<windowStart>`), então uma chave nunca volta a
 * ser consultada depois de expirar: `windowStart` avança e a próxima chamada usa
 * outra chave. O `set` só sobrescrevia a MESMA chave, e nada apagava as anteriores —
 * o processo acumulava uma entrada por bucket por janela, indefinidamente.
 *
 * E o caminho em memória não é hipótese remota: as duas variáveis do Upstash são
 * OPCIONAIS no kit self-host, então sem elas este é o caminho normal. Medido num
 * único job de e2e: 120 quedas para memória. Com `webhook_in:<token>` (janela de 60s)
 * são 1.440 chaves por dia por token, nenhuma delas relida.
 *
 * Oportunista, e não um timer: um `setInterval` num módulo de request handler segura
 * o processo vivo e roda em todo runtime que importar o arquivo, inclusive edge. Aqui
 * o custo é O(n) uma vez a cada `VARRE_A_CADA` chamadas, e o resto entre passagens é
 * limitado por esse mesmo número.
 */
const VARRE_A_CADA = 128;
let _chamadasDesdeAVarredura = 0;

function varrerVencidas(agora: number): void {
  for (const [chave, balde] of _memBuckets) {
    if (balde.expiresAt <= agora) _memBuckets.delete(chave);
  }
}

function memIncrement(key: string, windowSec: number): number {
  const now = Date.now();
  if (++_chamadasDesdeAVarredura >= VARRE_A_CADA) {
    _chamadasDesdeAVarredura = 0;
    varrerVencidas(now);
  }
  const existing = _memBuckets.get(key);
  if (!existing || existing.expiresAt <= now) {
    _memBuckets.set(key, { count: 1, expiresAt: now + windowSec * 1000 });
    return 1;
  }
  existing.count += 1;
  return existing.count;
}

/** Só para teste: quantas chaves o contador em memória guarda NESTE instante. */
export function __chavesEmMemoriaParaTeste(): number {
  return _memBuckets.size;
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  window_sec: number;
}

/**
 * Increments the per-tenant counter for the current window and returns whether
 * the call is below the limit. Counter expires automatically — no cleanup
 * needed beyond Redis TTL.
 */
export async function checkRateLimit(
  bucket: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  const windowStart = Math.floor(Date.now() / (windowSec * 1000));
  const key = `${bucket}:${windowStart}`;

  const redis = getRedis();
  let count: number;
  if (!redis) {
    count = memIncrement(key, windowSec);
  } else {
    try {
      count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, windowSec);
      }
    } catch (err) {
      logger.warn("[ai-dispatcher.rate-limit] redis incr failed; falling back to in-memory", {
        error: err instanceof Error ? err.message : String(err),
        bucket,
      });
      count = memIncrement(key, windowSec);
    }
  }

  return {
    allowed: count <= limit,
    count,
    limit,
    window_sec: windowSec,
  };
}

/**
 * Lê o contador SEM incrementar (issue #64).
 *
 * Existe porque bloqueio por tentativa-que-falhou precisa de duas operações
 * distintas: *consultar* antes de chamar o provedor (senão o ataque nunca é
 * barrado antes de acontecer) e *incrementar* só quando a tentativa falha
 * (senão login bem-sucedido consome o orçamento e tranca quem acertou a senha).
 */
export async function peekRateLimit(bucket: string, windowSec: number): Promise<number> {
  const windowStart = Math.floor(Date.now() / (windowSec * 1000));
  const key = `${bucket}:${windowStart}`;

  const redis = getRedis();
  if (!redis) {
    const existing = _memBuckets.get(key);
    return !existing || existing.expiresAt <= Date.now() ? 0 : existing.count;
  }
  try {
    const value = await redis.get<number | string>(key);
    return value == null ? 0 : Number(value);
  } catch {
    const existing = _memBuckets.get(key);
    return !existing || existing.expiresAt <= Date.now() ? 0 : existing.count;
  }
}
