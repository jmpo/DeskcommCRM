"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api/client";
import { cn } from "@/lib/utils";

/**
 * As definições aprovadas do canal intermediado.
 *
 * ─── Por que esta tela não existia ─────────────────────────────────────────
 *
 * A aba "Templates da Meta" vive dentro do canal OFICIAL, e o endpoint dela
 * resolve a conexão por `metaSessionForOrg`. Numa instalação que só tem o canal
 * intermediado, o operador não tinha nem a aba nem a lista — e o seletor do
 * inbox dizia "nenhum modelo aprovado ainda" para uma conta cheia deles.
 *
 * O adapter já sabia listar, criar, editar e apagar desde que o canal entrou. O
 * que faltava era a porta.
 *
 * ─── Sincronizar é explícito, não automático ───────────────────────────────
 *
 * A lista mostra o ESPELHO — instantâneo, e é o que o resto do CRM lê. Puxar da
 * plataforma é um botão porque é chamada de rede que pode demorar, e porque
 * sincronizar sozinho ao abrir a tela esconderia a diferença entre "não tenho
 * nenhuma" e "não consegui perguntar".
 */
interface TemplateParceiro {
  name: string;
  language: string;
  status: string;
  category: string | null;
  rejectedReason: string | null;
  syncedAt: string;
}

const COR_DO_ESTADO: Record<string, string> = {
  APPROVED: "text-emerald-700 dark:text-emerald-400",
  PENDING: "text-amber-700 dark:text-amber-400",
  REJECTED: "text-destructive",
  PAUSED: "text-amber-700 dark:text-amber-400",
  DISABLED: "text-muted-foreground",
};

export function TemplatesParceiroClient() {
  const qc = useQueryClient();
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState("");
  const [idioma, setIdioma] = useState("es");
  const [corpo, setCorpo] = useState("");

  const lista = useQuery({
    queryKey: ["partner-templates"],
    queryFn: async () =>
      apiClient.get<{ data: { templates: TemplateParceiro[] } }>(
        "/api/v1/channels/partner/templates",
      ),
  });

  const acao = useMutation({
    mutationFn: async (corpoReq: Record<string, unknown>) =>
      apiClient.post<{ data: { sincronizadas: number; total: number } }>(
        "/api/v1/channels/partner/templates",
        corpoReq,
      ),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["partner-templates"] });
      // Invalida também o seletor do inbox: sem isto o operador sincroniza aqui,
      // volta à conversa e o seletor segue dizendo que não há nenhuma.
      qc.invalidateQueries({ queryKey: ["channel-templates"] });
      toast.success(`${r.data.sincronizadas} de ${r.data.total} sincronizada(s).`);
      setCriando(false);
      setNome("");
      setCorpo("");
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Não consegui falar com a plataforma."),
  });

  const templates = lista.data?.data.templates ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          O que a plataforma aprovou para este número. É daqui que sai a mensagem quando a janela de
          24h fecha.
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => acao.mutate({ acao: "sincronizar" })}
            disabled={acao.isPending}
          >
            {acao.isPending ? "Sincronizando…" : "Sincronizar"}
          </Button>
          <Button type="button" size="sm" onClick={() => setCriando((v) => !v)}>
            {criando ? "Cancelar" : "Criar modelo"}
          </Button>
        </div>
      </div>

      {criando && (
        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <div className="flex flex-wrap gap-2">
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="nome_do_modelo"
              aria-label="Nome do modelo"
              className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm"
            />
            <input
              value={idioma}
              onChange={(e) => setIdioma(e.target.value)}
              placeholder="es"
              aria-label="Idioma"
              className="h-9 w-24 rounded-md border border-input bg-background px-2 text-sm"
            />
          </div>
          <textarea
            value={corpo}
            onChange={(e) => setCorpo(e.target.value)}
            placeholder="Texto da mensagem. Use {{1}}, {{2}} para os valores que mudam."
            aria-label="Conteúdo"
            className="min-h-20 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          />
          {/* O formato do nome e o texto são validados PELA PLATAFORMA, e a
              recusa dela chega inteira ao operador. Repetir a regra aqui a faria
              envelhecer separado da fonte. */}
          <p className="text-[11px] text-muted-foreground">
            A plataforma revisa antes de aprovar — o modelo nasce pendente e some da lista de
            envio até ela decidir.
          </p>
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              disabled={!nome.trim() || !corpo.trim() || acao.isPending}
              onClick={() =>
                acao.mutate({
                  acao: "criar",
                  name: nome.trim(),
                  language: idioma.trim(),
                  category: "UTILITY",
                  components: [{ type: "BODY", text: corpo }],
                })
              }
            >
              Enviar para revisão
            </Button>
          </div>
        </div>
      )}

      {lista.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : templates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum modelo espelhado ainda. Clique em <strong>Sincronizar</strong> para trazer os que
          já existem na plataforma.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {templates.map((t) => (
            <li key={`${t.name}|${t.language}`} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="font-mono text-sm">{t.name}</span>
              <span className="text-xs text-muted-foreground">{t.language}</span>
              <span
                className={cn(
                  "ml-auto text-xs font-medium",
                  COR_DO_ESTADO[t.status?.toUpperCase()] ?? "text-muted-foreground",
                )}
              >
                {t.status}
              </span>
              {/* O motivo da recusa é o que diz o que corrigir. Sem ele o
                  operador só sabe que falhou, e tenta de novo igual. */}
              {t.rejectedReason && (
                <span className="w-full text-[11px] text-destructive">{t.rejectedReason}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
