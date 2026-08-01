/**
 * LGPD redact cascade — invokes the SECURITY DEFINER RPC
 * `fn_lgpd_cascade_redact_contact` that performs the full anonymisation in
 * a single Postgres transaction.
 *
 * The RPC:
 *   - Short-circuits when contact is already anonymised (returns
 *     `already_anonymized: true`).
 *   - Mutates contacts (irreversible), conversations, messages,
 *     crm_lead_activities, crm_leads.
 *   - Strips personal fields from orders.payload but PRESERVES values.
 *   - Enqueues media paths into `storage_redaction_queue` for async deletion.
 *   - Inserts a dense `lgpd.redact_executed` audit row inside the TX.
 *
 * All tenant filtering is enforced at the RPC level (programmatic
 * organization_id check). The admin client bypasses RLS.
 */

import { createAdminClient } from "@/lib/supabase/admin";

export interface CascadeResult {
  alreadyAnonymized: boolean;
  counts: Record<string, number>;
  mediaPaths: string[];
}

interface RpcResult {
  already_anonymized: boolean;
  counts?: Record<string, number>;
  media_paths?: string[];
}

export interface CascadeArgs {
  organizationId: string;
  contactId: string;
  requestId: string;
}

export async function cascadeRedactContact(args: CascadeArgs): Promise<CascadeResult> {
  const admin = createAdminClient();

  // FOTO DE PERFIL — enfileirada ANTES da cascata, e a ordem importa.
  //
  // A RPC zera os campos do contato. Se o avatar fosse limpo junto sem passar
  // por aqui, o caminho do arquivo se perderia e a imagem ficaria ÓRFÃ no
  // bucket: a pessoa "anonimizada" continuaria com o rosto guardado. Numa
  // auditoria LGPD isso é o mesmo que não ter anonimizado.
  //
  // Fica no app, e não dentro da função SQL, de propósito: aquela função tem
  // ~200 linhas e um `create or replace` exigiria copiá-la inteira só para
  // acrescentar uma coluna — risco de divergir do original sem necessidade.
  // Aqui o efeito é o mesmo e a mudança é auditável.
  //
  // A fila é idempotente (`unique (bucket, object_path)`), então re-executar
  // uma anonimização não duplica nada.
  const { data: contatoAvatar } = await admin
    .from("contacts")
    .select("avatar_storage_path")
    .eq("id", args.contactId)
    .eq("organization_id", args.organizationId)
    .maybeSingle();

  const avatarPath = (contatoAvatar as { avatar_storage_path?: string | null } | null)
    ?.avatar_storage_path;

  if (avatarPath) {
    await admin.from("storage_redaction_queue").insert({
      organization_id: args.organizationId,
      request_id: args.requestId,
      bucket: "whatsapp-media",
      object_path: avatarPath,
    });
    await admin
      .from("contacts")
      .update({ avatar_storage_path: null, avatar_updated_at: new Date().toISOString() })
      .eq("id", args.contactId)
      .eq("organization_id", args.organizationId);
  }

  const { data, error } = await admin.rpc("fn_lgpd_cascade_redact_contact" as never, {
    p_organization_id: args.organizationId,
    p_contact_id: args.contactId,
    p_request_id: args.requestId,
  } as never);

  if (error) {
    throw new Error(`[lgpd-redact-cascade] rpc failed: ${error.message}`);
  }

  const result = (data ?? {}) as RpcResult;
  return {
    alreadyAnonymized: result.already_anonymized === true,
    counts: result.counts ?? {},
    mediaPaths: result.media_paths ?? [],
  };
}
