import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import type { CredentialRow } from "@/hooks/ai/useCredentials";
import { traduzir } from "@/lib/i18n/dicionario";
import { CredentialsList } from "./_components/CredentialsList";

export const dynamic = "force-dynamic";

const SAFE_COLUMNS =
  "id, organization_id, provider, label, api_key_last4, validated_at, validation_error, models_available, is_active, created_by, created_at, updated_at";

export default async function CredentialsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const idioma = user.idioma;
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    redirect("/403");
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_provider_credentials_safe")
    .select(SAFE_COLUMNS)
    .eq("organization_id", activeOrg.orgId)
    .order("created_at", { ascending: false });

  const credentials = (data ?? []) as unknown as CredentialRow[];
  const canWrite = ROLE_RANK[activeOrg.role] >= ROLE_RANK.admin;

  // Mapa de credential_id → quantos agents ativos a referenciam como published.
  const usageMap: Record<string, number> = {};
  if (credentials.length > 0) {
    const { data: linked } = await supabase
      .from("ai_agent_versions")
      .select(
        "credential_id, ai_agents!ai_agent_versions_agent_id_fkey!inner(archived_at, published_version_id)",
      )
      .eq("organization_id", activeOrg.orgId)
      .in("credential_id", credentials.map((c) => c.id));

    type LinkedRow = {
      credential_id: string;
      ai_agents:
        | { archived_at: string | null; published_version_id: string | null }
        | { archived_at: string | null; published_version_id: string | null }[]
        | null;
    };
    const rows = (linked ?? []) as unknown as LinkedRow[];
    for (const row of rows) {
      const agent = Array.isArray(row.ai_agents) ? row.ai_agents[0] : row.ai_agents;
      if (!agent || agent.archived_at) continue;
      if (!agent.published_version_id) continue;
      // Approximate: if credential is linked to a version belonging to a non-archived agent,
      // we count it. Mais conservador que o DELETE endpoint, mas suficiente para UX.
      usageMap[row.credential_id] = (usageMap[row.credential_id] ?? 0) + 1;
    }
  }

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{traduzir("Chaves de acesso à IA", idioma)}</h1>
        <p className="text-sm text-muted-foreground">
          {traduzir(
            "A conta de inteligência artificial é sua: você contrata direto na Anthropic, OpenAI ou Google e cola a chave aqui. Ela é guardada criptografada e nunca mais aparece na tela depois de salva — nem para você.",
            idioma,
          )}
        </p>
      </header>
      <CredentialsList
        initialData={credentials}
        canWrite={canWrite}
        usageMap={usageMap}
      />
    </div>
  );
}
