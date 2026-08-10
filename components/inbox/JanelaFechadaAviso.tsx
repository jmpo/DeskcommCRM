"use client";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useSendMessage } from "@/hooks/inbox/useSendMessage";
import { useTemplates, type TemplateView } from "@/hooks/channels/useTemplates";
import { cn } from "@/lib/utils";

/**
 * A janela fechou — e aqui está o caminho de volta.
 *
 * ─── Por que barrar sem oferecer saída não serve ────────────────────────────
 *
 * O commit anterior barrou o texto livre fora das 24h, que era o pedido. Só que
 * barrar sem oferecer o modelo deixa o operador SEM caminho: ele vê "só modelo
 * aprovado sai daqui" e não tem como mandar um. A plataforma do parceiro faz
 * exatamente isto na mesma situação — barra o texto e abre o seletor.
 *
 * ─── Só as APROVADAS ────────────────────────────────────────────────────────
 *
 * Listar uma em revisão ou reprovada seria oferecer um caminho que falha no
 * clique. Quem quiser criar ou acompanhar revisão tem a tela de Conexões; aqui
 * o único objetivo é reabrir a conversa agora.
 *
 * ─── O que este componente NÃO faz ──────────────────────────────────────────
 *
 * Não preenche `{{1}}`, `{{2}}`. Modelo com parâmetro é oferecido, mas o envio
 * vai com os valores vazios — e a plataforma recusa. Preencher direito exige a
 * tela de variáveis (que existe em Conexões) trazida para cá, com preview por
 * modelo. Por isso o seletor MARCA quais pedem parâmetro, em vez de escondê-los
 * (esconder faria o operador procurar um modelo que existe e não aparece).
 */
export function JanelaFechadaAviso({
  conversationId,
  motivo,
}: {
  conversationId: string;
  motivo: string;
}) {
  const { data } = useTemplates();
  const send = useSendMessage();
  const [escolhido, setEscolhido] = useState("");

  const aprovados = useMemo(
    () =>
      (data?.data.templates ?? []).filter(
        (t: TemplateView) => t.status?.toUpperCase() === "APPROVED",
      ),
    [data],
  );

  const atual = aprovados.find((t: TemplateView) => `${t.name}|${t.language}` === escolhido) ?? null;
  const pedeParametros = (atual?.slots?.length ?? 0) > 0;

  function enviar() {
    if (!atual) return;
    send.mutate(
      {
        conversation_id: conversationId,
        type: "template",
        template_name: atual.name,
        template_language: atual.language,
      },
      {
        onSuccess: () => {
          setEscolhido("");
          toast.success("Modelo enviado — a janela reabre quando o cliente responder.");
        },
        onError: (e: unknown) =>
          toast.error(e instanceof Error ? e.message : "Não consegui enviar o modelo."),
      },
    );
  }

  return (
    <div className="border-t border-amber-300 bg-amber-50/60 px-4 py-3 dark:border-amber-800/60 dark:bg-amber-950/30">
      <p className="mb-2 text-xs text-amber-900 dark:text-amber-200">{motivo}</p>

      {aprovados.length === 0 ? (
        // Sem modelo aprovado não há saída por aqui, e dizer isso é melhor que
        // um seletor vazio que se lê como "ainda não carregou".
        <p className="text-xs text-amber-900/80 dark:text-amber-200/80">
          Nenhum modelo aprovado ainda. Crie um em <strong>Conexões → Templates</strong> e envie
          quando a plataforma aprovar.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={escolhido}
            onChange={(e) => setEscolhido(e.target.value)}
            disabled={send.isPending}
            aria-label="Modelo aprovado"
            className={cn(
              "h-9 min-w-[16rem] flex-1 rounded-md border border-input bg-background px-2 text-sm",
              "focus:outline-none focus:ring-1 focus:ring-ring",
            )}
          >
            <option value="">Escolha um modelo aprovado…</option>
            {aprovados.map((t: TemplateView) => (
              <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>
                {t.name} ({t.language})
                {(t.slots?.length ?? 0) > 0 ? ` · ${t.slots.length} parâmetro(s)` : ""}
              </option>
            ))}
          </select>
          <Button type="button" size="sm" onClick={enviar} disabled={!atual || send.isPending}>
            {send.isPending ? "Enviando…" : "Enviar modelo"}
          </Button>
        </div>
      )}

      {pedeParametros && (
        // Avisa ANTES do clique: este modelo precisa de valores e este seletor
        // ainda não os coleta, então o envio vai falhar na plataforma.
        <p className="mt-2 text-[11px] text-amber-900/80 dark:text-amber-200/80">
          Este modelo pede {atual?.slots.length} valor(es) e ainda não dá para preenchê-los aqui —
          envie por <strong>Conexões → Templates</strong>, ou escolha um modelo sem parâmetros.
        </p>
      )}
    </div>
  );
}
