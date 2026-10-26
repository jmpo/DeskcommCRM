/**
 * O aviso de quem ainda não tem o WhatsApp atendendo — a faixa do topo de `/app`.
 *
 * ─── O defeito, medido em produção (QA de 26/10/2026) ──────────────────────
 *
 * Quem pulava o telefone no onboarding terminava numa Inbox vazia ("Sem
 * conversas por aqui") sem nada dizendo POR QUE ela estava vazia nem onde
 * conectar o número; Conexões abria na aba do QR e escondia o caminho oficial.
 * E quem conectava depois ficava com o agente em rascunho, mudo.
 *
 * Dois estados, e cada um com a sua saída:
 *  - `sem_numero`: nenhum número conectado → "Conectar WhatsApp".
 *  - `agente_pronto`: há número, e o agente do onboarding segue em rascunho →
 *    "Ativar agora" (o mesmo `ativarAgenteDoOnboarding` da conexão).
 *
 * Só para quem pode agir (admin), e nunca em acompanhamento: quem decide é o
 * layout. Leitura que falha devolve `null` — sem faixa, nunca uma faixa errada.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { listSelectableChannels } from "@/lib/channels/selectable";

export type AvisoDoPrimeiroNumero =
  { tipo: "sem_numero" } | { tipo: "agente_pronto"; nome: string } | null;

export async function lerAvisoDoPrimeiroNumero(
  admin: SupabaseClient,
  orgId: string,
): Promise<AvisoDoPrimeiroNumero> {
  try {
    const canais = await listSelectableChannels(admin, orgId);
    if (canais.length === 0) return { tipo: "sem_numero" };

    const { data: agente, error } = await admin
      .from("ai_agents")
      .select("id, name, published_version_id, archived_at")
      .eq("organization_id", orgId)
      .eq("is_default", true)
      .maybeSingle();
    if (error || !agente || agente.archived_at || agente.published_version_id) return null;

    // Só o rascunho que o PRÓPRIO onboarding criou. Versão feita no editor é
    // decisão de alguém, e a faixa não oferece publicá-la por cima. E agente
    // SEM versão nenhuma também não: o rascunho só nasce quando havia modelo e
    // chave de IA, e oferecer "Ativar agora" a quem não tem chave seria
    // prometer um agente que morre na primeira mensagem (a instalação fresca
    // sem chave termina exatamente assim — `vps-fresh-onboarding`, J1.7).
    const { data: versoes, error: vErr } = await admin
      .from("ai_agent_versions")
      .select("provisioning_origin")
      .eq("organization_id", orgId)
      .eq("agent_id", agente.id as string)
      .limit(2);
    if (vErr) return null;
    const lista = versoes ?? [];
    const doOnboarding = lista.length === 1 && lista[0]?.provisioning_origin === "onboarding";
    return doOnboarding ? { tipo: "agente_pronto", nome: String(agente.name ?? "") } : null;
  } catch {
    return null;
  }
}
