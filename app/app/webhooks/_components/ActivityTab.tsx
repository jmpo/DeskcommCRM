"use client";

import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";

import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";

import type { Locale } from "date-fns";
import * as React from "react";
import { toast } from "sonner";
import { formatDistanceToNowStrict } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Check,
  X,
  SkipForward,
  ArrowsClockwise,
  PaperPlaneTilt,
  ClockCountdown,
} from "@/lib/ui/icons";
import { cn } from "@/lib/utils";
import {
  useAutomationRuns,
  useResendAutomationRun,
  type AutomationRuleRunRow,
  type AutomationRuleRunActionResult,
} from "@/hooks/webhooks/useAutomationRules";
import { ACTION_LABELS, type ActionType } from "./labels";
import { useT } from "@/hooks/i18n/useT";

function actionLabel(type: string, t: (texto: string) => string): string {
  return t(ACTION_LABELS[type as ActionType] ?? type);
}

function relativeCreatedAt(iso: string, locale: Locale): string {
  return formatDistanceToNowStrict(new Date(iso), { addSuffix: true, locale: locale });
}

function statusBadgeVariant(
  status: AutomationRuleRunRow["status"],
): "success" | "error" | "warning" | "info" {
  if (status === "success") return "success";
  if (status === "failed") return "error";
  if (status === "adiado") return "info";
  return "warning";
}

function statusBadgeLabel(status: AutomationRuleRunRow["status"], t: (texto: string) => string): string {
  if (status === "success") return t("Sucesso");
  if (status === "failed") return t("Falhou");
  // "Aguardando envio", e não "Aguardando horário": desde que o agregador passou
  // a marcar `adiado` também quando a mensagem ficou na fila do canal (número
  // desconectado, transporte não configurado), o rótulo antigo afirmava uma
  // causa — o relógio — que muitas vezes não é a certa. A causa exata aparece
  // na linha da ação, logo abaixo, onde ela pode ser específica.
  if (status === "adiado") return t("Aguardando envio");
  return t("Parcial");
}

/**
 * POR QUE a ação não aconteceu, em português.
 *
 * Os motivos técnicos vinham no `detail.reason` e NUNCA chegavam à tela: o ícone
 * de "pulou" aparecia sozinho, e quem montou a automação ficava sem saber se o
 * contato estava bloqueado, sem telefone, ou se a regra simplesmente não tinha
 * a quem escrever. `explicacao` é a frase que o backend já monta quando conhece
 * o caso (ver lib/automation/desfecho-do-envio.ts); este mapa cobre os motivos
 * que nascem no próprio executor.
 */
const MOTIVO_DA_PARADA: Record<string, string> = {
  no_contact: "Esse lead entrou sem contato vinculado, então não havia para quem escrever.",
  contact_blocked: "O contato pediu para não receber mensagens (opt-out).",
  no_phone: "O contato não tem telefone cadastrado.",
  missing_config: "Falta preencher alguma configuração desta ação — abra a automação e revise.",
  fora_da_janela_de_envio:
    "Está fora da janela de envio configurada para esse número. A mensagem sai sozinha quando ela reabrir.",
  aguardando_o_canal: "A mensagem está na fila e sai assim que o canal aceitar.",
  sem_agente_publicado:
    "O agente escolhido não tem versão publicada. Publique-o em Agentes de IA para a automação poder usá-lo.",
  ia_indisponivel:
    "A IA não está configurada nesta instalação — cadastre uma chave em Provedores de IA.",
  texto_vazio: "A IA não devolveu texto. Revise o contexto que você escreveu para ela.",
};

function explicacaoDe(
  action: AutomationRuleRunActionResult,
  t: (texto: string) => string,
): string | null {
  const detail = action.detail ?? {};
  if (typeof detail.explicacao === "string") return t(detail.explicacao);
  const reason = typeof detail.reason === "string" ? detail.reason : null;
  if (reason && MOTIVO_DA_PARADA[reason]) return t(MOTIVO_DA_PARADA[reason]);
  return reason;
}

function horarioDeRetorno(action: AutomationRuleRunActionResult, idioma: string): string | null {
  const retryAt = action.detail?.retry_at;
  if (typeof retryAt !== "string") return null;
  const quando = new Date(retryAt);
  if (Number.isNaN(quando.getTime())) return null;
  return quando.toLocaleString(idioma, { dateStyle: "short", timeStyle: "short" });
}

function ActionLine({ action, run }: { action: AutomationRuleRunActionResult; run: AutomationRuleRunRow }) {
  const tagDoIdioma = useTagDeIdioma();
  const t = useT();
  const resend = useResendAutomationRun();

  const icon =
    action.status === "success" ? (
      <Check className="h-4 w-4 shrink-0 text-success" />
    ) : action.status === "failed" ? (
      <X className="h-4 w-4 shrink-0 text-error" />
    ) : action.status === "postponed" ? (
      <ClockCountdown className="h-4 w-4 shrink-0 text-muted-foreground" />
    ) : (
      <SkipForward className="h-4 w-4 shrink-0 text-muted-foreground" />
    );

  // A explicação vale TAMBÉM em `failed` — era aqui que os motivos da ação de
  // IA (`sem_agente_publicado`, `ia_indisponivel`, `texto_vazio`) morriam: eles
  // chegam em `action.error` como CÓDIGO, o ramo de falha imprime `error` cru, e
  // o mapa de frases logo acima nunca era consultado. Escrever as frases e não
  // ligá-las é o mesmo que não tê-las.
  const explicacao = explicacaoDe(action, t);
  const retorno = horarioDeRetorno(action, tagDoIdioma);

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-sm">
        {icon}
        <span>{actionLabel(action.type, t)}</span>
      </div>
      {action.status === "failed" ? (
        // `action.error` é texto de fora (resposta do webhook externo) — sem
        // tamanho garantido. `flex-wrap` + `break-words` impedem que um erro
        // comprido empurre o botão "Reenviar" pra fora da tela.
        <div className="ml-6 flex flex-wrap items-center justify-between gap-2 rounded-sm bg-muted px-2 py-1.5">
          <p className="min-w-0 break-words text-xs text-muted-foreground">
            {/* A frase ANTES do código cru. `action.error` já é texto de gente
                nas falhas de envio (desfechoDoEnvio traduz), mas nas falhas da
                IA ele é o código (`sem_agente_publicado`) — e é para esses que
                `explicacao` existe. O `??` mantém o erro do webhook externo,
                que não tem tradução possível e é a única pista real. */}
            {explicacao ?? action.error ?? t("Essa ação não funcionou.")}
          </p>
          {action.type === "call_webhook" ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="shrink-0"
              disabled={resend.isPending}
              onClick={() =>
                resend.mutate(run.id, {
                  onSuccess: () => toast.success(t("Reenviado.")),
                })
              }
            >
              <PaperPlaneTilt /> {t("Reenviar")}
            </Button>
          ) : null}
        </div>
      ) : explicacao ? (
        // Pular e adiar também precisam de razão visível: o ícone sozinho fazia
        // "não fiz nada" parecer "fiz e deu certo, só sem alarde".
        <div className="ml-6 rounded-sm bg-muted px-2 py-1.5">
          <p className="break-words text-xs text-muted-foreground">
            {explicacao}
            {retorno ? ` ${t("Nova tentativa em")} ${retorno}.` : null}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function ActivityTab() {
  const localeDaData = useLocaleDeData();
  const t = useT();
  const { data, isLoading, refetch, isRefetching } = useAutomationRuns();
  const runs = data?.data ?? [];

  return (
    <div className="space-y-4 pt-4">
      <div className="flex sm:justify-end">
        <Button
          type="button"
          variant="secondary"
          onClick={() => refetch()}
          disabled={isRefetching}
          className="w-full sm:w-auto"
        >
          <ArrowsClockwise className={cn(isRefetching && "animate-spin")} /> {t("Atualizar")}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : runs.length === 0 ? (
        <div className="flex justify-center pt-10">
          <Card className="max-w-md">
            <CardContent className="pt-6 text-center text-sm text-muted-foreground">
              {t(
                "Nenhuma automação rodou ainda. Assim que uma regra ligada disparar, o histórico aparece aqui.",
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="space-y-3">
          {runs.map((run) => (
            <Card key={run.id}>
              <CardHeader className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="truncate text-sm">
                    {run.automation_rules?.name ?? t("Automação removida")}
                  </CardTitle>
                  <Badge variant={statusBadgeVariant(run.status)}>{statusBadgeLabel(run.status, t)}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{relativeCreatedAt(run.created_at, localeDaData)}</p>
              </CardHeader>
              <CardContent className="space-y-2">
                {run.actions_result.map((action, idx) => (
                  <ActionLine key={idx} action={action} run={run} />
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
