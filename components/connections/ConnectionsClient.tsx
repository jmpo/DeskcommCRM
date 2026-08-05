"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import {
  useChannelSessions,
  type ChannelSession,
} from "@/hooks/channels/useChannelSessions";
import { usePacingKnobs } from "@/hooks/channels/usePacingKnobs";
import { AntiBanSheet } from "./AntiBanSheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  ArrowsClockwise,
  CheckCircle,
  CircleNotch,
  Phone,
  Plus,
  ShieldCheck,
  Trash,
} from "@/lib/ui/icons";

type Variant = "success" | "warning" | "error" | "neutral";

const STATUS_MAP: Record<string, { label: string; variant: Variant }> = {
  WORKING: { label: "Conectado", variant: "success" },
  SCAN_QR_CODE: { label: "Escaneie o QR", variant: "warning" },
  STARTING: { label: "Conectando…", variant: "warning" },
  STOPPED: { label: "Parado", variant: "error" },
  FAILED: { label: "Caiu", variant: "error" },
};

function statusInfo(status: string): { label: string; variant: Variant } {
  return STATUS_MAP[status] ?? { label: status, variant: "neutral" };
}

function channelLabel(c: ChannelSession): string {
  return c.display_name || c.phone_number || c.waha_session_name;
}

function errMsg(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.message ? err.message : fallback;
}

export function ConnectionsClient({ wahaConfigured }: { wahaConfigured: boolean }) {
  const qc = useQueryClient();
  const { data: sessions, isLoading } = useChannelSessions({ refetchInterval: 10_000 });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [qr, setQr] = useState<{ sessionId: string; title: string } | null>(null);
  const [antiBanId, setAntiBanId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<ChannelSession | null>(null);
  const [deleting, setDeleting] = useState(false);
  const pacingItems = usePacingKnobs().data?.items ?? [];

  const invalidate = useCallback(
    () => qc.invalidateQueries({ queryKey: ["channel-sessions"] }),
    [qc],
  );

  // Health check ao vivo de todos os canais — consulta o WAHA e grava
  // last_health_check_at. É a verificação de saúde de verdade (o status do DB
  // pode estar velho se o WAHA caiu sem emitir evento).
  const runHealthCheck = useCallback(
    async (list: ChannelSession[]) => {
      if (!wahaConfigured || list.length === 0) return;
      setChecking(true);
      try {
        await Promise.allSettled(
          list.map((c) => apiClient.get(`/api/v1/channel-sessions/${c.id}`)),
        );
        invalidate();
      } finally {
        setChecking(false);
      }
    },
    [wahaConfigured, invalidate],
  );

  const didInitialCheck = useRef(false);
  useEffect(() => {
    if (didInitialCheck.current || !sessions || sessions.length === 0) return;
    didInitialCheck.current = true;
    void runHealthCheck(sessions);
  }, [sessions, runHealthCheck]);

  const handleConnectNew = useCallback(async () => {
    setCreating(true);
    try {
      const res = await apiClient.post<{ data: ChannelSession }>(
        "/api/v1/channel-sessions",
        {},
      );
      invalidate();
      setQr({ sessionId: res.data.id, title: "Conectar novo WhatsApp" });
    } catch (err) {
      toast.error(errMsg(err, "Não foi possível iniciar a conexão."));
    } finally {
      setCreating(false);
    }
  }, [invalidate]);

  // `force` descarta a credencial pareada e obriga um QR novo. Fica fora do
  // caminho normal porque a maioria das quedas é passageira e volta sozinha —
  // só quem já viu o modo suave falhar deveria pagar um reescaneamento.
  const handleReconnect = useCallback(
    async (c: ChannelSession, force = false) => {
      setBusyId(c.id);
      try {
        await apiClient.post(`/api/v1/channel-sessions/${c.id}/reconnect`, { force });
        invalidate();
        setQr({ sessionId: c.id, title: `Reconectar ${channelLabel(c)}` });
      } catch (err) {
        toast.error(errMsg(err, "Não foi possível reconectar."));
      } finally {
        setBusyId(null);
      }
    },
    [invalidate],
  );

  const forcePair = useCallback(
    async (sessionId: string) => {
      await apiClient.post(`/api/v1/channel-sessions/${sessionId}/reconnect`, { force: true });
      invalidate();
    },
    [invalidate],
  );

  const handleDelete = useCallback(async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      const res = await apiClient.delete<{
        data: { archived: boolean; conversations_preserved: number };
      }>(`/api/v1/channel-sessions/${toDelete.id}`);
      // Arquivado ≠ apagado: o número sai da lista, mas o histórico de
      // atendimento continua no inbox. Dizer isso evita o susto de achar que as
      // conversas foram embora junto.
      toast.success(
        res.data.archived
          ? `Canal removido. ${res.data.conversations_preserved} conversa(s) foram preservadas no inbox.`
          : "Canal excluído.",
      );
      setToDelete(null);
      invalidate();
    } catch (err) {
      toast.error(errMsg(err, "Não foi possível excluir o canal."));
    } finally {
      setDeleting(false);
    }
  }, [toDelete, invalidate]);

  const handleConnected = useCallback(() => {
    toast.success("WhatsApp conectado!");
    setQr(null);
    invalidate();
  }, [invalidate]);

  const list = sessions ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {list.length === 0
            ? "Nenhum número conectado ainda."
            : `${list.length} ${list.length === 1 ? "número conectado" : "números conectados"}.`}
        </p>
        <div className="flex gap-2">
          {list.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              disabled={checking || !wahaConfigured}
              onClick={() => void runHealthCheck(list)}
            >
              <ArrowsClockwise
                size={14}
                className={checking ? "animate-spin" : undefined}
                aria-hidden
              />
              Atualizar saúde
            </Button>
          )}
          <Button size="sm" disabled={creating || !wahaConfigured} onClick={handleConnectNew}>
            {creating ? (
              <CircleNotch size={14} className="animate-spin" aria-hidden />
            ) : (
              <Plus size={14} aria-hidden />
            )}
            Conectar novo WhatsApp
          </Button>
        </div>
      </div>

      {!wahaConfigured && (
        <div className="rounded-md border border-warning bg-warning-bg p-4 text-sm text-warning-fg">
          <p className="font-medium">O serviço do WhatsApp não está ativo.</p>
          <p className="mt-1">
            Suba o container (<code>docker compose up -d waha</code>) para conectar e reconectar números.
          </p>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando conexões…</p>
      ) : list.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <Phone size={28} className="text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">
            Conecte seu primeiro número de WhatsApp para começar a atender.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {list.map((c) => {
            const info = statusInfo(c.status);
            return (
              <Card key={c.id} className="flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Phone size={16} className="text-muted-foreground" aria-hidden />
                      <span className="truncate text-sm font-medium">{channelLabel(c)}</span>
                    </div>
                    {c.phone_number && c.display_name && (
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                        {c.phone_number}
                      </p>
                    )}
                  </div>
                  <Badge variant={info.variant}>{info.label}</Badge>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {c.last_health_check_at
                    ? `Verificado ${new Date(c.last_health_check_at).toLocaleString("pt-BR")}`
                    : "Ainda não verificado"}
                </p>
                <div className="mt-auto flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyId === c.id || !wahaConfigured}
                    onClick={() => handleReconnect(c)}
                  >
                    {busyId === c.id ? (
                      <CircleNotch size={14} className="animate-spin" aria-hidden />
                    ) : (
                      <ArrowsClockwise size={14} aria-hidden />
                    )}
                    Reconectar
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setAntiBanId(c.id)}>
                    <ShieldCheck size={14} aria-hidden />
                    Proteção de envio
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Excluir ${channelLabel(c)}`}
                    onClick={() => setToDelete(c)}
                  >
                    <Trash size={14} aria-hidden />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <AntiBanSheet
        item={pacingItems.find((i) => i.channel_session.id === antiBanId) ?? null}
        canWrite
        onClose={() => setAntiBanId(null)}
      />

      <Dialog open={!!toDelete} onOpenChange={(o) => !o && !deleting && setToDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Excluir {toDelete ? channelLabel(toDelete) : "canal"}?</DialogTitle>
            <DialogDescription>
              O número será desconectado do WhatsApp e sairá desta lista. As conversas e
              mensagens já recebidas continuam no inbox — só o canal é removido. Para voltar a
              usar este número, será preciso conectar e escanear o QR de novo.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" disabled={deleting} onClick={() => setToDelete(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={handleDelete}>
              {deleting ? (
                <CircleNotch size={14} className="animate-spin" aria-hidden />
              ) : (
                <Trash size={14} aria-hidden />
              )}
              Excluir
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {qr && (
        <QrDialog
          sessionId={qr.sessionId}
          title={qr.title}
          wahaConfigured={wahaConfigured}
          onClose={() => setQr(null)}
          onConnected={handleConnected}
          onForcePair={forcePair}
        />
      )}
    </div>
  );
}

function QrDialog({
  sessionId,
  title,
  wahaConfigured,
  onClose,
  onConnected,
  onForcePair,
}: {
  sessionId: string;
  title: string;
  wahaConfigured: boolean;
  onClose: () => void;
  onConnected: () => void;
  onForcePair: (sessionId: string) => Promise<void>;
}) {
  const [status, setStatus] = useState<string>("STARTING");
  const [tick, setTick] = useState(0);
  const [pairing, setPairing] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    if (!wahaConfigured) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await apiClient.get<{ data: { status: string } }>(
          `/api/v1/channel-sessions/${sessionId}`,
        );
        if (cancelled) return;
        const s = res.data.status;
        setStatus(s);
        if (s === "WORKING" && !done.current) {
          done.current = true;
          onConnected();
        }
      } catch {
        // erro transitório de rede — o próximo tick tenta de novo
      }
    };
    void poll();
    const iv = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [sessionId, wahaConfigured, onConnected]);

  // O QR do WhatsApp EXPIRA — medido no WAHA, a imagem muda a cada ~20s. Carregar
  // uma vez só (o que esta tela fazia) deixava um código morto na tela: quem
  // demorasse a pegar o celular escaneava algo que o WhatsApp já tinha
  // invalidado. Recarregamos a cada 15s enquanto estivermos em SCAN_QR_CODE,
  // com folga sobre a expiração.
  // A primeira imagem não precisa de tick novo: o <img> só é montado quando o
  // status vira SCAN_QR_CODE, e essa montagem já busca o QR do momento. O
  // intervalo cuida só das renovações seguintes.
  useEffect(() => {
    if (status !== "SCAN_QR_CODE") return;
    const iv = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(iv);
  }, [status]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            No celular: WhatsApp → Aparelhos conectados → Conectar um aparelho → escaneie o código.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-[16rem] flex-col items-center justify-center gap-3 py-2">
          {status === "SCAN_QR_CODE" ? (
            // Sem `key={tick}`: trocar só o src reaproveita o mesmo <img>, e o
            // browser segura o frame anterior até decodificar o novo. Remontar o
            // elemento a cada refresh é o que causaria o flash branco.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/v1/channel-sessions/${sessionId}/qr?t=${tick}`}
              alt="QR Code para conectar WhatsApp"
              className="h-64 w-64 rounded-md border bg-white p-2"
            />
          ) : status === "WORKING" ? (
            <div className="flex flex-col items-center gap-2 text-sm font-medium text-success-fg">
              <CheckCircle size={28} weight="fill" aria-hidden />
              Conectado!
            </div>
          ) : status === "FAILED" || status === "STOPPED" ? (
            // Chegar aqui quase sempre significa credencial revogada: o número
            // foi desvinculado pelo celular e o engine não tem como voltar
            // sozinho. Antes esta tela era um beco sem saída ("tente
            // Reconectar" levava de volta ao mesmo FAILED); agora ela oferece a
            // única ação que de fato resolve.
            <div className="flex flex-col items-center gap-3 text-center">
              <p className="text-sm text-error-fg">
                Este número foi desvinculado do WhatsApp. Para usá-lo de novo é preciso parear
                outra vez.
              </p>
              <Button
                size="sm"
                disabled={pairing}
                onClick={async () => {
                  setPairing(true);
                  try {
                    await onForcePair(sessionId);
                    setStatus("STARTING");
                  } catch (err) {
                    toast.error(errMsg(err, "Não foi possível gerar um novo QR."));
                  } finally {
                    setPairing(false);
                  }
                }}
              >
                {pairing ? (
                  <CircleNotch size={14} className="animate-spin" aria-hidden />
                ) : (
                  <ArrowsClockwise size={14} aria-hidden />
                )}
                Gerar novo QR
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
              <CircleNotch size={28} className="animate-spin" aria-hidden />
              Preparando o código…
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
