import type { EventHandler, EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { marcaDaSaida } from "@/lib/branding/saida";
import { createAdminClient } from "@/lib/supabase/admin";
import { montarPayloadDeInbound, truncar } from "./push_payload";
import { enviarPushAoUsuario, enviarPushDaOrg } from "./web_push";
import { vapidPronto } from "./vapid";
import { organizacaoDoPush, pushDoAvisoDaCentral } from "./push-dos-avisos";
import { ganhasDeHoje, inicioDoDia, montarPushDeVenda } from "./push-de-venda";
import { traduzir } from "@/lib/i18n/dicionario";
import type { PushPayload } from "./push_payload";
import { rotuloDoContato, SEM_NOME } from "@/lib/contacts/rotulo-do-contato";

export const WEB_PUSH_INBOUND_KEY = "web-push-inbound.v1";

async function handleInbound(row: EventRow): Promise<HandlerResult> {
  const conversationId =
    (typeof row.payload.conversation_id === "string" ? row.payload.conversation_id : null) ?? null;
  const previewRaw = row.payload.body_preview;
  const preview = typeof previewRaw === "string" && previewRaw.trim() ? previewRaw : "Nova mensagem";
  const type = typeof row.payload.type === "string" ? row.payload.type : "text";
  const body = type === "text" ? preview : "Mídia";

  const marca = await marcaDaSaida(row.organization_id);
  const contactId = typeof row.payload.contact_id === "string" ? row.payload.contact_id : null;
  let contactName: string | null = null;
  let icon: string | null = null;
  if (contactId) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("contacts")
      .select("display_name, name, phone_number, avatar_storage_path, is_anonymized")
      .eq("id", contactId)
      .eq("organization_id", row.organization_id)
      .maybeSingle();
    const c = data as {
      display_name?: string | null;
      name?: string | null;
      phone_number?: string | null;
      avatar_storage_path?: string | null;
      is_anonymized?: boolean | null;
    } | null;
    // A cadeia CANÔNICA, e não a de dois campos remontada aqui: aquela deixava
    // passar o identificador técnico do WhatsApp — a notificação chegaria à tela
    // de bloqueio do celular escrita "Contato 543134@lid". `rotuloDoContato`
    // recusa identificador, cai para o telefone formatado, e só então desiste.
    //
    // (A varredura de `rotulo-do-contato.test.ts` lê o arquivo INTEIRO, comentário
    // incluído — por isso a cadeia proibida não é escrita nem aqui em prosa.)
    //
    // `SEM_NOME` volta a `null` de propósito: o payload já tem um desfecho
    // melhor para "não sei o nome" (`"Nova mensagem"`, em push_payload.ts), e
    // trocá-lo por "Sem nome" pioraria o título sem ninguém pedir.
    const rotulo = rotuloDoContato(c);
    contactName = rotulo === SEM_NOME ? null : rotulo;
    if (c?.avatar_storage_path && !c.is_anonymized) {
      const { data: signed } = await admin.storage
        .from("whatsapp-media")
        .createSignedUrl(c.avatar_storage_path, 300);
      icon = signed?.signedUrl ?? null;
    }
  }
  const payload = montarPayloadDeInbound({
    brand: marca.nome,
    conversationId,
    preview: body,
    contactName,
    icon,
  });
  const { sent } = await enviarPushDaOrg(row.organization_id, payload);
  return { consumer_key: WEB_PUSH_INBOUND_KEY, status: "ok", detail: `sent:${sent}` };
}

async function handleAvisoQuePedeGente(row: EventRow): Promise<HandlerResult> {
  const admin = createAdminClient();
  const id = typeof row.payload.item_id === "string" ? row.payload.item_id : row.entity_id;
  if (!id) return { consumer_key: WEB_PUSH_INBOUND_KEY, status: "skipped", detail: "sem_alvo" };
  const payload = await pushDoAvisoDaCentral(admin, row.organization_id, id);
  if (payload === null) {
    return { consumer_key: WEB_PUSH_INBOUND_KEY, status: "skipped", detail: "aviso_fora_do_celular" };
  }
  const { sent } = await enviarPushDaOrg(row.organization_id, payload);
  return { consumer_key: WEB_PUSH_INBOUND_KEY, status: "ok", detail: `sent:${sent}` };
}

async function leadBits(organizationId: string, leadId: string): Promise<{
  title: string;
  ownerUserId: string | null;
  pipelineId: string | null;
  stageId: string | null;
  valueCents: number | null;
  currency: string | null;
}> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("crm_leads")
    .select("title, owner_user_id, pipeline_id, stage_id, value_cents, currency")
    .eq("id", leadId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  const row = data as {
    title?: string | null;
    owner_user_id?: string | null;
    pipeline_id?: string | null;
    stage_id?: string | null;
    value_cents?: number | null;
    currency?: string | null;
  } | null;
  return {
    title: row?.title?.trim() || "Lead",
    ownerUserId: row?.owner_user_id ?? null,
    pipelineId: row?.pipeline_id ?? null,
    stageId: row?.stage_id ?? null,
    valueCents: row?.value_cents == null ? null : Number(row.value_cents),
    currency: row?.currency ?? null,
  };
}

async function nomeDaEtapa(organizationId: string, stageId: string | null): Promise<string | null> {
  if (!stageId) return null;
  const { data } = await createAdminClient()
    .from("crm_stages")
    .select("name")
    .eq("id", stageId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  return (data as { name?: string | null } | null)?.name ?? null;
}

function hrefDoLead(pipelineId: string | null): string {
  return pipelineId ? `/app/pipelines/${pipelineId}` : "/app/kanban";
}

async function enviarParaUsuario(
  organizationId: string,
  userId: string | null,
  payload: PushPayload,
): Promise<HandlerResult> {
  if (!userId) {
    return { consumer_key: WEB_PUSH_INBOUND_KEY, status: "skipped", detail: "sem_destinatario" };
  }
  const { sent } = await enviarPushAoUsuario(organizationId, userId, payload);
  return { consumer_key: WEB_PUSH_INBOUND_KEY, status: "ok", detail: `sent:${sent}` };
}

export const webPushInboundHandler: EventHandler = {
  key: WEB_PUSH_INBOUND_KEY,
  events: [
    "message.received",
    "lead.assigned",
    "lead.won",
    "lead.lost",
    "user.mentioned",
    // Os avisos que pedem gente — ver `./push-dos-avisos.ts`.
    "central.aviso_criado",
  ],
  async handle(row): Promise<HandlerResult> {
    if (!vapidPronto()) {
      return { consumer_key: WEB_PUSH_INBOUND_KEY, status: "skipped", detail: "vapid_ausente" };
    }
    if (row.event_type === "message.received") return handleInbound(row);
    if (row.event_type === "central.aviso_criado") return handleAvisoQuePedeGente(row);

    // O texto sai no idioma da ORGANIZAÇÃO: ninguém está logado quando o push sai.
    const { idioma, fuso } = await organizacaoDoPush(createAdminClient(), row.organization_id);

    if (row.event_type === "user.mentioned") {
      const toUserId = typeof row.payload.to_user_id === "string" ? row.payload.to_user_id : null;
      const conversationId =
        typeof row.payload.conversation_id === "string" ? row.payload.conversation_id : null;
      const titulo = traduzir("Você foi mencionado", idioma);
      const preview = typeof row.payload.body_preview === "string" ? row.payload.body_preview : titulo;
      return enviarParaUsuario(row.organization_id, toUserId, {
        title: titulo,
        body: truncar(preview),
        tag: conversationId ? `mention:${conversationId}` : "mention",
        href: conversationId ? `/app/inbox/${conversationId}` : "/app/inbox",
      });
    }

    const leadId =
      (typeof row.payload.lead_id === "string" ? row.payload.lead_id : null) ??
      (typeof row.entity_id === "string" ? row.entity_id : null);
    if (!leadId) {
      return { consumer_key: WEB_PUSH_INBOUND_KEY, status: "skipped", detail: "sem_lead" };
    }
    const lead = await leadBits(row.organization_id, leadId);
    const href = hrefDoLead(lead.pipelineId);

    if (row.event_type === "lead.assigned") {
      const toUserId = typeof row.payload.to_user_id === "string" ? row.payload.to_user_id : lead.ownerUserId;
      return enviarParaUsuario(row.organization_id, toUserId, {
        title: traduzir("Lead atribuído a você", idioma),
        body: truncar(lead.title),
        tag: `lead-assigned:${leadId}`,
        href,
      });
    }
    if (row.event_type === "lead.won") {
      // Venda ganha é notícia para a EQUIPE quando o negócio não tem dono: numa
      // operação atendida pela IA ninguém é dono (medido: 0 de 243), e mandar
      // só "ao dono" era não mandar a ninguém. Com dono, segue indo só a ele.
      const valor =
        lead.valueCents && lead.currency ? { cents: lead.valueCents, moeda: lead.currency } : null;
      const payload = montarPushDeVenda({
        momento: "ganha",
        valor,
        etapa: await nomeDaEtapa(row.organization_id, lead.stageId),
        hoje: await ganhasDeHoje(createAdminClient(), row.organization_id, valor?.moeda ?? null, inicioDoDia(new Date(), fuso)),
        idioma,
        tag: `lead-won:${leadId}`,
        href,
      });
      if (lead.ownerUserId) return enviarParaUsuario(row.organization_id, lead.ownerUserId, payload);
      const { sent } = await enviarPushDaOrg(row.organization_id, payload);
      return { consumer_key: WEB_PUSH_INBOUND_KEY, status: "ok", detail: `sent:${sent}` };
    }
    return enviarParaUsuario(row.organization_id, lead.ownerUserId, {
      title: traduzir("Lead perdido", idioma),
      body: truncar(lead.title),
      tag: `lead-lost:${leadId}`,
      href,
    });
  },
};
