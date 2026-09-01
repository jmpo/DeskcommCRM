import { describe, expect, it, vi } from "vitest";

// ingest.ts importa @/lib/audit (→ supabase/server → validação de env); a função
// testada aqui é isolada, mock corta a cadeia (mesmo padrão de waha-ingest-media.test.ts).
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

import {
  HUMAN_TAKEOVER_SILENCE_MS,
  silenciarBotPorRetomadaHumana,
  type Admin,
} from "@/lib/waha/ingest";

const ORG_ID = "23fe2ca9-7316-45eb-8b09-d607cb9696eb";
const CONV_ID = "beaa6819-72f8-4a7c-80c0-75d2a033b564";

/**
 * Dublê mínimo do client Supabase admin — só o suficiente para o caminho
 * `.from("conversations").select(...).eq().eq().maybeSingle()` (leitura) e
 * `.from("conversations").update(...).eq().eq()` (escrita, thenable direto, sem
 * `.select()`/`.single()` — o código não lê a linha de volta).
 */
function fakeAdmin(opts: {
  existing?: string | null;
  selectError?: { message: string };
  updateError?: { message: string };
  onUpdate?: (patch: Record<string, unknown>) => void;
}): Admin {
  const selectChain = {
    eq: () => selectChain,
    maybeSingle: () =>
      Promise.resolve(
        opts.selectError
          ? { data: null, error: opts.selectError }
          : { data: { bot_silenced_until: opts.existing ?? null }, error: null },
      ),
  };
  const updateChain = {
    eq: () => updateChain,
    then: (resolve: (v: { error: { message: string } | null }) => unknown) =>
      Promise.resolve({ error: opts.updateError ?? null }).then(resolve),
  };
  return {
    from: () => ({
      select: () => selectChain,
      update: (patch: Record<string, unknown>) => {
        opts.onUpdate?.(patch);
        return updateChain;
      },
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/**
 * `silenciarBotPorRetomadaHumana` — ver docstring em `lib/waha/ingest.ts`. Cobre a
 * lacuna medida em produção (tenant YADEA): um humano respondeu direto pelo
 * WhatsApp, o bot não foi silenciado, e na mensagem seguinte do lead voltou a
 * rodar sozinho, alucinando sobre algo que só o humano tinha tratado (PIX).
 */
describe("silenciarBotPorRetomadaHumana", () => {
  it("sem silêncio prévio, grava bot_silenced_until = agora + HUMAN_TAKEOVER_SILENCE_MS", async () => {
    let patchGravado: Record<string, unknown> | null = null;
    const antes = Date.now();
    await silenciarBotPorRetomadaHumana(
      fakeAdmin({ existing: null, onUpdate: (p) => (patchGravado = p) }),
      ORG_ID,
      CONV_ID,
    );
    expect(patchGravado).not.toBeNull();
    const gravado = new Date((patchGravado as unknown as { bot_silenced_until: string }).bot_silenced_until).getTime();
    expect(gravado).toBeGreaterThanOrEqual(antes + HUMAN_TAKEOVER_SILENCE_MS - 1000);
    expect(gravado).toBeLessThanOrEqual(Date.now() + HUMAN_TAKEOVER_SILENCE_MS + 1000);
  });

  it("silêncio 'infinity' (handoff formal) NUNCA é encurtado", async () => {
    let chamouUpdate = false;
    await silenciarBotPorRetomadaHumana(
      fakeAdmin({ existing: "infinity", onUpdate: () => (chamouUpdate = true) }),
      ORG_ID,
      CONV_ID,
    );
    expect(chamouUpdate).toBe(false);
  });

  it("silêncio mais longo já em vigor (ex.: handoff manual de 6h) não é encurtado pras 3h padrão", async () => {
    let chamouUpdate = false;
    const daquiA6h = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
    await silenciarBotPorRetomadaHumana(
      fakeAdmin({ existing: daquiA6h, onUpdate: () => (chamouUpdate = true) }),
      ORG_ID,
      CONV_ID,
    );
    expect(chamouUpdate).toBe(false);
  });

  it("silêncio mais curto já vencido (ou no passado) É estendido pra janela padrão", async () => {
    let chamouUpdate = false;
    const jaPassou = new Date(Date.now() - 60_000).toISOString();
    await silenciarBotPorRetomadaHumana(
      fakeAdmin({ existing: jaPassou, onUpdate: () => (chamouUpdate = true) }),
      ORG_ID,
      CONV_ID,
    );
    expect(chamouUpdate).toBe(true);
  });

  it("falha de leitura não lança — best-effort, só loga", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      silenciarBotPorRetomadaHumana(fakeAdmin({ selectError: { message: "boom" } }), ORG_ID, CONV_ID),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("falha de escrita não lança — best-effort, só loga", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      silenciarBotPorRetomadaHumana(fakeAdmin({ existing: null, updateError: { message: "boom" } }), ORG_ID, CONV_ID),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
