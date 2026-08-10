"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api/client";
import { contarVariaveis, lerConteudo, montarComponents } from "@/lib/channels/template-conteudo";
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
  components: unknown[];
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
  const [categoria, setCategoria] = useState("UTILITY");
  const [corpo, setCorpo] = useState("");
  const [rodape, setRodape] = useState("");
  const [exemplos, setExemplos] = useState<string[]>([]);
  const [aberto, setAberto] = useState<string | null>(null);

  // Quantas amostras a revisão vai exigir. Recalculado enquanto se digita: o
  // operador vê o campo aparecer no instante em que escreve `{{1}}`, e não
  // descobre a exigência numa recusa que chega horas depois.
  const nVariaveis = contarVariaveis(corpo);

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
          {/* A CATEGORIA é obrigatória no contrato e não era oferecida: tudo
              saía como UTILITY. Mandar promoção como utility é reclassificado
              (ou recusado) pela revisão — e a tarifa da categoria errada é mais
              cara. O padrão continua UTILITY porque é o caso comum de
              atendimento, mas agora é escolha. */}
          <select
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            aria-label="Categoria"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="UTILITY">Utilidade — aviso de pedido, agendamento, cobrança</option>
            <option value="MARKETING">Marketing — promoção, novidade, reengajamento</option>
            <option value="AUTHENTICATION">Autenticação — código de verificação</option>
          </select>

          <textarea
            value={corpo}
            onChange={(e) => setCorpo(e.target.value)}
            placeholder="Texto da mensagem. Use {{1}}, {{2}} para os valores que mudam."
            aria-label="Conteúdo"
            className="min-h-20 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          />

          <input
            value={rodape}
            onChange={(e) => setRodape(e.target.value)}
            placeholder="Rodapé (opcional) — texto pequeno no fim da mensagem"
            aria-label="Rodapé"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          />

          {nVariaveis > 0 && (
            /* ESTE É O CAMPO QUE FALTAVA, e a causa das recusas.
               A revisão exige uma AMOSTRA de cada `{{n}}` — sem ela a definição
               é recusada, e a recusa chega horas depois sem ninguém ligar uma
               coisa à outra. O formulário deixava digitar `{{1}}` e nunca
               pedia o exemplo. */
            <div className="flex flex-col gap-1.5 rounded-md border border-amber-300 bg-amber-50/50 p-2 dark:border-amber-800/60 dark:bg-amber-950/20">
              <p className="text-[11px] text-amber-900 dark:text-amber-200">
                A revisão exige um exemplo de cada valor. Sem eles o modelo é recusado.
              </p>
              {Array.from({ length: nVariaveis }, (_, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">
                    {`{{${i + 1}}}`}
                  </span>
                  <input
                    value={exemplos[i] ?? ""}
                    onChange={(e) => {
                      const proximo = [...exemplos];
                      proximo[i] = e.target.value;
                      setExemplos(proximo);
                    }}
                    placeholder="ex.: María"
                    aria-label={`Exemplo do valor ${i + 1}`}
                    className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                  />
                </div>
              ))}
            </div>
          )}

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
                  category: categoria,
                  components: montarComponents({ body: corpo, footer: rodape, exemplos }),
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
          {templates.map((t) => {
            const chave = `${t.name}|${t.language}`;
            const c = lerConteudo(t.components);
            const expandido = aberto === chave;
            return (
              <li key={chave} className="px-3 py-2">
                {/* A linha inteira ABRE o conteúdo. Ver "APPROVED" sem ver o
                    texto obriga a abrir a plataforma para saber o que a
                    definição diz — e é o texto que decide qual mandar. */}
                <button
                  type="button"
                  onClick={() => setAberto(expandido ? null : chave)}
                  className="flex w-full flex-wrap items-center gap-2 text-left"
                  aria-expanded={expandido}
                >
                  <span className="font-mono text-sm">{t.name}</span>
                  <span className="text-xs text-muted-foreground">{t.language}</span>
                  {t.category && (
                    <span className="rounded bg-muted px-1.5 text-[10px] uppercase text-muted-foreground">
                      {t.category}
                    </span>
                  )}
                  {c.variaveis > 0 && (
                    <span className="text-[10px] text-muted-foreground">
                      {c.variaveis} valor(es)
                    </span>
                  )}
                  <span
                    className={cn(
                      "ml-auto text-xs font-medium",
                      COR_DO_ESTADO[t.status?.toUpperCase()] ?? "text-muted-foreground",
                    )}
                  >
                    {t.status}
                  </span>
                </button>

                {/* O motivo da recusa é o que diz o que corrigir, e fica SEMPRE
                    à vista — não escondido atrás do clique: quem precisa dele
                    não sabe que precisa procurar. */}
                {t.rejectedReason && (
                  <p className="mt-1 text-[11px] text-destructive">{t.rejectedReason}</p>
                )}

                {expandido && (
                  <div className="mt-2 flex flex-col gap-1.5 rounded-md bg-muted/40 p-2 text-sm">
                    {c.header && (
                      <p className="text-xs">
                        <span className="text-muted-foreground">Cabeçalho ({c.header.formato}): </span>
                        {c.header.texto ?? <em className="text-muted-foreground">mídia</em>}
                      </p>
                    )}
                    {c.body ? (
                      <p className="whitespace-pre-wrap">{c.body}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Sem corpo espelhado — sincronize para trazer o conteúdo.
                      </p>
                    )}
                    {c.footer && <p className="text-xs text-muted-foreground">{c.footer}</p>}
                    {c.botoes.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {c.botoes.map((b, i) => (
                          <span key={i} className="rounded border border-border px-1.5 text-[11px]">
                            {b.texto} <span className="text-muted-foreground">({b.tipo})</span>
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="text-[10px] text-muted-foreground">
                      Sincronizado em {new Date(t.syncedAt).toLocaleString("pt-BR")}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
