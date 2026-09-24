/**
 * O CASO ABERTO APARECE NA CENTRAL NA HORA — e sai quando é respondido.
 *
 * Um caso é a IA esperando uma pessoa destravar algo, com um cliente do outro
 * lado. Até aqui ele só aparecia na tela de Casos, dois cliques abaixo do menu:
 * o sino não mostrava nada, e a cobrança da Central (`case-stale-watcher`) só
 * chega depois de 24 horas. Medido numa loja que vende pelo WhatsApp: a IA
 * abriu o caso "cliente pergunta a transportadora" e o dono só o viu porque foi
 * procurar. O aviso no WhatsApp da equipe (`config_aviso_de_caso`) não cobre
 * quem só tem o número oficial: ele exige canal com mensagem livre fora da
 * janela de 24 horas.
 *
 * O aviso nasce `other` apontando para o caso (`ref_kind='agent_case'`), com
 * texto GENÉRICO: o título do caso é escrito pela IA sobre o cliente, e um aviso
 * que o repetisse ficaria fora da anonimização de LGPD, que só alcança os kinds
 * que ela conhece. O título do caso vai no push, que é efêmero.
 *
 * Com o aviso na Central vêm, sem código a mais: o sino, o som de "pessoa"
 * (`somDoAviso`) e o push para o celular (`central.aviso_criado`, migration
 * 0399). Quando o caso fecha — respondido, cancelado, escalado para fora —, o
 * aviso sai do sino.
 */
import type { EventHandler, EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { traduzir } from "@/lib/i18n/dicionario";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { createAdminClient } from "@/lib/supabase/admin";

const CONSUMER_KEY = "escalacao.caso-na-central";
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

async function abrir(row: EventRow, caseId: string): Promise<HandlerResult> {
  const admin = createAdminClient();

  // O caso pode ter fechado antes de o evento ser drenado: avisar seria ruído.
  const { data: caso, error } = await admin
    .from("agent_cases")
    .select("status")
    .eq("organization_id", row.organization_id)
    .eq("id", caseId)
    .maybeSingle();
  if (error) return tentarDeNovo(`leitura do caso falhou: ${error.message}`);
  const status = (caso as { status?: string } | null)?.status;
  if (status !== "awaiting_human" && status !== "escalated") return resultado("skipped", "caso_ja_fechado");

  // Um aviso aberto por caso: o mesmo evento reprocessado não empilha itens.
  const { data: jaAberto, error: erroDaBusca } = await admin
    .from("agent_inbox_items")
    .select("id")
    .eq("organization_id", row.organization_id)
    .eq("kind", "other")
    .eq("ref_kind", "agent_case")
    .eq("ref_id", caseId)
    .in("status", ["open", "ack"])
    .limit(1);
  if (erroDaBusca) return tentarDeNovo(`busca de aviso aberto falhou: ${erroDaBusca.message}`);
  if ((jaAberto ?? []).length > 0) return resultado("skipped", "aviso_ja_aberto");

  const { data: org } = await admin
    .from("organizations")
    .select("locale")
    .eq("id", row.organization_id)
    .maybeSingle();
  const idioma = normalizarIdioma((org as { locale?: string | null } | null)?.locale);

  const { error: erroDoInsert } = await admin.from("agent_inbox_items").insert({
    organization_id: row.organization_id,
    kind: "other",
    severity: "warn",
    title: traduzir("A IA pediu ajuda à equipe", idioma),
    body: traduzir("Abra o caso para responder. A IA continua atendendo o cliente enquanto isso.", idioma),
    ref_kind: "agent_case",
    ref_id: caseId,
  });
  if (erroDoInsert) return tentarDeNovo(`aviso não entrou na Central: ${erroDoInsert.message}`);
  return resultado("ok", "aviso_aberto");
}

async function fechar(row: EventRow, caseId: string): Promise<HandlerResult> {
  const { data, error } = await createAdminClient()
    .from("agent_inbox_items")
    .update({ status: "resolved", resolved_at: new Date().toISOString() })
    .eq("organization_id", row.organization_id)
    .eq("kind", "other")
    .eq("ref_kind", "agent_case")
    .eq("ref_id", caseId)
    .in("status", ["open", "ack"])
    .select("id");
  if (error) return tentarDeNovo(`aviso não saiu da Central: ${error.message}`);
  return resultado((data ?? []).length > 0 ? "ok" : "skipped", (data ?? []).length > 0 ? "aviso_resolvido" : "sem_aviso_aberto");
}

async function handle(row: EventRow): Promise<HandlerResult> {
  const caseId =
    (typeof row.payload?.case_id === "string" ? row.payload.case_id : null) ?? row.entity_id;
  if (!caseId) return resultado("skipped", "sem_caso");
  return row.event_type === "ai.case_opened" ? abrir(row, caseId) : fechar(row, caseId);
}

export const casoNaCentralHandler: EventHandler = {
  key: CONSUMER_KEY,
  events: ["ai.case_opened", "ai.case_closed"],
  handle,
};
