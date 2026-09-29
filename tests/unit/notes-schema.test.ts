import { describe, expect, it } from "vitest";

import { createNoteSchema } from "@/lib/schemas/notes";

describe("createNoteSchema", () => {
  it("aceita body válido", () => {
    expect(createNoteSchema.safeParse({ body: "oi" }).success).toBe(true);
  });
  it("rejeita body vazio", () => {
    expect(createNoteSchema.safeParse({ body: "" }).success).toBe(false);
  });
  it("rejeita body gigante (>4096)", () => {
    expect(createNoteSchema.safeParse({ body: "a".repeat(4097) }).success).toBe(false);
  });

  // ── anexo (#1863, F3) ─────────────────────────────────────────────────────
  it("aceita nota SÓ de anexo — imagem colada sem legenda é o caso da issue", () => {
    const r = createNoteSchema.safeParse({
      body: "",
      anexo: { storage_path: "org/conv/note-1.png", media_mime: "image/png", media_size_bytes: 10 },
    });
    expect(r.success).toBe(true);
  });

  it("aceita nota com texto E anexo", () => {
    const r = createNoteSchema.safeParse({
      body: " print do erro",
      anexo: { storage_path: "org/conv/note-1.png", media_mime: "image/png", media_size_bytes: 10 },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.body).toBe("print do erro"); // trim como sempre
  });

  it("rejeita anexo malformado — caminho/mime/bytes são os três degraus do card", () => {
    const base = { storage_path: "org/conv/note-1.png", media_mime: "image/png", media_size_bytes: 10 };
    expect(createNoteSchema.safeParse({ body: "", anexo: { ...base, storage_path: "" } }).success).toBe(false);
    expect(createNoteSchema.safeParse({ body: "", anexo: { ...base, media_mime: "" } }).success).toBe(false);
    expect(createNoteSchema.safeParse({ body: "", anexo: { ...base, media_size_bytes: -1 } }).success).toBe(false);
    expect(createNoteSchema.safeParse({ body: "", anexo: { ...base, media_size_bytes: 1.5 } }).success).toBe(false);
    expect(createNoteSchema.safeParse({ body: "", anexo: { ...base, storage_path: "a".repeat(513) } }).success).toBe(false);
  });
});
