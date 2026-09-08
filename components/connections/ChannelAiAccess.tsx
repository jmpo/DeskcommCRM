"use client";

import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { aiAccessUpdateSchema, type AiAccessMode } from "@/lib/ai/elegibilidade/pre-go-live";

interface Access { mode: AiAccessMode; test_phone_numbers: string[] }

/** Mesma porta em todos os tipos de conexão; telefones acessíveis só a administradores. */
export function ChannelAiAccess({ channelId }: { channelId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ["channel-ai-access", channelId],
    queryFn: () => apiClient.get<{ data: Access }>(`/api/v1/channel-sessions/${channelId}/ai-access`),
    refetchOnWindowFocus: !open,
  });
  const mode = query.data?.data.mode;
  return (
    <div className="flex flex-col items-start gap-2">
      {mode && <Badge variant={mode === "open" ? "neutral" : "warning"}>
        {mode === "pre_go_live" ? t("IA em modo de teste") : mode === "open" ? t("IA aberta ao público") : t("IA restrita por origem")}
      </Badge>}
      {/* A frase inteira por número, e não `${n} ${t("números…")}` montado por
          pedaços: com um único testador o cartão dizia "1 números de teste
          autorizados" — achado olhando a tela, que é o único jeito de achar
          concordância. E montar por pedaços não sobrevive à tradução: em
          espanhol a forma muda junto. Lista vazia é o estado inicial de todo
          canal novo e merece a frase que diz o que fazer, não um "0". */}
      {mode === "pre_go_live" && <p className="text-xs text-muted-foreground">
        {(() => {
          const n = query.data?.data.test_phone_numbers.length ?? 0;
          if (n === 0) return t("Nenhum número autorizado — a IA não responde ninguém neste canal.");
          if (n === 1) return t("1 número de teste autorizado");
          return `${n} ${t("números de teste autorizados")}`;
        })()}
      </p>}
      <Button variant="outline" size="sm" onClick={() => { setOpen(true); void query.refetch(); }}>
        {t("Configurar acesso da IA")}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex w-full flex-col gap-6 overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{t("Acesso da IA no WhatsApp")}</SheetTitle>
            <SheetDescription>{t("Teste com pessoas de confiança antes de liberar o atendimento automático.")}</SheetDescription>
          </SheetHeader>
          {query.isFetching ? <p role="status">{t("Carregando…")}</p> : query.isError ? (
            <div className="flex flex-col gap-3" role="alert">
              <p>{t("Não foi possível carregar o acesso da IA.")}</p>
              <Button variant="outline" onClick={() => void query.refetch()}>{t("Tentar novamente")}</Button>
            </div>
          ) : open && query.data ? (
            <AccessForm channelId={channelId} initial={query.data.data} onClose={() => setOpen(false)} />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function AccessForm({ channelId, initial, onClose }: { channelId: string; initial: Access; onClose: () => void }) {
  const t = useT();
  const id = useId();
  const qc = useQueryClient();
  const [numbers, setNumbers] = useState(initial.test_phone_numbers.join("\n"));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function save(mode: "open" | "pre_go_live") {
    const parsed = aiAccessUpdateSchema.safeParse({
      mode, test_phone_numbers: numbers.split("\n").map(n => n.trim()).filter(Boolean),
    });
    if (!parsed.success) {
      setError(t("Use um telefone com DDI por linha, por exemplo +5511999998888."));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await apiClient.patch<{ data: Access }>(`/api/v1/channel-sessions/${channelId}/ai-access`, parsed.data);
      qc.setQueryData(["channel-ai-access", channelId], saved);
      toast.success(t("Acesso da IA atualizado."));
      onClose();
    } catch {
      setError(t("Não foi possível confirmar o salvamento. Reabra este painel para conferir a configuração."));
    } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Badge variant={initial.mode === "open" ? "neutral" : "warning"}>
          {initial.mode === "pre_go_live" ? t("IA em modo de teste") : initial.mode === "open" ? t("IA aberta ao público") : t("IA restrita por origem")}
        </Badge>
        <p className="text-sm text-muted-foreground">
          {initial.mode === "pre_go_live"
            ? t("Somente os números desta lista podem receber respostas automáticas neste canal.")
            : initial.mode === "open"
              ? t("A lista de teste não restringe o atendimento enquanto a IA está aberta ao público.")
              : t("Este canal usa autorizações por origem. Ativar o modo de teste substitui essa regra pela lista abaixo.")}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={id}>{t("Números autorizados para teste")}</Label>
        <Textarea id={id} rows={6} value={numbers} disabled={busy}
          onChange={e => { setNumbers(e.target.value); setError(null); }}
          aria-invalid={Boolean(error)} aria-describedby={`${id}-help`}
          placeholder="+5511999998888" />
        <p id={`${id}-help`} className="text-sm text-muted-foreground">
          {t("Um telefone com DDI por linha. Lista vazia no modo de teste bloqueia todas as respostas automáticas.")}
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        {t("As mensagens continuam chegando ao Inbox, e sua equipe pode responder manualmente. Os testes são mensagens reais no WhatsApp, com os custos normais de uso.")}
      </p>
      <p className="text-sm text-muted-foreground">
        {t("O agente precisa estar publicado e vinculado a este canal. Bloqueios do contato e atendimento humano continuam sendo respeitados.")}
      </p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => void save("pre_go_live")}>
          {busy ? t("Salvando…") : initial.mode === "pre_go_live" ? t("Salvar lista de teste") : t("Ativar modo de teste")}
        </Button>
        {initial.mode !== "open" && <Button variant="outline" disabled={busy} onClick={() => setConfirmOpen(true)}>
          {t("Liberar atendimento ao público")}
        </Button>}
        <Button variant="ghost" disabled={busy} onClick={onClose}>{t("Cancelar")}</Button>
      </div>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Liberar a IA para o público?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("A lista de teste deixará de limitar as respostas. A IA poderá atender qualquer pessoa que enviar mensagem neste canal, respeitando os demais bloqueios.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Continuar em teste")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void save("open")}>{t("Confirmar liberação")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
