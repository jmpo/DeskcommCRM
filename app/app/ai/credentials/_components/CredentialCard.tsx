"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { refreshCredentialsView } from "../_actions";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ArrowsClockwise, Trash } from "@/lib/ui/icons";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import {
  credentialStatus,
  credentialsListQueryKey,
  type CredentialRow,
} from "@/hooks/ai/useCredentials";
import { useT } from "@/hooks/i18n/useT";

interface Props {
  credential: CredentialRow;
  canWrite: boolean;
  usageCount: number;
}

const STATUS_LABEL: Record<ReturnType<typeof credentialStatus>, string> = {
  validated: "Validada",
  validating: "Validando…",
  invalid: "Inválida",
  inactive: "Inativa",
};

const STATUS_VARIANT: Record<ReturnType<typeof credentialStatus>, "default" | "secondary" | "destructive" | "outline"> = {
  validated: "default",
  validating: "secondary",
  invalid: "destructive",
  inactive: "outline",
};

export function CredentialCard({ credential, canWrite, usageCount }: Props) {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const status = credentialStatus(credential);
  const last4 = credential.api_key_last4 ?? "????";
  const inUse = usageCount > 0;

  const onRevalidate = () => {
    startTransition(async () => {
      try {
        await apiClient.post(`/api/v1/ai/credentials/${credential.id}/revalidate`, {});
        toast.success(t("Revalidando…"));
        await qc.invalidateQueries({ queryKey: credentialsListQueryKey });
      } catch (err) {
        showApiError(err);
      }
    });
  };

  const onDelete = () => {
    startTransition(async () => {
      try {
        await apiClient.delete(`/api/v1/ai/credentials/${credential.id}`);
        toast.success(t("Credencial removida."));
        setDeleteOpen(false);
        await qc.invalidateQueries({ queryKey: credentialsListQueryKey });
        await refreshCredentialsView();
        router.refresh();
      } catch (err) {
        showApiError(err);
      }
    });
  };

  const deleteButton = (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t("Excluir credencial")}
      disabled={!canWrite || inUse || isPending}
      onClick={() => setDeleteOpen(true)}
    >
      <Trash size={14} aria-hidden />
    </Button>
  );

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-medium" title={credential.label}>
            {credential.label}
          </h3>
          <p className="font-mono text-xs text-muted-foreground">
            …{last4}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Badge variant={STATUS_VARIANT[status]} className="text-xs">
            {t(STATUS_LABEL[status])}
          </Badge>
        </div>
      </div>

      {credential.validation_error && (
        <p className="line-clamp-2 text-xs text-destructive" title={credential.validation_error}>
          {credential.validation_error}
        </p>
      )}

      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-muted-foreground">{t("Modelos")}</dt>
          <dd className="font-mono">{credential.models_available ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("Em uso por")}</dt>
          <dd className="font-mono">{usageCount}</dd>
        </div>
      </dl>

      {canWrite && (
        <div className="flex items-center justify-end gap-1 pt-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("Revalidar credencial")}
            disabled={isPending}
            onClick={onRevalidate}
          >
            <ArrowsClockwise size={14} aria-hidden />
          </Button>
          {inUse ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>{deleteButton}</span>
                </TooltipTrigger>
                <TooltipContent>
                  {t("Em uso por")} {usageCount} {t("agente")}
                  {usageCount === 1 ? "" : "s"} {t("publicado")}
                  {usageCount === 1 ? "" : "s"}.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            deleteButton
          )}
        </div>
      )}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("Remover credencial")} &ldquo;{credential.label}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("Agents que usam esta credencial vão falhar ao executar. Esta ação não pode ser desfeita.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>{t("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete} disabled={isPending}>
              {t("Remover")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
