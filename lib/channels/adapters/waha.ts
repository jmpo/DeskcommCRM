/**
 * Adapter WAHA — o primeiro `ChannelAdapter`, e de propósito o mais burro
 * possível: cada método delega ao `lib/waha/*` que já existe e já é testado.
 * Reimplementar aqui é como se perde paridade de comportamento sem perceber.
 *
 * Nenhuma regra de negócio mora neste arquivo (ver `ChannelAdapter` em ../types).
 */
import { getWahaClient } from "@/lib/waha/client";
import { wahaSendPlanFor } from "@/lib/waha/media-send";
import { parseWahaMessageId } from "@/lib/waha/message-id";
import { resolveWahaChatId } from "@/lib/waha/send";
import type { ChannelAdapter, OutboundEnvelope, RecipientInput } from "../types";

export const wahaAdapter: ChannelAdapter = {
  provider: "waha",

  resolveRecipient(input: RecipientInput): string | null {
    return resolveWahaChatId(input);
  },

  // Mesmo pre-check que o handler já fazia com `getWahaClient() !== null`,
  // movido para trás do seam. `getWahaClient` lê o env a cada chamada (não
  // memoiza), então o estado aqui é sempre o corrente.
  isConfigured(): boolean {
    return getWahaClient() !== null;
  },

  // `unknownError` é gravado em `messages.error_message` quando o throw não é
  // um `Error` — valor observável no banco, por isso ele ATRAVESSA o seam com o
  // literal intacto em vez de virar uma string neutra.
  codes: {
    notConfigured: "waha_not_configured",
    sendFailed: "waha_error",
    unknownError: "waha_unknown",
  },

  // A URL vem assinada pelo CDN do WhatsApp e EXPIRA (~9 dias, medido). Quem
  // chama baixa e persiste; guardar a URL faria a foto sumir sozinha depois.
  async fetchProfilePictureUrl(input: {
    sessionRef: string;
    recipient: string;
  }): Promise<string | null> {
    const client = getWahaClient();
    if (!client) return null;
    return client.getProfilePictureUrl(input.sessionRef, input.recipient);
  },

  async send(envelope: OutboundEnvelope): Promise<{ externalId: string | null }> {
    const client = getWahaClient();
    // Sem env de WAHA o comportamento atual é NOOP, não erro: a UI mostra o
    // banner de "container não está no ar". Transformar em exceção mudaria o
    // comportamento visível — proibido nas Fases 0–2.
    if (!client) return { externalId: null };

    const res = envelope.media
      ? await client.sendMedia(
          envelope.sessionRef,
          envelope.to,
          wahaSendPlanFor(envelope.kind, envelope.media),
        )
      : await client.sendMessage(envelope.sessionRef, envelope.to, envelope.body ?? "");

    return { externalId: parseWahaMessageId(res) };
  },
};
