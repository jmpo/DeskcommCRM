"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Cadastro de fonte de conhecimento pela tela.
 *
 * O botão que existia aqui era um stub: `disabled` fixo com um toast "Em
 * breve." que, por estar desabilitado, nunca aparecia. A API
 * (POST /api/v1/ai/knowledge/sources) sempre funcionou e já aceita markdown —
 * ela mesma converte em itens de FAQ. Faltava só a tela.
 *
 * Um único campo de texto em vez de um editor de itens: o formato de duas
 * linhas por pergunta é o que alguém consegue colar de um documento que já
 * tem, e é o que a API parseia. Editor item-a-item viria depois, se pedirem.
 */
const EXEMPLO = `## Pergunta: Qual o prazo de entrega?
## Resposta: De 2 a 3 dias úteis após a confirmação do pagamento.

## Pergunta: Vocês fazem troca?
## Resposta: Sim, em até 30 dias, com o produto sem uso.`;

/**
 * Só os dois tipos cujo conteúdo colado a API ingere de fato. `conversations` e
 * `catalog` são preenchidos por pipeline (ingestão anonimizada e sincronização
 * do e-commerce) e não têm o que colar — oferecê-los aqui obrigava a mentir o
 * tipo no envio, que é o que produzia a colisão do índice único.
 */
type TipoComTextoColado = "faq" | "policy";

interface Props {
  agentId: string;
  tipo: TipoComTextoColado;
  rotulo: string;
  aberto: boolean;
  onFechar: () => void;
  onCriada: () => void;
}

export function NovaFonteDialog({ agentId, tipo, rotulo, aberto, onFechar, onCriada }: Props) {
  const [nome, setNome] = useState(`${rotulo} da loja`);
  const [conteudo, setConteudo] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function criar() {
    if (conteudo.trim().length === 0) {
      toast.error("Cole o conteúdo antes de criar.");
      return;
    }
    setEnviando(true);
    try {
      const res = await fetch("/api/v1/ai/knowledge/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: agentId,
          // O tipo escolhido é o tipo enviado. Aqui havia
          // `tipo === "policy" ? "policy" : "faq"`: "Catálogo" e "Conversas
          // opt-in" viravam `faq`, e com uma FAQ ativa o segundo insert batia
          // no índice único (agent_id, source_type) — 500 sem explicação.
          source_type: tipo,
          name: nome.trim(),
          markdown_blob: conteudo,
        }),
      });
      const json = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        toast.error(json.error?.message ?? "Não consegui criar a fonte.");
        return;
      }
      toast.success("Fonte criada. A indexação começa em instantes.");
      onCriada();
      onFechar();
    } catch {
      toast.error("Não consegui falar com o servidor.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Cadastrar {rotulo.toLowerCase()}</DialogTitle>
          <DialogDescription>
            Cole as perguntas e respostas. O agente passa a consultar isso antes de responder.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fonte-nome">Nome da fonte</Label>
            <Input id="fonte-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fonte-conteudo">Conteúdo</Label>
            <Textarea
              id="fonte-conteudo"
              rows={12}
              placeholder={EXEMPLO}
              value={conteudo}
              onChange={(e) => setConteudo(e.target.value)}
            />
            <p className="text-xs text-text-muted">
              Uma linha <code>## Pergunta:</code> e uma <code>## Resposta:</code> por item, separados
              por uma linha em branco.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={criar} disabled={enviando}>
            {enviando ? "Criando…" : "Criar fonte"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
