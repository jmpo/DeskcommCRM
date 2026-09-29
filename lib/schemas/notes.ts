import { z } from "zod";

/**
 * O anexo da nota interna (#1863, F3) — trio derivado do upload, não do form.
 *
 * O arquivo JÁ subiu quando o schema roda (o composer faz upload e só depois
 * cria a nota), então aqui só se confere a FORMA: caminho dentro do tamanho que
 * o Storage aceita, mime não vazio, bytes contáveis. Quem valida mime e tamanho
 * contra a allowlist é a rota de upload — o mesmo `validateOutboundMedia` de
 * sempre, que é onde o corte tem de morar (o schema não pode deixar passar um
 * arquivo que a rota recusou, nem recusar um que ela aceitou).
 */
export const anexoDeNotaSchema = z.object({
  storage_path: z.string().min(1).max(512),
  media_mime: z.string().min(1).max(255),
  media_size_bytes: z.number().int().nonnegative(),
});

/**
 * Nota com texto OU com anexo.
 *
 * `body` sai de `min(1)` para `max(4096)` com o refinamento abaixo: a nota só
 * de anexo (imagem colada sem legenda) é o caso que a issue abre, e travar o
 * corpo em `min(1)` obrigaria o atendente a escrever "x" para anexar um PDF.
 * Sem anexo, `body` continua obrigatório — `{"body": ""}` continua rejeitado,
 * que é o que `tests/unit/notes-schema.test.ts` mede hoje.
 */
export const createNoteSchema = z
  .object({
    body: z.string().trim().max(4096),
    anexo: anexoDeNotaSchema.optional(),
  })
  .superRefine((valor, ctx) => {
    if (valor.anexo) return; // anexo sem legenda é nota válida
    if (valor.body.length === 0) {
      ctx.addIssue({ code: "custom", path: ["body"], message: "Nota sem texto e sem anexo." });
    }
  });

export type CreateNoteInput = z.infer<typeof createNoteSchema>;
