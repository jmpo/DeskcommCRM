/**
 * Evento de conversão de ETAPA: quando um negócio entra numa etapa com
 * `crm_stages.evento_de_conversao` (migration 0403), o evento sai para a
 * plataforma do anúncio que trouxe o contato.
 *
 * Existe porque, em quem vende com pagamento na entrega, a venda (`Purchase`)
 * só é reportada na entrega — dias depois do clique. O sinal de intenção forte
 * é a confirmação do pedido, e é essa etapa que a organização marca com
 * `InitiateCheckout`. Mesmo caminho da venda (`reportarConversao`): livro-razão
 * que não duplica, atribuição do anúncio, canal com a ponte primeiro.
 *
 * O `status` do payload não importa: quem decide é a etapa de destino, relida
 * do banco. Voltar e reentrar na etapa não reenvia — o livro-razão segura.
 */
import type { EventHandler, EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { EVENTOS_DE_ETAPA, type EventoDeEtapa } from "@/lib/plataformas-de-anuncio/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportarConversao } from "./envio.handler";

const CONSUMER_KEY = "conversoes.etapa";
const ESPERA_MS = 5 * 60 * 1000;

const resultado = (status: HandlerResult["status"], detail?: string): HandlerResult => ({
  consumer_key: CONSUMER_KEY,
  status,
  detail,
});

const tentarDeNovo = (detail: string): HandlerResult => ({
  consumer_key: CONSUMER_KEY,
  status: "retry",
  retry_at: new Date(Date.now() + ESPERA_MS).toISOString(),
  detail,
});

function ehEventoDeEtapa(v: unknown): v is EventoDeEtapa {
  return typeof v === "string" && (EVENTOS_DE_ETAPA as readonly string[]).includes(v);
}

async function handle(row: EventRow): Promise<HandlerResult> {
  const etapaId = typeof row.payload?.to_stage_id === "string" ? row.payload.to_stage_id : null;
  if (!row.entity_id || !etapaId) return resultado("skipped", "sem_etapa_de_destino");

  const admin = createAdminClient();

  // ⚠️ Organização junto do id: o client é service-role e ignora RLS.
  const { data: etapa, error: erroDaEtapa } = await admin
    .from("crm_stages")
    .select("evento_de_conversao")
    .eq("id", etapaId)
    .eq("organization_id", row.organization_id)
    .maybeSingle();
  if (erroDaEtapa) return tentarDeNovo(`leitura da etapa falhou: ${erroDaEtapa.message}`);
  const evento = (etapa as { evento_de_conversao?: unknown } | null)?.evento_de_conversao;
  if (!ehEventoDeEtapa(evento)) return resultado("skipped", "etapa_sem_evento");

  const { data: lead, error } = await admin
    .from("crm_leads")
    .select("id, value_cents, currency, contact_id")
    .eq("id", row.entity_id)
    .eq("organization_id", row.organization_id)
    .maybeSingle();
  if (error) return tentarDeNovo(`leitura do lead falhou: ${error.message}`);
  if (!lead) return resultado("skipped", "lead_inexistente");

  const l = lead as { id: string; value_cents: number | null; currency: string | null; contact_id: string | null };
  // Sem `closed_at`: o negócio não fechou. O instante do evento é o da entrada
  // na etapa, que é o `created_at` da linha do event_log.
  return reportarConversao(
    admin,
    row,
    { id: l.id, value_cents: l.value_cents && l.value_cents > 0 ? l.value_cents : null, currency: l.currency, closed_at: null, contact_id: l.contact_id },
    evento,
    CONSUMER_KEY,
    { exigeValor: false },
  );
}

export const conversaoDeEtapaHandler: EventHandler = {
  key: CONSUMER_KEY,
  events: ["lead.stage_changed"],
  handle,
};
