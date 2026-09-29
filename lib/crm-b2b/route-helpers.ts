/**
 * Helpers de rota para CRM B2B — Zod + ApiError → fail().
 */
import { ZodError } from "zod";
import { randomUUID } from "node:crypto";

import { ApiError } from "@/lib/api/types";
import { fail, ok } from "@/lib/api/wrappers";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import type { RoleCheck } from "@/lib/auth/require-role";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Empresas, pessoas e importação são MÓDULO OPCIONAL da instalação, desligado
 * por padrão (doc 68, `lib/instalacao/modulos.ts`). Desligado, nenhuma rota
 * dele existe: 404, a mesma resposta de uma rota nunca instalada — e a mesma de
 * `notFound()` na tela. Toda rota do módulo chama isto primeiro, como as de
 * `/api/v1/external-db`.
 */
export async function seModuloB2bDesligado(requestId: string): Promise<Response | null> {
  if (await moduloLigado(createAdminClient(), "crm_b2b")) return null;
  return fail("not_found", "Not found.", 404, { requestId });
}

export function requestIdOf(req: Request): string {
  return req.headers.get("x-request-id") ?? randomUUID();
}

export function ctxFromAuthz(authz: Extract<RoleCheck, { ok: true }>, requestId: string): HandlerCtx {
  return {
    organization_id: authz.org.orgId,
    actor: { type: "user", id: authz.user.id, role: authz.org.role },
    requestId,
    idioma: authz.user.idioma,
  };
}

export function handleRouteError(err: unknown, requestId: string): Response {
  if (err instanceof ApiError) {
    return fail(err.code, err.message, err.status, { requestId, details: err.details });
  }
  if (err instanceof ZodError) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      requestId,
      details: { issues: err.issues },
    });
  }
  const message = err instanceof Error ? err.message : "Erro interno.";
  return fail("internal_error", message, 500, { requestId });
}

export { ok, fail };
