/**
 * Entrada de webhook, do lado de dentro do seam.
 *
 * A rota não pode saber QUAL canal é — o invariante 1 da doutrina proíbe, e o
 * `lint:channels` reprovou a primeira versão desta rota exatamente por isso,
 * que é a catraca funcionando. Então a rota entrega o que sabe (a sessão, o
 * corpo cru, o header de assinatura) e recebe um desfecho; toda a decisão
 * específica de canal mora aqui.
 *
 * Um canal seguinte entra com um `case` neste arquivo e zero linhas na rota.
 *
 * ─── Por que a assinatura é verificada AQUI, e não na rota ──────────────────
 *
 * Porque o esquema é do canal: header, algoritmo e formato mudam por provider
 * (um assina SHA-512 com um nome de header, outro SHA-256 com outro). Uma rota
 * que verificasse teria que perguntar de quem é o payload — o `if (provider ===
 * ...)` que a doutrina existe para impedir.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { CHANNEL_PROVIDER_ZERNIO } from "./capabilities";
import { atualizarEspelhoDoTemplate, avisoDoEvento, registrarAviso } from "./zernio/avisos";
import { aplicarEdicaoZernio, ingestZernioInbound } from "./zernio/ingest";
import { parseZernioEdicao, verifyZernioSignature } from "./zernio/webhook";
import type { ChannelProvider } from "./types";

/** Curto demais para ser segredo — placeholder ou lixo de decrypt. */
const MIN_SECRET_LEN = 16;

export interface InboundWebhookInput {
  session: { id: string; organization_id: string; provider: string };
  rawBody: string;
  /** Todos os headers da requisição — cada canal lê o SEU. */
  headers: Headers;
  /** Segredo já decifrado pela rota, ou null quando não foi possível. */
  secret: string | null;
}

export type InboundWebhookOutcome =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; code: "unauthorized" | "provider_mismatch" | "invalid_json"; message: string };

/**
 * Este canal sabe receber webhook? Perguntado pela rota ANTES de qualquer
 * trabalho — e respondido sem nomear provider do lado de fora.
 */
export function acceptsInboundWebhook(provider: string): boolean {
  return provider === CHANNEL_PROVIDER_ZERNIO;
}

export async function handleInboundWebhook(
  admin: SupabaseClient,
  input: InboundWebhookInput,
): Promise<InboundWebhookOutcome> {
  const provider = input.session.provider as ChannelProvider;

  switch (provider) {
    case CHANNEL_PROVIDER_ZERNIO:
      return zernioInbound(admin, input);
    default:
      // Token de um canal que não entra por aqui. É configuração trocada, não
      // ataque — mas processar seria ler o payload com o parser errado.
      return { ok: false, code: "provider_mismatch", message: "canal não recebe por esta rota" };
  }
}

async function zernioInbound(
  admin: SupabaseClient,
  input: InboundWebhookInput,
): Promise<InboundWebhookOutcome> {
  // Fail-closed, sem a exceção que virou regra no canal por QR: lá, "não
  // consegui verificar" virava "processa assim mesmo", e isso deixou toda
  // instalação aceitando mensagem forjada de quem soubesse a URL. Este provider
  // assina sempre, então não há dilema a herdar.
  if (!input.secret || input.secret.length < MIN_SECRET_LEN) {
    return { ok: false, code: "unauthorized", message: "webhook_secret_unavailable" };
  }

  const assinatura = input.headers.get("x-zernio-signature");
  if (!verifyZernioSignature(input.rawBody, assinatura, input.secret)) {
    return { ok: false, code: "unauthorized", message: "bad_signature" };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(input.rawBody);
  } catch {
    return { ok: false, code: "invalid_json", message: "invalid_json" };
  }

  // ─── O que a plataforma decide sozinha ───────────────────────────────────
  //
  // Revisão de modelo e mudança de estado do número não são mensagens, mas são
  // o tipo de coisa que só se descobre no disparo que não sai — com a campanha
  // montada e o cliente esperando. Vira aviso na Central, onde o humano já
  // procura o que está errado.
  const aviso = avisoDoEvento(payload);
  if (aviso) {
    // O espelho local também: o aviso empurra para olhar, e a tela de modelos
    // precisa mostrar o estado novo. Ver o estado velho depois de ler o aviso é
    // pior que não ter avisado.
    const espelhado = await atualizarEspelhoDoTemplate(admin, input.session.organization_id, payload);
    const desfecho = await registrarAviso(admin, input.session.organization_id, aviso);
    return { ok: true, body: { status: "aviso", kind: aviso.kind, desfecho, espelhado } };
  }

  // ─── Edição e apagamento ────────────────────────────────────────────────
  //
  // Vêm ANTES da ingestão, como os avisos: são correções de linha que já
  // existe, não mensagens novas. Deixá-los cair no `ingest` faria uma edição
  // criar uma conversa do nada, com um texto sem nada antes dele.
  const edicao = parseZernioEdicao(payload);
  if (edicao) {
    const desfecho = await aplicarEdicaoZernio(admin, input.session.organization_id, edicao);
    return { ok: true, body: { status: "edicao", tipo: edicao.tipo, desfecho } };
  }

  const r = await ingestZernioInbound(admin, {
    organizationId: input.session.organization_id,
    channelSessionId: input.session.id,
    payload,
  });
  return { ok: true, body: { ...r } };
}
