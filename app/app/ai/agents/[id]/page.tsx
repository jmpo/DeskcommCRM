import { notFound, redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { listSelectableChannels } from "@/lib/channels/selectable";
import { createClient } from "@/lib/supabase/server";
import type { AgentRow } from "@/hooks/ai/useAgent";
import type { AgentVersionRow } from "@/hooks/ai/useAgentVersions";
import type { CredentialRow } from "@/hooks/ai/useCredentials";

import { AgentEditorClient } from "./_client";
import { AgentTabs } from "./_components/AgentTabs";
import type { FunilDaResposta } from "@/hooks/pipelines/usePipelines";
import { coberturaDoFunil, type EtapaDoMapa } from "@/lib/leads/agent-mapping";
import type { CoberturaPorFunil } from "./_components/FunisDoAgente";
import { lerAmbiente } from "@/lib/instalacao/ambiente";

export const dynamic = "force-dynamic";

const AGENT_COLUMNS =
  "id, organization_id, name, description, model, system_prompt, is_active, is_default, kind, priority, published_version_id, archived_at, config, guardrails, active_kb_version_id, created_at, updated_at";

const VERSION_COLUMNS =
  "id, organization_id, agent_id, version_number, system_prompt, provider, model, credential_id, tool_ids, trigger_config, channel_session_id, max_steps, token_budget, cost_budget_cents, history_message_window, history_token_window, handoff_keywords, handoff_tool_enabled, cases_enabled, split_messages, split_max_chars, followup, operator_enabled, operator_model, operator_tool_ids, status, published_at, superseded_at, created_at, created_by,pipeline_ids";

const CREDENTIAL_COLUMNS =
  "id, organization_id, provider, label, api_key_last4, validated_at, validation_error, models_available, is_active, created_by, created_at, updated_at";

/**
 * Os provedores cuja chave veio na INSTALAÇÃO (`.env`), não da tela de
 * Credenciais.
 *
 * Sai de `lerAmbiente`, a mesma leitura que o retrato da instalação usa — uma
 * segunda lista de nomes de variável divergiria no dia em que um provedor novo
 * entrasse.
 */
function provedoresDaInstalacao(): string[] {
  const a = lerAmbiente();
  return Object.entries(a.chavesDeProvedor)
    .filter(([, tem]) => tem)
    .map(([id]) => id);
}

export default async function AgentEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    redirect("/403");
  }

  const supabase = await createClient();
  const { data: agentRow } = await supabase
    .from("ai_agents")
    .select(AGENT_COLUMNS)
    .eq("id", id)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();

  if (!agentRow) notFound();

  const agent = agentRow as unknown as AgentRow;
  const readOnly = ROLE_RANK[activeOrg.role] < ROLE_RANK.admin;

  // Caminho legado: rag_bot continua usando o editor pré-EPIC-13.
  if ((agent.kind ?? "rag_bot") !== "mcp_agent") {
    return (
      <div className="flex h-full flex-col gap-6 p-6">
        <AgentEditorClient agentId={agent.id} initialData={agent} readOnly={readOnly} />
      </div>
    );
  }

  // mcp_agent: busca versions + lookups.
  const [versionsRes, credentialsRes, channelSessions, routerMemberRes, funisRes] = await Promise.all([
    supabase
      .from("ai_agent_versions")
      .select(VERSION_COLUMNS)
      .eq("organization_id", activeOrg.orgId)
      .eq("agent_id", id)
      .order("version_number", { ascending: false }),
    supabase
      .from("ai_provider_credentials_safe")
      .select(CREDENTIAL_COLUMNS)
      .eq("organization_id", activeOrg.orgId),
    listSelectableChannels(supabase, activeOrg.orgId),
    supabase
      .from("ai_router_members")
      .select("router_id, ai_routers(name)")
      .eq("organization_id", activeOrg.orgId)
      .eq("agent_id", id)
      .limit(1)
      .maybeSingle(),
    // Os funis vêm com a página, não por fetch no cliente: a marcação usa
    // "nenhum funil" para dizer algo importante, e uma lista que chega vazia no
    // primeiro render diria isso por engano.
    supabase
      .from("crm_pipelines")
      .select("id, name, slug, description, position, is_default")
      .eq("organization_id", activeOrg.orgId)
      .eq("is_archived", false)
      .order("position"),
  ]);

  const versions = (versionsRes.data ?? []) as unknown as AgentVersionRow[];
  const funis = (funisRes.data ?? []) as unknown as FunilDaResposta[];

  // Quanto de cada funil o assistente sabe percorrer (spec 17 passo 4). Vem
  // junto com a página porque a lacuna precisa aparecer no MESMO lugar em que o
  // dono marca o funil — descobrir isso entrando funil por funil na tela de
  // tradução é o que fez 3 dos 4 funis da produção ficarem mudos sem ninguém ver.
  const { data: etapasRes } = await supabase
    .from("crm_stages")
    .select("id, name, is_won, is_lost, agent_stage_hint, pipeline_id")
    .eq("organization_id", activeOrg.orgId)
    .eq("is_archived", false);
  const etapasPorFunil = new Map<string, EtapaDoMapa[]>();
  for (const e of (etapasRes ?? []) as Array<EtapaDoMapa & { pipeline_id: string }>) {
    etapasPorFunil.set(e.pipeline_id, [...(etapasPorFunil.get(e.pipeline_id) ?? []), e]);
  }
  const cobertura: CoberturaPorFunil = {};
  for (const f of funis) {
    const c = coberturaDoFunil(etapasPorFunil.get(f.id) ?? []);
    cobertura[f.id] = { traduzidos: c.traduzidos, total: c.total, mudo: c.mudo };
  }
  const credentials = (credentialsRes.data ?? []) as unknown as CredentialRow[];
  const routerMemberRow = routerMemberRes.data as { router_id: string; ai_routers: { name: string } | null } | null;
  const routerMembership = routerMemberRow
    ? { routerId: routerMemberRow.router_id, routerName: routerMemberRow.ai_routers?.name ?? "roteador" }
    : null;

  const draft =
    versions
      .filter((v) => v.status === "draft")
      .reduce<AgentVersionRow | null>(
        (a, b) => (a && a.version_number > b.version_number ? a : b),
        null,
      );
  const published = versions.find((v) => v.status === "published") ?? null;

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <AgentTabs
        agent={agent}
        draft={draft}
        published={published}
        versions={versions}
        credentials={credentials}
        provedoresDaInstalacao={provedoresDaInstalacao()}
        channelSessions={channelSessions}
        funis={funis}
        cobertura={cobertura}
        routerMembership={routerMembership}
        readOnly={readOnly}
      />
    </div>
  );
}
