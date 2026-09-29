"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { Note } from "@/lib/types/messaging";

/** O trio que a rota de upload devolveu — é o corpo da nota, não uma mensagem. */
export interface AnexoDeNota {
  storage_path: string;
  media_mime: string;
  media_size_bytes: number;
}

interface CreateNoteArgs {
  conversation_id: string;
  body: string;
  /** Presente quando a nota nasceu com anexo (imagem colada, arquivo escolhido). */
  anexo?: AnexoDeNota;
}

export function useCreateNote() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ conversation_id, body, anexo }: CreateNoteArgs) =>
      apiClient.post<{ data: Note }>(`/api/v1/conversations/${conversation_id}/notes`, {
        body,
        ...(anexo ? { anexo } : {}),
      }),
    onSuccess: (_res, args) => {
      qc.invalidateQueries({ queryKey: ["notes", args.conversation_id] });
    },
    onError: showApiError,
  });
}
