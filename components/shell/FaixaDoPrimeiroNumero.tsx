"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { ativarAgente } from "@/app/actions/onboarding/ativarAgente";
import { useT } from "@/hooks/i18n/useT";
import type { AvisoDoPrimeiroNumero } from "@/lib/onboarding/aviso-do-primeiro-numero";

/**
 * A faixa de quem ainda não tem o WhatsApp atendendo. O estado e o porquê estão
 * em `lib/onboarding/aviso-do-primeiro-numero.ts`; aqui só o desenho e a ação.
 * Mora dentro de `FaixasDeCima`, que mede a altura para a Inbox descontar.
 */
export function FaixaDoPrimeiroNumero({ aviso }: { aviso: NonNullable<AvisoDoPrimeiroNumero> }) {
  const t = useT();
  const router = useRouter();
  const [pendente, startTransition] = useTransition();

  const ativar = () =>
    startTransition(async () => {
      const r = await ativarAgente();
      if (r.ok && (r.estado === "publicado" || r.estado === "ja_no_ar")) {
        toast.success(t("Pronto: seu agente já está atendendo pelo seu número."));
        router.refresh();
        return;
      }
      toast.error(
        t("Não consegui ativar o agente daqui. Abra IA › Agentes para revisar e publicar."),
      );
    });

  return (
    <div
      role="status"
      data-testid="faixa-do-primeiro-numero"
      className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-300 bg-amber-50/95 px-4 py-2 text-sm text-amber-950 backdrop-blur dark:border-amber-700/60 dark:bg-amber-950/70 dark:text-amber-50"
    >
      <span>
        {aviso.tipo === "sem_numero"
          ? t(
              "Seu WhatsApp ainda não está conectado: sem número, nenhuma conversa chega e seu agente não atende.",
            )
          : `${aviso.nome || t("Seu agente")} ${t("está pronto, mas ainda não está atendendo pelo seu número.")}`}
      </span>
      {aviso.tipo === "sem_numero" ? (
        <Link
          href="/app/connections"
          className="rounded-md border border-amber-400 bg-white/70 px-3 py-1 font-medium text-amber-950 hover:bg-white max-md:inline-flex max-md:min-h-11 max-md:items-center dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-50 dark:hover:bg-amber-900/70"
        >
          {t("Conectar WhatsApp")}
        </Link>
      ) : (
        <button
          type="button"
          disabled={pendente}
          onClick={ativar}
          className="rounded-md border border-amber-400 bg-white/70 px-3 py-1 font-medium text-amber-950 hover:bg-white disabled:opacity-60 max-md:inline-flex max-md:min-h-11 max-md:items-center dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-50 dark:hover:bg-amber-900/70"
        >
          {pendente ? t("Ativando…") : t("Ativar agora")}
        </button>
      )}
    </div>
  );
}
