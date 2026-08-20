"use client";
import Link from "next/link";
import { formatRelative } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChatCircle } from "@/lib/ui/icons";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Contact } from "@/lib/types/contacts";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";

interface Props {
  contacts: Contact[];
}

function displayName(c: Contact): string {
  // Era a outra tela sem telefone no fallback — e a única com "—" numa lista
  // onde a coluna ao lado já mostra o número.
  return rotuloDoContato(c);
}

export function ContactsTable({ contacts }: Props) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Nome</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Telefone</TableHead>
          <TableHead>Tags</TableHead>
          <TableHead>Última atividade</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="w-[52px]">
            <span className="sr-only">Conversa</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {contacts.map((c) => (
          <TableRow key={c.id} className="cursor-pointer">
            <TableCell className="font-medium">
              <Link href={`/app/contacts/${c.id}`} className="hover:underline">
                {displayName(c)}
              </Link>
            </TableCell>
            <TableCell className="text-muted-foreground">
              {c.email ?? "—"}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {c.phone_number ?? "—"}
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {c.tags.length === 0
                  ? <span className="text-muted-foreground text-xs">—</span>
                  : c.tags.map((t) => (
                      <Badge key={t} variant="neutral">{t}</Badge>
                    ))}
              </div>
            </TableCell>
            <TableCell className="text-muted-foreground text-sm">
              {c.last_activity_at
                ? formatRelative(new Date(c.last_activity_at), new Date(), { locale: ptBR })
                : "—"}
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {c.is_anonymized && <Badge variant="destructive">Anonimizado</Badge>}
                {c.is_blocked && <Badge variant="warning">Bloqueado</Badge>}
                {!c.is_anonymized && !c.is_blocked && (
                  <Badge variant="success">Ativo</Badge>
                )}
              </div>
            </TableCell>
            <TableCell>
              {c.conversa ? (
                <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                  <Link
                    href={`/app/inbox?id=${c.conversa.id}`}
                    title="Abrir conversa no Inbox"
                    aria-label={`Abrir conversa com ${displayName(c)} no Inbox`}
                  >
                    <ChatCircle size={16} weight="regular" aria-hidden />
                    {c.conversa.unread > 0 && (
                      <span className="sr-only">{c.conversa.unread} sem ler</span>
                    )}
                  </Link>
                </Button>
              ) : (
                <span className="text-muted-foreground text-xs" aria-hidden>
                  —
                </span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
