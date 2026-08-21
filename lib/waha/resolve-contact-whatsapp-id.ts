/**
 * Resolve o wa_id canônico para cartão de contato (vcard).
 *
 * No WhatsApp BR o CRM grava +5531998966398 (13 dígitos) mas o wa_id registrado
 * pode ser 553198966398 (12, sem o nono). vCard com waid errado EXIBE o cartão,
 * porém o toque no app nativo não abre a conversa — exatamente o bug reportado.
 *
 * WAHA documenta `GET /api/contacts/check-exists` para isso; tentamos todas as
 * variantes de busca (phoneLookupVariants) antes de cair no número bruto.
 */
import { phoneLookupVariants } from "@/lib/channels/phone-variants";

import type { WahaClient } from "./client";

export interface WahaCheckExistsResult {
  numberExists: boolean;
  chatId?: string | null;
  pn?: string | null;
}

/** Extrai só dígitos do JID retornado (`5531…@c.us` ou `@lid`). */
export function whatsappIdFromCheckResult(r: WahaCheckExistsResult): string | null {
  const raw = r.pn ?? r.chatId;
  if (!raw) return null;
  const user = raw.split("@")[0] ?? "";
  const digits = user.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/** Consulta WAHA; null = não achou ou falhou (caller usa fallback). */
export async function resolveWhatsappIdForContactCard(
  client: WahaClient,
  session: string,
  phone: string,
): Promise<string | null> {
  const tried = new Set<string>();
  for (const variant of phoneLookupVariants(phone)) {
    const digits = variant.replace(/\D/g, "");
    if (!digits || tried.has(digits)) continue;
    tried.add(digits);
    try {
      const r = await client.checkContactExists(session, digits);
      if (r.numberExists) {
        const id = whatsappIdFromCheckResult(r);
        if (id) return id;
      }
    } catch {
      // ponytail: falha na consulta não bloqueia envio — adapter cai no wa_id bruto
    }
  }
  return null;
}
