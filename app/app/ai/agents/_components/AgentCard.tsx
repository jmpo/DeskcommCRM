"use client";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { AgentRow } from "@/hooks/ai/useAgent";
import { AgentStatusBadge, deriveAgentStatus } from "./AgentStatusBadge";
import { AgentRowMenu } from "./AgentRowMenu";

interface Props {
  agent: AgentRow;
  canWrite: boolean;
}

/**
 * A linha do modelo, dizendo o que está EM VIGOR.
 *
 * Três casos, e cada um existe por um motivo medido:
 *
 *  1. versão publicada → é ela que o runtime lê (`agent-config.ts`), então é ela
 *     que a lista mostra. `ai_agents.model` não é sincronizado ao publicar.
 *  2. `provedor/modelo` → o formato do `rag_bot` legado, onde a coluna É a fonte.
 *  3. id nu → como todo `mcp_agent` nasce (`createMcpAgentAction` grava o id do
 *     catálogo). Antes, o `split("/")[0]` devolvia o próprio modelo e a lista
 *     renderizava "claude-sonnet-4-6 · claude-sonnet-4-6".
 */
export function modeloEmVigor(agent: AgentRow): string {
  const publicada = agent.versao_publicada;
  if (publicada?.model) {
    return publicada.provider ? `${publicada.provider} · ${publicada.model}` : publicada.model;
  }
  const cadastro = agent.model?.trim() ?? "";
  if (cadastro === "") return "—";
  if (!cadastro.includes("/")) return cadastro;
  const [provedor, ...resto] = cadastro.split("/");
  return `${provedor} · ${resto.join("/")}`;
}

export function AgentCard({ agent, canWrite }: Props) {
  const status = deriveAgentStatus(agent);

  return (
    <Card className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-medium" title={agent.name}>
            {agent.name}
          </h3>
          <p className="truncate text-xs text-muted-foreground">
            {modeloEmVigor(agent)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {agent.is_default && (
            <Badge variant="secondary" className="text-xs">
              default
            </Badge>
          )}
          <AgentStatusBadge status={status} />
          {canWrite && <AgentRowMenu agent={agent} />}
        </div>
      </div>
      {agent.description && (
        <p className="line-clamp-2 text-xs text-muted-foreground">{agent.description}</p>
      )}
      <dl className="grid grid-cols-2 gap-2 pt-1 text-xs">
        <div>
          <dt className="text-muted-foreground">Tipo</dt>
          <dd className="font-mono">{agent.kind ?? "rag_bot"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Prioridade</dt>
          <dd className="font-mono">{agent.priority ?? "—"}</dd>
        </div>
      </dl>
      <div className="mt-auto pt-2">
        <Link href={`/app/ai/agents/${agent.id}`}>
          <Button variant="outline" size="sm" className="w-full">
            {canWrite ? "Editar" : "Visualizar"}
          </Button>
        </Link>
      </div>
    </Card>
  );
}
