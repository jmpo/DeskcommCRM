/**
 * Push para o CELULAR dos avisos que pedem gente.
 *
 * O som da Central (`sons-da-org.ts`) só toca com o CRM aberto na tela. Quem
 * vende pelo WhatsApp passa o dia com o CRM fechado no bolso — medido: um caso
 * aberto às 23h42 ("cliente pergunta a transportadora") esperou sem ninguém
 * saber. Quatro momentos vão ao celular:
 *
 *   - a IA passou a conversa para uma pessoa (aviso `handoff`);
 *   - um negócio entrou numa etapa que avisa — a venda confirmada (aviso
 *     `other` apontando para um negócio);
 *   - a IA pediu ajuda à equipe sem sair da conversa (caso aberto, que vira
 *     aviso na Central em `lib/escalacao/caso-na-central.handler.ts`);
 *   - a IA ficou sem saldo no provedor e as respostas estão esperando a
 *     recarga (`lib/agent-engine/queue/espera-de-saldo.ts`).
 *
 * São os MESMOS que têm som próprio: a regra de quais avisos importam é uma só
 * (`somDoAviso`). Todos chegam pelo barramento como `central.aviso_criado`
 * (migration 0418).
 *
 * O texto sai no idioma da ORGANIZAÇÃO — ninguém está logado quando o push sai.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { traduzir } from "@/lib/i18n/dicionario";
import { normalizarIdioma, type Idioma } from "@/lib/i18n/idiomas";

import { etapaDoTituloDoAviso, inicioDoDia, montarPushDeVenda, novasDeHoje } from "./push-de-venda";
import { truncar, type PushPayload } from "./push_payload";
import { somDoAviso } from "./sons-da-org";

/** Idioma e fuso da organização — o push sai sem ninguém logado. */
export async function organizacaoDoPush(
  admin: SupabaseClient,
  orgId: string,
): Promise<{ idioma: Idioma; fuso: string | null }> {
  const { data } = await admin.from("organizations").select("locale, timezone").eq("id", orgId).maybeSingle();
  const org = data as { locale?: string | null; timezone?: string | null } | null;
  return { idioma: normalizarIdioma(org?.locale ?? null), fuso: org?.timezone ?? null };
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
  const { idioma, fuso } = await organizacaoDoPush(admin, orgId);

  // Caso aberto: o aviso guarda texto genérico (LGPD — ver o handler); o
  // título que a IA escreveu vai no push, que não fica guardado.
  if (item.kind === "other" && item.ref_kind === "agent_case" && item.ref_id) {
    const { data: caso } = await admin
      .from("agent_cases")
      .select("title")
      .eq("organization_id", orgId)
      .eq("id", item.ref_id)
      .maybeSingle();
    const titulo = (caso as { title?: string | null } | null)?.title?.trim();
    return {
      title: traduzir("A IA pediu ajuda à equipe", idioma),
      body: truncar(titulo || traduzir("Abra os casos para responder.", idioma)),
      tag: `aviso:${item.id}`,
      href: `/app/ai/cases?caso=${item.ref_id}`,
    };
  }

  // Sem saldo no provedor: o título já nasceu no idioma da organização
  // (`espera-de-saldo.ts`); o corpo diz o remédio, que fica fora do CRM.
  if (item.kind === "other" && item.ref_kind === "ai_provider_credential") {
    return {
      title: truncar(item.title),
      body: traduzir("Recarregue o saldo na conta do provedor: as respostas saem sozinhas quando ele voltar.", idioma),
      tag: `aviso:${item.id}`,
      href: "/app/ai/credentials",
    };
  }

  if (som === "pessoa") {
    return {
      title: traduzir("A IA passou uma conversa para a equipe", idioma),
      body: traduzir("Abra a conversa para responder o cliente.", idioma),
      tag: `aviso:${item.id}`,
      href: item.ref_kind === "conversation" && item.ref_id ? `/app/inbox?id=${item.ref_id}` : "/app/ai/inbox",
    };
  }

  // Venda: o valor no título e a soma do dia no corpo — ver
  // `./push-de-venda.ts`, inclusive por que o nome do cliente NÃO vai.
  let href = "/app/ai/inbox";
  let valor: { cents: number; moeda: string } | null = null;
  if (item.ref_kind === "lead" && item.ref_id) {
    const { data: lead } = await admin
      .from("crm_leads")
      .select("pipeline_id, value_cents, currency")
      .eq("organization_id", orgId)
      .eq("id", item.ref_id)
      .maybeSingle();
    const l = lead as { pipeline_id?: string | null; value_cents?: number | null; currency?: string | null } | null;
    if (l?.pipeline_id) href = `/app/pipelines/${l.pipeline_id}`;
    if (l?.value_cents && l.currency) valor = { cents: Number(l.value_cents), moeda: l.currency };
  }
  const hoje = await novasDeHoje(admin, orgId, item.title, valor?.moeda ?? null, inicioDoDia(new Date(), fuso));
  return montarPushDeVenda({
    momento: "nova",
    valor,
    etapa: etapaDoTituloDoAviso(item.title),
    hoje,
    idioma,
    tag: `aviso:${item.id}`,
    href,
  });
}
