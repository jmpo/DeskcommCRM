/**
 * Pessoa no comando na hora do TURNO do fluxo — a política de handoff aplicada
 * também quando ninguém emitiu `ai.handoff_triggered`.
 *
 * A política do fluxo (`followup_flow_pointers.handoff_policy`) pausa ou cancela
 * a inscrição quando o handoff ABRE, mas reage ao EVENTO (`reactivity.ts`). Uma
 * conversa assumida à mão ("Assumir" na tela, o claim de um caso) não emite
 * esse evento: a inscrição seguia `active` e o próximo passo de IA falava por
 * cima da pessoa. A varredura de silêncio já não INSCREVE com pessoa no comando
 * (`silence-sweep.ts`), mas a inscrição criada antes da tomada continuava viva.
 *
 * "Pessoa no comando" é a mesma régua da varredura: conversa com
 * `assignee_kind = 'user'`, contato em `force_human`, ou IA silenciada agora.
 *
 * Pausar segue o contrato da reação ao handoff: `paused_handoff` só existe com
 * um consumidor que retoma (`ai.handoff_resolved`, emitido ao devolver o
 * atendimento ao agente). O descarte do turno durante a pausa é de quem chama:
 * o handler já grava `turn_discarded` para a inscrição pausada no mesmo nó
 * (#2262), e é isso que faz o motor enfileirar um turno novo na retomada.
 */
import type pg from 'pg';

export type DesfechoDaPessoaNoComando = 'pausada' | 'cancelada' | null;

export async function aplicarPessoaNoComandoAoTurno(
  pool: pg.Pool,
  alvo: {
    organizationId: string;
    enrollmentId: string;
    nodeId: string;
    conversationId: string;
  },
  agora: Date,
): Promise<DesfechoDaPessoaNoComando> {
  const { rows } = await pool.query<{
    status: string;
    current_node_id: string;
    steps_taken: number;
    handoff_policy: string | null;
    pessoa_no_comando: boolean;
  }>(
    `select e.status, e.current_node_id, e.steps_taken, p.handoff_policy,
            (c.assignee_kind = 'user'
             or coalesce(k.force_human, false)
             or (c.bot_silenced_until is not null and c.bot_silenced_until > $4::timestamptz)) as pessoa_no_comando
       from followup_enrollments e
       join followup_flow_pointers p on p.id = e.pointer_id and p.organization_id = e.organization_id
       join conversations c on c.id = $3 and c.organization_id = e.organization_id
       join contacts k on k.id = c.contact_id and k.organization_id = c.organization_id
      where e.organization_id = $1 and e.id = $2`,
    [alvo.organizationId, alvo.enrollmentId, alvo.conversationId, agora.toISOString()],
  );
  const linha = rows[0];
  if (!linha || !linha.pessoa_no_comando) return null;
  if (linha.current_node_id !== alvo.nodeId) return null;
  if (linha.status !== 'active' && linha.status !== 'waiting_reply') return null;
  // Ausente vale `pause`, o default da coluna — a mesma leitura da varredura.
  const politica = linha.handoff_policy === 'allow' || linha.handoff_policy === 'cancel' ? linha.handoff_policy : 'pause';
  if (politica === 'allow') return null;

  const cancela = politica === 'cancel';
  // O evento e a mudança de estado andam juntos: sem o evento (já aplicado
  // nesta ocupação do nó), nada muda — mesma idempotência de `applyStep`.
  const { rowCount } = await pool.query(
    `with ev as (
       insert into followup_enrollment_events
         (organization_id, enrollment_id, node_id, event_type, payload, idempotency_key)
       values ($1, $2, $3, $4, $5::jsonb, $6)
       on conflict (enrollment_id, idempotency_key) where idempotency_key is not null do nothing
       returning 1
     )
     update followup_enrollments
        set status = $7,
            outcome = case when $7 = 'cancelled' then 'handoff' else outcome end,
            cancel_reason = case when $7 = 'cancelled' then 'pessoa_no_comando' else cancel_reason end,
            completed_at = case when $7 = 'cancelled' then $8::timestamptz else completed_at end,
            next_eval_at = null,
            claimed_until = null,
            updated_at = $8::timestamptz
      where organization_id = $1 and id = $2 and status in ('active', 'waiting_reply')
        and exists (select 1 from ev)`,
    [
      alvo.organizationId,
      alvo.enrollmentId,
      linha.current_node_id,
      cancela ? 'reactivity_handoff_cancel' : 'handoff_paused',
      JSON.stringify(cancela ? { reason: 'pessoa_no_comando' } : { prior_status: linha.status, reason: 'pessoa_no_comando' }),
      `pessoa_no_comando:${linha.current_node_id}:${linha.steps_taken}`,
      cancela ? 'cancelled' : 'paused_handoff',
      agora.toISOString(),
    ],
  );
  if (!rowCount) return null;
  return cancela ? 'cancelada' : 'pausada';
}
