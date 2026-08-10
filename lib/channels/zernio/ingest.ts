/**
 * Ingestão do canal intermediado: webhook → contato, conversa, mensagem.
 *
 * A leitura do payload é do módulo puro ao lado (`./webhook.ts`); aqui moram os
 * EFEITOS. A separação não é estética: o que decide (isto é mensagem? de quem?)
 * dá para provar sem banco, e o que escreve fica pequeno o bastante para caber
 * na cabeça.
 *
 * ─── O que este módulo existe para gravar ───────────────────────────────────
 *
 * `conversations.provider_conversation_id`. Sem ele o envio livre não funciona,
 * porque o endereço deste canal não se deriva do contato — e é AQUI, e só aqui,
 * que ele chega. Uma ingestão que grava a mensagem e esquece a thread deixa o
 * inbox mostrando a conversa e o operador sem conseguir responder.
 *
 * ─── Idempotência ───────────────────────────────────────────────────────────
 *
 * O provider reentrega quando não recebe 200 — e reentrega o MESMO evento. A
 * chave é `(organization_id, external_id)` no INSERT da mensagem, com captura
 * do `23505`, exatamente como o canal por QR faz. Sem isso, uma retentativa
 * duplica a mensagem no inbox do cliente.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

import { parseZernioInbound, type ZernioIdentity, type ZernioInboundMessage } from "./webhook";

export interface ZernioIngestResult {
  status: "ingested" | "duplicate" | "ignored" | "unknown_account";
  conversationId?: string;
  messageId?: string;
  /** Por que foi ignorado — vai para o log, e é o que se lê quando "sumiu". */
  reason?: string;
}

/**
 * Identidade → `wa_identity`, o mesmo vocabulário que o canal por QR já usa
 * (`phone:+E164` | `lid:<digits>`).
 *
 * O BSUID vira `lid:` de propósito: é a mesma NATUREZA de identificador — um id
 * opaco da plataforma que não é telefone — e reusar o prefixo faz o contato ser
 * o mesmo contato quando a pessoa aparece pelos dois canais. Inventar um
 * terceiro prefixo criaria dois contatos para uma pessoa só.
 */
export function waIdentityFrom(identity: ZernioIdentity): string | null {
  if (!identity.anchor) return null;
  return identity.anchor.kind === "phone"
    ? `phone:${identity.anchor.value}`
    : `lid:${identity.anchor.value}`;
}

/**
 * Grava um evento já lido e autenticado.
 *
 * Recebe o `channel_session_id` resolvido pela rota (que é quem conhece o
 * token): este módulo não descobre de quem é o webhook, só escreve o que já se
 * sabe de quem é.
 */
export async function ingestZernioInbound(
  admin: SupabaseClient,
  input: { organizationId: string; channelSessionId: string; payload: unknown },
): Promise<ZernioIngestResult> {
  const msg = parseZernioInbound(input.payload);
  if (!msg) return { status: "ignored", reason: "evento_sem_interesse" };

  // Evento de DESFECHO: a mensagem já existe (ou nem é nossa). Só atualiza o
  // status — inserir aqui criaria uma segunda linha para a mesma mensagem, uma
  // por transição de estado.
  if (msg.kind === "status") {
    const { data } = await admin
      .from("messages")
      .update({
        status: msg.status,
        ...(msg.errorReason ? { error_message: msg.errorReason, error_code: "zernio_error" } : {}),
      })
      .eq("organization_id", input.organizationId)
      .eq("external_id", msg.externalId)
      // Não rebaixa: `read` chegando depois de `delivered` é progresso, mas um
      // `delivered` atrasado depois de `read` voltaria o tique para trás. A
      // ordem de entrega do webhook não é garantida.
      .not("status", "in", "(read)")
      .select("id");
    const afetadas = (data ?? []).length;
    return afetadas > 0
      ? { status: "ingested", reason: `status_${msg.status}` }
      : { status: "ignored", reason: "mensagem_desconhecida" };
  }

  // ─── A THREAD é a prova de identidade, e vem ANTES da âncora ─────────────
  //
  // O provider dá um id próprio à conversa. Se já existe uma com esse id, é a
  // MESMA pessoa — ele acabou de dizer isso. Perguntar de novo "quem é?" pela
  // âncora abre espaço para divergência, e ela apareceu em produção:
  //
  //   contato A: phone:+595982857447        ← criado pelo evento de SAÍDA
  //   contato B: lid:PY.1383674957068636    ← criado pelo evento de ENTRADA
  //
  // Mesma pessoa, dois contatos, duas conversas — porque a entrada traz o BSUID
  // (âncora preferida) e a saída só traz o telefone do participante. Resolver
  // pela thread primeiro fecha isso na origem, e de quebra deixa a ingestão
  // imune a qualquer identidade nova que o provider invente depois.
  const existente = await conversaPelaThread(admin, input.organizationId, msg.conversationId);
  if (existente) {
    const inseridaNaExistente = await insertMessage(admin, {
      organizationId: input.organizationId,
      conversationId: existente.id,
      contactId: existente.contact_id,
      channelSessionId: input.channelSessionId,
      msg,
    });
    // O telefone pode chegar agora e faltar no contato — vale gravar.
    if (msg.identity.phone) {
      await admin
        .from("contacts")
        .update({ phone_number: msg.identity.phone })
        .eq("id", existente.contact_id)
        .is("phone_number", null);
    }
    if (inseridaNaExistente !== "duplicate") {
      await marcarConversa(admin, existente.id, msg);
    }
    return inseridaNaExistente === "duplicate"
      ? { status: "duplicate", conversationId: existente.id }
      : { status: "ingested", conversationId: existente.id, messageId: inseridaNaExistente };
  }

  const identity = waIdentityFrom(msg.identity);
  if (!identity) {
    // Evento sem âncora utilizável. Recusar é o certo: criar contato anônimo
    // faria a próxima mensagem da MESMA pessoa virar um segundo contato.
    return { status: "ignored", reason: "sem_identidade_utilizavel" };
  }

  const contactId = await upsertContact(admin, input.organizationId, msg, identity);
  if (!contactId) return { status: "ignored", reason: "contato_nao_resolvido" };

  const conversationId = await upsertConversation(admin, {
    organizationId: input.organizationId,
    contactId,
    channelSessionId: input.channelSessionId,
    providerConversationId: msg.conversationId,
  });
  if (!conversationId) return { status: "ignored", reason: "conversa_nao_resolvida" };

  const inserted = await insertMessage(admin, {
    organizationId: input.organizationId,
    conversationId,
    contactId,
    channelSessionId: input.channelSessionId,
    msg,
  });

  if (inserted === "duplicate") return { status: "duplicate", conversationId };

  await marcarConversa(admin, conversationId, msg);
  return { status: "ingested", conversationId, messageId: inserted };
}

/**
 * Carimba a conversa com o que acabou de chegar.
 *
 * ─── O que faltava, e o que isso quebrava ──────────────────────────────────
 *
 * Esta chamada não existia neste canal. Os outros dois a fazem; eu escrevi este
 * ingest e a omiti. Medido em produção: conversa com CINCO mensagens do cliente
 * e `last_inbound_at` NULL.
 *
 * O estrago não é cosmético, porque `last_inbound_at` é a fonte da janela de
 * 24h:
 *
 *   - o selo dizia "o cliente nunca escreveu" numa conversa em que ele acabara
 *     de escrever, e o composer barrava o envio por um motivo falso;
 *   - o guardrail do agente calcula a janela do MESMO campo, então o assistente
 *     tratava toda conversa deste canal como fechada e nunca respondia texto
 *     livre — inclusive dentro da janela;
 *   - `unread_count_for_assignee` nunca subia, então o contador de não lidas da
 *     lista ficava em zero mesmo com mensagem nova.
 *
 * Três sintomas sem relação aparente, uma linha ausente.
 *
 * Não carimba no `duplicate`: a reentrega é a MESMA mensagem, e somar de novo
 * inflaria o contador de não lidas a cada reenvio do provider.
 */
async function marcarConversa(
  admin: SupabaseClient,
  conversationId: string,
  msg: ZernioInboundMessage,
): Promise<void> {
  const { error } = await admin.rpc("fn_mark_conversation_message" as never, {
    p_conv: conversationId,
    p_direction: msg.direction,
    p_preview: (msg.text ?? "").slice(0, 200),
    // `sentAt` do provider quando existe: a ordem da lista e o cálculo da janela
    // têm que usar a hora em que o cliente ESCREVEU, não a hora em que o webhook
    // chegou — numa reentrega atrasada as duas diferem por horas.
    p_at: msg.sentAt ?? new Date().toISOString(),
  } as never);
  // Não derruba a ingestão: a mensagem já está gravada, e perder o carimbo é
  // pior que perder a mensagem — mas MUITO melhor que devolver 500 e fazer o
  // provider reenviar tudo de novo.
  if (error) {
    logger.warn("[zernio] carimbo da conversa falhou", {
      conversationId,
      detail: error.message,
    });
  }
}

/** A conversa que o provider já associou a esta thread, se houver. */
async function conversaPelaThread(
  admin: SupabaseClient,
  organizationId: string,
  providerConversationId: string,
): Promise<{ id: string; contact_id: string } | null> {
  const { data } = await admin
    .from("conversations")
    .select("id, contact_id")
    .eq("organization_id", organizationId)
    .eq("provider_conversation_id", providerConversationId)
    .maybeSingle();
  const row = data as { id: string; contact_id: string | null } | null;
  return row?.contact_id ? { id: row.id, contact_id: row.contact_id } : null;
}

async function upsertContact(
  admin: SupabaseClient,
  organizationId: string,
  msg: ZernioInboundMessage,
  identity: string,
): Promise<string | null> {
  const kind = identity.startsWith("phone:") ? "phone" : "lid";
  const valor = identity.slice(identity.indexOf(":") + 1);

  // Reusa a RPC do canal por QR: ela já resolve a corrida de dois webhooks
  // simultâneos numa transação, e escrever um segundo upsert seria criar um
  // segundo lugar onde a mesma corrida pode voltar.
  const { data, error } = await admin.rpc("fn_upsert_wa_contact", {
    p_org: organizationId,
    p_kind: kind,
    p_phone: kind === "phone" ? valor : null,
    p_lid: kind === "lid" ? valor : null,
    p_chat_id: msg.conversationId,
    p_notify: msg.identity.displayName ?? msg.identity.username ?? null,
  });
  if (error) return null;
  const contactId = (data as string) ?? null;
  if (!contactId) return null;

  // O telefone entra MESMO quando a âncora é o id opaco.
  //
  // A âncora certa é o BSUID (sobrevive a trocar de número), mas o payload
  // traz os DOIS — e a RPC só grava `phone_number` quando o `kind` é phone.
  // Descartá-lo custou caro: o contato ficava sem número, o envio parava em
  // `missing_phone_number`, e a tela não tinha o que mostrar ao atendente que
  // precisa saber com quem está falando.
  //
  // `is null` no filtro: só preenche o que está vazio. Sobrescrever apagaria
  // uma correção feita à mão na tela por um valor que a plataforma pode mandar
  // diferente entre eventos.
  if (msg.identity.phone) {
    await admin
      .from("contacts")
      .update({ phone_number: msg.identity.phone })
      .eq("id", contactId)
      .is("phone_number", null);
  }

  return contactId;
}

async function upsertConversation(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    contactId: string;
    channelSessionId: string;
    providerConversationId: string;
  },
): Promise<string | null> {
  const { data, error } = await admin.rpc("fn_upsert_wa_conversation", {
    p_org: input.organizationId,
    p_contact: input.contactId,
    p_session: input.channelSessionId,
  });
  if (error || !data) return null;
  const conversationId = data as string;

  // A thread do provider, que é o motivo deste módulo existir.
  //
  // Gravada SEMPRE, sem condição. A primeira versão tinha um
  // `.neq("provider_conversation_id", ...)` para "só escrever se mudou" — e
  // isso QUEBROU exatamente o que este módulo existe para fazer:
  //
  //   em SQL, `NULL <> 'valor'` é NULL, não TRUE.
  //
  // Conversa recém-criada tem a coluna NULL, então o `neq` nunca a alcançava e
  // o update não pegava linha nenhuma. Medido em produção: o webhook respondia
  // `{"status":"ingested"}` e a coluna ficava `null` — a mensagem aparecia no
  // inbox e responder era impossível.
  //
  // O teste com dublê não pegou porque o fake tratava `.neq()` como no-op:
  // afirmava que o `update` foi CHAMADO com o payload certo, que era verdade, e
  // não que ele tivesse casado alguma linha. Escrever sempre é uma escrita a
  // mais por mensagem e zero condições sutis para errar.
  await admin
    .from("conversations")
    .update({ provider_conversation_id: input.providerConversationId })
    .eq("id", conversationId);

  return conversationId;
}

async function insertMessage(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    conversationId: string;
    contactId: string;
    channelSessionId: string;
    msg: ZernioInboundMessage;
  },
): Promise<string | "duplicate"> {
  const { msg } = input;
  const temAnexo = msg.attachments.length > 0;
  const primeiro = msg.attachments[0];

  const { data, error } = await admin
    .from("messages")
    .insert({
      organization_id: input.organizationId,
      conversation_id: input.conversationId,
      contact_id: input.contactId,
      channel_session_id: input.channelSessionId,
      external_id: msg.externalId,
      // ─── Por que a SAÍDA também entra ──────────────────────────────────
      //
      // A primeira versão descartava tudo que era `outgoing`, para não duplicar
      // os envios do próprio CRM. O efeito colateral custou caro: mensagem
      // mandada do celular do operador, ou por outra plataforma ligada à mesma
      // conta, NUNCA aparecia — e o histórico do cliente ficava pela metade sem
      // nada avisando.
      //
      // A duplicação que se temia já estava resolvida por outro lado: o
      // `unique (organization_id, external_id)` devolve 23505 no eco do nosso
      // próprio envio, e o chamador lê isso como "duplicate", não como erro.
      direction: msg.direction,
      status: msg.direction === "outbound" ? (msg.status ?? "sent") : "delivered",
      type: temAnexo ? tipoDoAnexo(primeiro?.type) : "text",
      body: msg.text,
      // A URL do anexo NÃO é pública: é endpoint autenticado do provider, e a
      // plataforma descarta a mídia depois de um tempo. Guardar a URL aqui é
      // ponteiro para algo que expira — quem for baixar usa
      // `zernioMediaFetchInit` e persiste os bytes.
      metadata: temAnexo ? { provider_attachments: msg.attachments } : {},
      ...(msg.sentAt ? { sent_at: msg.sentAt } : {}),
    })
    .select("id")
    .maybeSingle();

  // 23505 = unique violation em (organization_id, external_id). É o desfecho
  // ESPERADO de uma reentrega, não um erro: o provider reenvia quando não
  // recebe 200, e tratar isto como falha faria a rota devolver 500 e ele
  // reenviar de novo, para sempre.
  if (error?.code === "23505") return "duplicate";
  if (error || !data) throw new Error(`zernio_ingest_insert_failed: ${error?.message ?? "sem id"}`);

  return (data as { id: string }).id;
}

/** Tipo do anexo do provider → vocabulário de `messages.type`. */
function tipoDoAnexo(tipo: string | undefined): string {
  switch (tipo) {
    case "image":
      return "image";
    case "video":
      return "video";
    case "audio":
      return "audio";
    case "sticker":
      return "sticker";
    default:
      return "document";
  }
}

/**
 * Aplica a edição ou o apagamento numa mensagem que JÁ existe.
 *
 * Não cria linha: uma edição de mensagem que nunca chegou não deve inventar uma
 * conversa do nada, com um texto sem nada antes dele. Devolve `"sem_alvo"`, que
 * é informação — não erro —, e a rota segue respondendo 200.
 *
 * O corpo é sobrescrito e o original não é guardado: o que o CRM mostra tem que
 * ser o que o cliente vê agora. E a linha apagada continua existindo, com
 * `revoked_at`: removê-la levaria junto o contexto das vizinhas e o histórico
 * de quem atendeu.
 */
export async function aplicarEdicaoZernio(
  admin: SupabaseClient,
  organizationId: string,
  edicao: { externalId: string; tipo: "edited" | "deleted"; body: string | null },
): Promise<"aplicado" | "sem_alvo"> {
  const agora = new Date().toISOString();
  const patch =
    edicao.tipo === "deleted"
      ? { revoked_at: agora }
      : // Edição sem corpo novo não zera o texto: seria trocar a versão velha
        // (útil) por um vazio (inútil), e o evento sem corpo é justamente o
        // caso em que não sabemos o texto novo.
        edicao.body !== null
        ? { body: edicao.body, edited_at: agora }
        : { edited_at: agora };

  const { data } = await admin
    .from("messages")
    .update(patch)
    .eq("organization_id", organizationId)
    .eq("external_id", edicao.externalId)
    .select("id");

  return (data ?? []).length > 0 ? "aplicado" : "sem_alvo";
}
