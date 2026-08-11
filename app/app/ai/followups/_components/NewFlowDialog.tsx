"use client";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateFollowupFlow } from "@/hooks/followup/useFollowupFlows";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewFlowDialog({ open, onOpenChange }: Props) {
  const [name, setName] = useState("");
  const create = useCreateFollowupFlow();

  const [erro, setErro] = useState<string | null>(null);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    create.mutate(name.trim(), {
      onSuccess: () => {
        setName("");
        setErro(null);
        onOpenChange(false);
      },
      // Sem isto o POST podia falhar e o diálogo ficava lá, parado, sem dizer
      // nada: o usuário clica "Criar fluxo" de novo achando que não pegou. O
      // erro fica DENTRO do diálogo (não num toast que some) porque é ali que
      // ele está olhando, e o diálogo NÃO fecha — fechar apagaria o nome digitado.
      onError: (err: unknown) => {
        setErro(err instanceof Error && err.message ? err.message : "Não consegui criar o fluxo. Tente de novo.");
      },
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setName("");
          setErro(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo fluxo de follow-up</DialogTitle>
          <DialogDescription>
            Nasce como rascunho. Você monta as etapas no editor visual em seguida.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="flow-name">Nome</Label>
            <Input
              id="flow-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Recuperação de carrinho abandonado"
              maxLength={80}
              required
              autoFocus
            />
          </div>
          {erro && (
            <p role="alert" data-testid="new-flow-error" className="text-sm text-error-fg">
              {erro}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={create.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={create.isPending || name.trim().length === 0}>
              {create.isPending ? "Criando…" : "Criar fluxo"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
