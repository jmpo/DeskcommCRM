"use client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const BINDINGS: { keys: string; description: string }[] = [
  { keys: "j", description: "Próxima conversa" },
  { keys: "k", description: "Conversa anterior" },
  { keys: "r", description: "Focar resposta" },
  // O atalho mais usado do inbox não estava aqui — vivia só no placeholder do
  // composer, que some no instante em que você começa a escrever, ou seja,
  // exatamente quando ia precisar dele para quebrar linha.
  { keys: "Enter", description: "Enviar a mensagem" },
  { keys: "Shift + Enter", description: "Quebrar linha sem enviar" },
  { keys: "a", description: "Assumir conversa" },
  { keys: "e", description: "Fechar conversa" },
  { keys: "?", description: "Mostrar atalhos" },
];

export function ShortcutsHelpDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Atalhos de teclado</DialogTitle>
        </DialogHeader>
        <ul className="space-y-2 text-sm">
          {BINDINGS.map((b) => (
            <li key={b.keys} className="flex items-center justify-between">
              <span className="text-muted-foreground">{b.description}</span>
              <kbd className="rounded border border-border bg-muted px-2 py-0.5 font-mono text-xs">
                {b.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
