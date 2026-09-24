/**
 * Os sons dos avisos da Central: qual aviso toca qual som, que só aviso NOVO
 * toca, e que o arquivo é reconhecido pelos bytes (não pela extensão).
 */
import { describe, expect, it } from "vitest";

import { farejarAudio, somDoAviso, sonsNovos } from "@/lib/notifications/sons-da-org";

const bytes = (...partes: (string | number[])[]) =>
  new Uint8Array(partes.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)).concat(Array(16).fill(0)));

describe("qual som cada aviso pede", () => {
  it("pedido de pessoa → som de pessoa; negócio na etapa que avisa → som de venda", () => {
    expect(somDoAviso({ kind: "handoff", ref_kind: "conversation" })).toBe("pessoa");
    expect(somDoAviso({ kind: "other", ref_kind: "lead" })).toBe("venda");
    expect(somDoAviso({ kind: "job_dead", ref_kind: "conversation" })).toBeNull();
    expect(somDoAviso({ kind: "other", ref_kind: "channel_session" })).toBeNull();
  });

  it("IA sem saldo no provedor → som de pessoa (as respostas param até alguém recarregar)", () => {
    expect(somDoAviso({ kind: "other", ref_kind: "ai_provider_credential" })).toBe("pessoa");
  });

  it("abrir a página com avisos antigos não toca nada", () => {
    expect(sonsNovos(null, [{ id: "a", kind: "handoff", ref_kind: null }])).toEqual([]);
  });

  it("só o aviso que não estava lá toca — e um som por tipo", () => {
    const vistos = new Set(["a"]);
    expect(
      sonsNovos(vistos, [
        { id: "a", kind: "handoff", ref_kind: null },
        { id: "b", kind: "other", ref_kind: "lead" },
        { id: "c", kind: "other", ref_kind: "lead" },
      ]),
    ).toEqual(["venda"]);
  });
});

describe("o tipo do arquivo vem dos bytes", () => {
  it("MP3 (com e sem ID3), OGG e WAV são aceitos", () => {
    expect(farejarAudio(bytes("ID3"))).toBe("audio/mpeg");
    expect(farejarAudio(bytes([0xff, 0xfb]))).toBe("audio/mpeg");
    expect(farejarAudio(bytes("OggS"))).toBe("audio/ogg");
    expect(farejarAudio(bytes("RIFF", [0, 0, 0, 0], "WAVE"))).toBe("audio/wav");
  });

  it("imagem ou texto com extensão .mp3 é recusado", () => {
    expect(farejarAudio(bytes([0x89], "PNG"))).toBeNull();
    expect(farejarAudio(bytes("hola"))).toBeNull();
  });
});
