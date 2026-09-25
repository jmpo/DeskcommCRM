/**
 * O PUSH DE VENDA — o que chega ao celular quando entra dinheiro.
 *
 * ─── O que havia ────────────────────────────────────────────────────────────
 *
 * A venda confirmada chegava como "Negocio entró en «Pedido confirmado»" com o
 * nome do cliente embaixo; o ganho, como "Lead ganho", em português, só para o
 * DONO do negócio — e numa operação atendida pela IA ninguém é dono (medido:
 * 0 de 243 negócios com `owner_user_id`), então o ganho não chegava a ninguém.
 * Nenhum dos dois dizia o VALOR.
 *
 * ─── O que passa a chegar ───────────────────────────────────────────────────
 *
 *     🎉 ¡Nueva venta! Gs. 125.000
 *     Pedido confirmado · Hoy: 3 ventas (Gs. 375.000)
 *
 * O valor no título, porque é o que se lê na tela bloqueada sem abrir nada; a
 * soma do dia no corpo, porque é o número que dá vontade de mostrar.
 *
 * ─── Sem o nome do cliente, de propósito ────────────────────────────────────
 *
 * Esta notificação é feita para ser PRINTADA e compartilhada — é a vitrine da
 * marca de quem vende o CRM. Um print com o nome do comprador seria dado
 * pessoal espalhado em grupo de WhatsApp (LGPD). Quem precisa do nome toca na
 * notificação e abre o negócio, com a permissão que tem.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { instanteDe, partesNoFuso } from "@/lib/agenda/fuso";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";
import { formatValorDoNegocio } from "@/lib/money";
import { fusoUtilizavel } from "@/lib/tempo/fusos";

import { truncar, type PushPayload } from "./push_payload";

export type MomentoDaVenda = "nova" | "ganha";

/** O ícone do app com a marca da instalação (`app/icone/[lado]/route.tsx`). */
export const ICONE_DA_MARCA = "/icone/192";

export type ResumoDoDia = { readonly quantidade: number; readonly totalCents: number };

export type Valor = { readonly cents: number; readonly moeda: string };

export function montarPushDeVenda(input: {
  momento: MomentoDaVenda;
  valor: Valor | null;
  etapa: string | null;
  hoje: ResumoDoDia | null;
  idioma: Idioma;
  tag: string;
  href: string;
}): PushPayload {
  const { idioma, valor } = input;
  const temValor = valor !== null && valor.cents > 0;
  const chamada =
    input.momento === "nova"
      ? `🎉 ${traduzir("Nova venda!", idioma)}`
      : `💰 ${traduzir("Venda ganha!", idioma)}`;
  const title = temValor ? `${chamada} ${formatValorDoNegocio(valor.cents, valor.moeda)}` : chamada;

  const partes: string[] = [];
  if (input.etapa?.trim()) partes.push(input.etapa.trim());
  const hoje = input.hoje;
  if (hoje && hoje.quantidade > 0) {
    const vendas =
      hoje.quantidade === 1 ? traduzir("1 venda", idioma) : `${hoje.quantidade} ${traduzir("vendas", idioma)}`;
    const total =
      valor && hoje.totalCents > 0 ? ` (${formatValorDoNegocio(hoje.totalCents, valor.moeda)})` : "";
    partes.push(`${traduzir("Hoje", idioma)}: ${vendas}${total}`);
  }

  // `icon` é o ícone grande da notificação no Android — o logo da marca, no
  // lugar do avatar de contato que as mensagens usam. O iOS usa o ícone do app.
  return {
    title: truncar(title),
    body: truncar(partes.join(" · ")),
    tag: input.tag,
    href: input.href,
    icon: ICONE_DA_MARCA,
  };
}

/** A etapa escrita no título do aviso — `Negócio entrou em «X»`, em qualquer idioma. */
export function etapaDoTituloDoAviso(titulo: string): string | null {
  const m = /«([^»]+)»/.exec(titulo);
  return m?.[1]?.trim() || null;
}

/** Meia-noite de hoje, no fuso da organização. */
export function inicioDoDia(agora: Date, fuso: string | null | undefined): Date {
  const tz = fusoUtilizavel(fuso);
  const p = partesNoFuso(agora, tz);
  return instanteDe({ ano: p.ano, mes: p.mes, dia: p.dia, hora: 0, minuto: 0, segundo: 0 }, tz);
}

function somar(linhas: Array<{ value_cents?: number | null; currency?: string | null }>, moeda: string | null): number {
  if (!moeda) return 0;
  return linhas.reduce((soma, l) => (l.currency === moeda ? soma + (Number(l.value_cents) || 0) : soma), 0);
}

/**
 * As vendas NOVAS de hoje: os avisos da mesma etapa abertos desde a meia-noite
 * (um por negócio — `aviso-de-etapa.handler.ts` não empilha iguais). Soma só o
 * que está na moeda desta venda. `null` quando não deu para ler: a notificação
 * sai sem o resumo, nunca deixa de sair.
 */
export async function novasDeHoje(
  admin: SupabaseClient,
  orgId: string,
  tituloDoAviso: string,
  moeda: string | null,
  desde: Date,
): Promise<ResumoDoDia | null> {
  try {
    const { data, error } = await admin
      .from("agent_inbox_items")
      .select("ref_id")
      .eq("organization_id", orgId)
      .eq("kind", "other")
      .eq("ref_kind", "lead")
      .eq("title", tituloDoAviso)
      .gte("created_at", desde.toISOString())
      .limit(1000);
    if (error || !data) return null;
    const ids = [...new Set((data as Array<{ ref_id: string | null }>).map((d) => d.ref_id).filter(Boolean))] as string[];
    if (ids.length === 0) return null;
    const { data: leads, error: erroLeads } = await admin
      .from("crm_leads")
      .select("value_cents, currency")
      .eq("organization_id", orgId)
      .in("id", ids);
    if (erroLeads) return { quantidade: ids.length, totalCents: 0 };
    return { quantidade: ids.length, totalCents: somar((leads ?? []) as never[], moeda) };
  } catch {
    return null;
  }
}

/** Os negócios GANHOS hoje, desde a meia-noite da organização. */
export async function ganhasDeHoje(
  admin: SupabaseClient,
  orgId: string,
  moeda: string | null,
  desde: Date,
): Promise<ResumoDoDia | null> {
  try {
    const { data, error } = await admin
      .from("crm_leads")
      .select("value_cents, currency")
      .eq("organization_id", orgId)
      .eq("status", "won")
      .gte("closed_at", desde.toISOString())
      .limit(1000);
    if (error || !data) return null;
    const linhas = data as Array<{ value_cents?: number | null; currency?: string | null }>;
    if (linhas.length === 0) return null;
    return { quantidade: linhas.length, totalCents: somar(linhas, moeda) };
  } catch {
    return null;
  }
}
