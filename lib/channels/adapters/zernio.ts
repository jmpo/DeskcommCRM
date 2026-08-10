/**
 * Adapter do canal intermediado — o transporte de um BSP.
 *
 * Burro como os dois irmãos: traduz formato e nada mais. Se aparecer aqui um
 * `if` sobre janela de 24h, cap diário ou horário, o desenho vazou — essas
 * regras vivem na cadeia `before_send` (doutrina `restricao-de-canal.md`).
 *
 * ─── A diferença que morde quem copia o adapter do canal oficial ────────────
 *
 * Os dois canais existentes DERIVAM o destinatário do contato: um monta o
 * chatId a partir do telefone, o outro usa o E.164 em dígitos. **Este não.**
 * Quem endereça é um id de thread que o intermediário inventa, e que chega pelo
 * webhook. Medido contra a API real, não lido da doc:
 *
 *   POST /v1/inbox/conversations/6a3580f68fcd5b3a5b946bf8/messages  → 200
 *   { success: true, data: { messageId: "wamid.HBgMNTk1...", conversationId } }
 *
 * Por isso `send` exige `providerConversationId`. Sem ele NÃO existe envio de
 * texto livre: o endpoint que aceita telefone exige template e devolve
 * `TEMPLATE_REQUIRED`, que é o caminho de reengajamento, não o de resposta.
 *
 * `resolveRecipient` continua devolvendo o telefone porque é o que identifica o
 * contato para o resto do sistema (dedup de eco, log, abertura de conversa por
 * template) — mas não é o que endereça este envio.
 *
 * ─── Duas coisas medidas na API, não supostas ───────────────────────────────
 *
 * 1. O `messageId` devolvido é um **wamid da Meta**, não um id do
 *    intermediário. É o mesmo espaço de identificador do canal oficial, então
 *    o eco do webhook casa direto e não precisa de `echoExternalIds`.
 * 2. Os dois endpoints devolvem a MESMA forma (`data.messageId`), mas com
 *    status HTTP diferentes — 201 ao abrir a conversa, 200 ao responder nela.
 *    Ler `res.ok` e não o código exato é o que faz os dois caminhos
 *    conviverem.
 */
import { createAdminClient } from "@/lib/supabase/admin";

import { resolveZernioCreds } from "../zernio/credentials";
import { zernioTemplateOps } from "../zernio/templates";
import type { ChannelAdapter, OutboundEnvelope, RecipientInput } from "../types";

/** Só dígitos. `+595 (99) 173-3685` → `595991733685`. */
function toE164Digits(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** `kind` do envelope → o par (attachmentType, voiceNote) que a API espera. */
function attachmentFields(env: OutboundEnvelope): Record<string, unknown> {
  if (!env.media) return {};
  const base: Record<string, unknown> = {
    attachmentUrl: env.media.url,
    ...(env.media.filename ? { attachmentName: env.media.filename } : {}),
    ...(env.media.caption ? { message: env.media.caption } : {}),
  };
  switch (env.kind) {
    case "image":
      return { ...base, attachmentType: "image" };
    case "video":
      return { ...base, attachmentType: "video" };
    case "audio":
      // `voiceNote: true` é o que faz virar BOLHA DE VOZ. A API aceita a flag
      // mas NÃO converte: exige ogg/opus mono, igual ao canal oficial. Mandar
      // mp3 com a flag entrega anexo de música — por isso a capability declara
      // `opus-only`, e a conversão é de quem prepara a mídia, não daqui.
      return { ...base, attachmentType: "audio", voiceNote: true };
    default:
      return { ...base, attachmentType: "file" };
  }
}

export const zernioAdapter: ChannelAdapter = {
  provider: "zernio",

  /**
   * Telefone em dígitos — é o `participantId` da API.
   *
   * Grupo devolve `null`: a API de grupos deste canal é outro recurso
   * (`/wa-groups`), com id próprio, e fingir que um chatId de grupo cabe aqui
   * mandaria a mensagem para o lugar errado.
   */
  resolveRecipient(input: RecipientInput): string | null {
    if (input.isGroup) return null;

    const doIdentity = input.waIdentity?.startsWith("phone:")
      ? input.waIdentity.slice("phone:".length)
      : null;
    const bruto = doIdentity ?? input.phoneNumber ?? null;
    if (bruto) {
      const digitos = toE164Digits(bruto);
      if (digitos.length > 0) return digitos;
    }

    // Sem telefone, devolve o id opaco da plataforma em vez de `null`.
    //
    // Medido em produção: um contato do rollout novo chega com BSUID e o envio
    // parava em `missing_phone_number` — mas para ESTE canal o telefone não
    // endereça nada. Quem endereça é a thread; `to` só existe para o handler
    // saber que há um destinatário conhecido, e um id de plataforma é um
    // destinatário conhecido.
    //
    // Devolver `null` aqui é dizer "não há como falar com esta pessoa", e é
    // falso: acabamos de receber uma mensagem dela.
    const opaco = input.waIdentity?.includes(":")
      ? input.waIdentity.slice(input.waIdentity.indexOf(":") + 1)
      : null;
    return opaco && opaco.length > 0 ? opaco : null;
  },

  /**
   * SEMPRE `true`, e isso não é preguiça: para este canal a pergunta não tem
   * resposta síncrona honesta.
   *
   * A credencial vive na SESSÃO (cifrada no banco), não no ambiente — foi a
   * decisão da 0118, para que duas organizações possam ter contas diferentes na
   * mesma instalação. `isConfigured` é síncrono e não pode consultar o banco,
   * então olhar só o env responde "não configurado" para toda instalação que
   * conectou pela tela.
   *
   * Medido em produção: o handler gravava `queued` com
   * `queued_reason: zernio_not_configured` e NUNCA chamava `send` — a mensagem
   * ficava parada no inbox, sem erro, com o canal conectado e funcionando.
   *
   * O custo de responder `true` é que `send` precisa ser quem desiste — e ele
   * LANÇA em vez de devolver `{externalId: null}`, para o handler gravar
   * `failed` com motivo em vez de um `sent` sem id, que diria "enviado" para
   * algo que nunca saiu.
   */
  isConfigured(): boolean {
    // Sempre `true`, e NÃO `zernioCredsFromEnv() !== null` — que é o que a
    // `main` trazia. Esta é uma divergência DELIBERADA, resolvida aqui a favor
    // do lado do fork, e vale registrar por quê.
    //
    // A preocupação do lado de lá é real e continua valendo: o par
    // `isConfigured() === true  ⟹  há credencial` não pode abrir, porque o
    // handler grava `status:'sent'` quando `send()` não lança. Só que quem
    // fecha esse par mudou de lugar: `send()` LANÇA `zernio_not_configured`
    // quando não acha credencial nem na sessão nem no ambiente. O caso que
    // aquele comentário descreve — "devolve `{externalId: null}` SEM lançar" —
    // não existe mais neste arquivo.
    //
    // E exigir env aqui REINTRODUZ um defeito medido: `resolveZernioCreds`
    // procura primeiro na SESSÃO (conta conectada pela tela) e só depois no
    // ambiente. Uma instalação que conectou pelo botão tem a credencial no
    // banco e nada no `.env` — com a checagem por env, `isConfigured()` diria
    // "não configurado" para um canal que está conectado e funcionando, e toda
    // mensagem ficaria parada em `queued` sem nunca tentar sair. Foi exatamente
    // esse o bug do commit "canal conectado pela tela ficava não configurado".
    //
    // O método é síncrono e não pode consultar o banco; por isso ele não é o
    // lugar de decidir. Quem decide é `send()`, que pode.
    return true;
  },

  async send(envelope: OutboundEnvelope): Promise<{ externalId: string | null }> {
    const admin = createAdminClient();
    const creds = await resolveZernioCreds(admin, envelope.sessionRef);
    // LANÇA, não devolve null: com `isConfigured` sempre true, quem desiste é
    // este ponto — e `{externalId: null}` faria o handler gravar `sent` sem id,
    // dizendo "enviado" para algo que nunca saiu.
    if (!creds) {
      throw new Error(
        "zernio_not_configured: nenhuma credencial para esta conta (nem na sessão, nem no ambiente).",
      );
    }

    // Sem thread conhecida não há envio livre. Falhar aqui, com mensagem que
    // nomeia o motivo, é melhor que montar uma URL com `undefined` e receber um
    // 404 que ninguém consegue interpretar seis meses depois.
    if (!envelope.providerConversationId) {
      throw new Error(
        "zernio_no_conversation: envio livre exige a thread do provider; " +
          "abra a conversa com um template antes (a thread chega no webhook).",
      );
    }

    const url =
      `${creds.baseUrl}/v1/inbox/conversations/` +
      `${encodeURIComponent(envelope.providerConversationId)}/messages`;

    const body: Record<string, unknown> = {
      accountId: creds.accountId,
      ...(envelope.media ? attachmentFields(envelope) : { message: envelope.body ?? "" }),
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const json = (await res.json().catch(() => null)) as {
      success?: boolean;
      data?: { messageId?: string };
      error?: string;
      code?: string;
    } | null;

    if (!res.ok || json?.success === false) {
      // O `code` do provider entra na mensagem quando existe: é ele que
      // distingue "fora da janela" de "número bloqueado" de "conta suspensa", e
      // sem isso o operador vê só "falhou".
      const detalhe = json?.code ? `${json.code}: ${json.error ?? ""}` : (json?.error ?? res.statusText);
      throw new Error(`zernio_send_failed: ${res.status} ${detalhe}`.trim());
    }

    // 201 ao abrir a conversa, 200 ao responder nela — os dois caminhos
    // devolvem a mesma forma, então quem lê não precisa saber qual foi.
    return { externalId: json?.data?.messageId ?? null };
  },

  /** Gestão das definições aprovadas — ver `../zernio/templates.ts`. */
  templates: zernioTemplateOps,

  codes: {
    notConfigured: "zernio_not_configured",
    sendFailed: "zernio_error",
    unknownError: "zernio_unknown",
  },
};
