/**
 * Acesso tipado às tabelas núcleo do harness. SQL cru, sem ORM.
 *
 * ponytail: fluxo de espelho morto no porte para o DeskcommCRM (mesmo banco agora) —
 * removidos createTenant, upsertLead, getLead, listLeads, ingestCrmEvent,
 * listCrmEvents e os tipos TenantRow/LeadRow/EventInboxRow (organizations/contacts
 * são as tabelas reais do CRM; o drain lê event_log direto). Sobra o inbox de
 * escalação humana (agent_inbox_items).
 *
 * Regra de isolamento (F2-02): toda query filtra `organization_id` — nenhuma função
 * devolve linha de outra org (`null` = item de plataforma).
 */
import type pg from 'pg';

/**
 * O vocabulário dos avisos do runtime. Espelha o CHECK de
 * `agent_inbox_items.kind` — e o espelho é MECÂNICO: o invariante
 * `tests/invariants/vocabulario-banco-x-typescript.test.ts` compara os dois
 * conjuntos contra Postgres real, porque o compilador não enxerga o banco.
 *
 * Esta lista já ficou 3 valores atrás do banco (`judge_unaligned`,
 * `followup_dead`, `next_action_ambiguous`) sem nada falhar. Quem adiciona um
 * kind numa migration adiciona aqui na mesma mudança.
 */
export type InboxKind =
  | 'qr_rescan'
  | 'job_dead'
  | 'event_dead'
  | 'budget_exceeded'
  | 'handoff'
  | 'promotion_review'
  | 'judge_unaligned'
  | 'followup_dead'
  | 'snooze_expired'
  | 'next_action_ambiguous'
  | 'risk_backlog_seeded'
  | 'reactivation_expired'
  | 'capabilities_missing'
  | 'message_send_stuck'
  // (migration 0120) A plataforma do canal decide sozinha: reprova um modelo
  // aprovado, suspende o número, exige KYC. Nada disso chegava ao operador — a
  // descoberta acontecia no disparo que não saiu.
  //
  // Estes DOIS nomes precisam existir aqui, e não só no CHECK do banco:
  // `vocabulario-banco-x-typescript` exige que os dois vocabulários digam a
  // mesma coisa, e foi ele que pegou a primeira versão desta mudança — que
  // tinha o banco atualizado e o tipo não.
  | 'channel_template_review'
  | 'channel_number_alert'
  | 'promise_unfulfilled'
  | 'other';

export interface InboxItemRow {
  id: string;
  organization_id: string | null;
  kind: InboxKind;
  severity: 'info' | 'warn' | 'critical';
  title: string;
  body: string | null;
  ref_kind: string | null;
  ref_id: string | null;
  status: 'open' | 'ack' | 'resolved';
  created_at: Date;
}

function one<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`esperava uma linha de ${what}, veio nenhuma`);
  }
  return row;
}

export async function insertInboxItem(
  db: pg.Pool,
  tenantId: string | null, // null = plataforma (ex.: infra)
  input: { kind: InboxKind; title: string; severity?: InboxItemRow['severity']; body?: string; refKind?: string; refId?: string },
): Promise<InboxItemRow> {
  const { rows } = await db.query<InboxItemRow>(
    `insert into agent_inbox_items (organization_id, kind, severity, title, body, ref_kind, ref_id)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning *`,
    [tenantId, input.kind, input.severity ?? 'warn', input.title, input.body ?? null, input.refKind ?? null, input.refId ?? null],
  );
  return one(rows, 'agent_inbox_items');
}

export async function listOpenInboxItems(db: pg.Pool, tenantId: string): Promise<InboxItemRow[]> {
  const { rows } = await db.query<InboxItemRow>(
    `select * from agent_inbox_items
     where organization_id = $1 and status = 'open'
     order by created_at desc`,
    [tenantId],
  );
  return rows;
}
