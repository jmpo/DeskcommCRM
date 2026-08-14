"use client";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Plus } from "@/lib/ui/icons";
import {
  useUpdateConversationTags,
  useConversationTagVocabulary,
} from "@/hooks/inbox/useConversationTags";

interface Props {
  conversationId: string;
  orgId: string;
  tags: string[];
}

/** G3-05: aplica/remove tags de atendimento na conversa, com sugestão canônica. */
export function ConversationTagsEditor({ conversationId, orgId, tags }: Props) {
  const [draft, setDraft] = useState("");
  const mutation = useUpdateConversationTags();
  const { data: vocabulary } = useConversationTagVocabulary(orgId);

  // Normalização espelha o Zod do PATCH (trim+lowercase); dedup no set.
  function apply(next: string[]) {
    mutation.mutate({ conversation_id: conversationId, tags: next });
  }

  function add(raw: string) {
    const tag = raw.trim().toLowerCase().slice(0, 40);
    if (!tag || tags.includes(tag) || tags.length >= 20) return;
    apply([...tags, tag]);
    setDraft("");
  }

  function remove(tag: string) {
    apply(tags.filter((t) => t !== tag));
  }

  const suggestions = (vocabulary ?? []).filter((t) => !tags.includes(t)).slice(0, 8);

  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Tags da conversa
      </h3>

      <div className="mt-2 flex flex-wrap gap-1">
        {tags.length > 0 ? (
          tags.map((t) => (
            <Badge key={t} variant="secondary" className="h-5 gap-1 px-1.5 text-[10px]">
              {t}
              <button
                type="button"
                onClick={() => remove(t)}
                disabled={mutation.isPending}
                aria-label={`Remover tag ${t}`}
                className="rounded-sm hover:text-destructive"
              >
                <X size={10} weight="bold" aria-hidden />
              </button>
            </Badge>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">Sem tags.</span>
        )}
      </div>

      <div className="mt-2 flex gap-1">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            }
          }}
          placeholder="Nova tag…"
          maxLength={40}
          disabled={mutation.isPending || tags.length >= 20}
          className="h-7 [@media(hover:none)]:h-9 text-xs"
          aria-label="Adicionar tag à conversa"
        />
        <Button
          size="sm"
          variant="outline"
          className="h-7 [@media(hover:none)]:h-9 px-2"
          onClick={() => add(draft)}
          disabled={mutation.isPending || !draft.trim() || tags.length >= 20}
          aria-label="Adicionar tag"
        >
          <Plus size={12} weight="regular" aria-hidden />
        </Button>
      </div>

      {suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {suggestions.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => add(t)}
              disabled={mutation.isPending || tags.length >= 20}
              className="rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:border-solid hover:text-foreground disabled:opacity-50"
            >
              + {t}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
