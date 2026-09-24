/**
 * Push para o CELULAR dos avisos que pedem gente.
 *
 * O som da Central (`sons-da-org.ts`) só toca com o CRM aberto na tela. Quem
 * vende pelo WhatsApp passa o dia com o CRM fechado no bolso — medido: um caso
 * aberto às 23h42 ("cliente pergunta a transportadora") esperou sem ninguém
 * saber. Três momentos vão ao celular:
 *
 *   - a IA passou a conversa para uma pessoa (aviso `handoff`);
 *   - um negócio entrou numa etapa que avisa — a venda confirmada (aviso
 *     `other` apontando para um negócio);
 *   - a IA pediu ajuda à equipe sem sair da conversa (caso aberto).
 *
 * Os dois primeiros são os MESMOS que têm som próprio: a regra de quais avisos
 * importam é uma só (`somDoAviso`). Os avisos chegam pelo barramento
 * (`central.aviso_criado`, migration 0399; `ai.case_opened`, migration 0148).
 *
 * O texto sai no idioma da ORGANIZAÇÃO — ninguém está logado quando o push sai.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { traduzir } from "@/lib/i18n/dicionario";
import { normalizarIdioma, type Idioma } from "@/lib/i18n/idiomas";

import { truncar, type PushPayload } from "./push_payload";
import { somDoAviso } from "./sons-da-org";

async function idiomaDaOrganizacao(admin: SupabaseClient, orgId: string): Promise<Idioma> {
  const { data } = await admin.from("organizations").select("locale").eq("id", orgId).maybeSingle();
  return normalizarIdioma((data as { locale?: string | null } | null)?.locale ?? null);
}

/**
 * O push de um aviso da Central, ou `null` quando o aviso não vai ao celular.
 * Lê o aviso do banco em vez de confiar no payload: o evento carrega só o id.
 */
export async function pushDoAvisoDaCentral(
  admin: SupabaseClient,
  orgId: string,
  itemId: string,
): Promise<PushPayload | null> {
  const { data } = await admin
    .from("agent_inbox_items")
    .select("id, kind, ref_kind, ref_id, title")
    .eq("organization_id", orgId)
    .eq("id", itemId)
    .maybeSingle();
  const item = data as { id: string; kind: string; ref_kind: string | null; ref_id: string | null; title: string } | null;
  if (!item) return null;

  const som = somDoAviso(item);
  if (som === null) return null;
  const idioma = await idiomaDaOrganizacao(admin, orgId);

  if (som === "pessoa") {
    return {
      title: traduzir("A IA passou uma conversa para a equipe", idioma),
      body: traduzir("Abra a conversa para responder o cliente.", idioma),
      tag: `aviso:${item.id}`,
      href: item.ref_kind === "conversation" && item.ref_id ? `/app/inbox?id=${item.ref_id}` : "/app/ai/inbox",
    };
  }

  // Venda: o título do aviso já nasceu no idioma da organização
  // (`aviso-de-etapa.handler.ts`) e diz a etapa; o corpo diz qual negócio.
  let corpo = "";
  let href = "/app/ai/inbox";
  if (item.ref_kind === "lead" && item.ref_id) {
    const { data: lead } = await admin
      .from("crm_leads")
      .select("title, pipeline_id")
      .eq("organization_id", orgId)
      .eq("id", item.ref_id)
      .maybeSingle();
    const l = lead as { title?: string | null; pipeline_id?: string | null } | null;
    corpo = l?.title?.trim() ?? "";
    if (l?.pipeline_id) href = `/app/pipelines/${l.pipeline_id}`;
  }
  return { title: truncar(item.title), body: truncar(corpo), tag: `aviso:${item.id}`, href };
}

/** O push de um caso aberto pela IA, ou `null` quando o caso não existe mais. */
export async function pushDoCasoAberto(
  admin: SupabaseClient,
  orgId: string,
  caseId: string,
): Promise<PushPayload | null> {
  const { data } = await admin
    .from("agent_cases")
    .select("id, title, status")
    .eq("organization_id", orgId)
    .eq("id", caseId)
    .maybeSingle();
  const caso = data as { id: string; title: string | null; status: string } | null;
  // Resolvido antes de o evento ser drenado: avisar seria ruído.
  if (!caso || (caso.status !== "awaiting_human" && caso.status !== "escalated")) return null;
  const idioma = await idiomaDaOrganizacao(admin, orgId);
  return {
    title: traduzir("A IA pediu ajuda à equipe", idioma),
    body: truncar(caso.title?.trim() || traduzir("Abra os casos para responder.", idioma)),
    tag: `caso:${caso.id}`,
    href: "/app/ai/cases",
  };
}
