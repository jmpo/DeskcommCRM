import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * A CITAÇÃO EXISTIA EM TODA PARTE, MENOS ONDE ELA SAI.
 *
 * ─── O defeito, visto por quem usa ──────────────────────────────────────────
 *
 * O caminho estava inteiro: a tela deixa escolher a mensagem, o handler resolve
 * o `external_id` da citada, o banco guarda `reply_to_message_id`, e a bolha
 * aparece pendurada na original. No CRM.
 *
 * No WhatsApp do cliente chegava mensagem SOLTA. O adapter do canal por QR
 * simplesmente não lia `envelope.replyToExternalId` — o campo existia no
 * envelope, o canal intermediado já o usava, e este ignorava.
 *
 * É o pior formato de defeito deste produto: a tela promete, nada fica
 * vermelho, e quem descobre é o atendente quando o cliente responde sem
 * entender do que se fala.
 *
 * ─── O formato do id é onde isto falharia em silêncio ──────────────────────
 *
 * `reply_to` quer o id COMPLETO (`{fromMe}_{chatId}_{bareId}`). O WAHA é
 * assimétrico (ver `bareWaMessageId`): a resposta de envio devolve o cru, o
 * webhook devolve o completo. Medido numa instalação real: as 1.734 mensagens
 * de ENTRADA têm o completo — e citar o que o CLIENTE disse é o caso que
 * importa.
 */

const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  vi.unstubAllEnvs();
});

/** Captura o corpo que sai para o WAHA. */
function espiao() {
  const corpos: Record<string, unknown>[] = [];
  globalThis.fetch = vi.fn(async (_u: unknown, init?: unknown) => {
    const b = ((init ?? {}) as { body?: string }).body;
    if (b) corpos.push(JSON.parse(b) as Record<string, unknown>);
    return { ok: true, status: 200, json: async () => ({ id: "3EB0ABC" }), text: async () => "" };
  }) as unknown as typeof fetch;
  return corpos;
}

async function cliente() {
  const { WahaClient } = await import("@/lib/waha/client");
  return new WahaClient("http://waha", "chave");
}

const CITADA = "false_127904277102624@lid_3EB060A3E6B358FFFF84DC";

describe("o canal por QR manda a citação", () => {
  it("o `reply_to` sai com o id COMPLETO, como a API pede", async () => {
    const corpos = espiao();
    await (await cliente()).sendMessage("s1", "595@c.us", "hijale no recuerdo bro", CITADA);
    expect(corpos[0]?.reply_to, "a citação não saiu — chega mensagem solta").toBe(CITADA);
    expect(corpos[0]?.text).toBe("hijale no recuerdo bro");
  });

  it("sem citação, o campo NÃO vai no corpo", async () => {
    // `reply_to: null` é pedir para citar "nada". O envio comum não pode passar
    // a carregar um campo vazio só porque o outro caso existe.
    const corpos = espiao();
    await (await cliente()).sendMessage("s1", "595@c.us", "oi");
    expect(Object.keys(corpos[0] ?? {})).not.toContain("reply_to");
  });

  it("string vazia também não vira citação", async () => {
    const corpos = espiao();
    await (await cliente()).sendMessage("s1", "595@c.us", "oi", "");
    expect(Object.keys(corpos[0] ?? {})).not.toContain("reply_to");
  });
});

describe("o adapter repassa o que o envelope traz", () => {
  it("`replyToExternalId` chega ao corpo do envio", async () => {
    // O elo que faltava: o campo existia no envelope e o adapter não o lia.
    vi.stubEnv("WAHA_BASE_URL", "http://waha");
    vi.stubEnv("WAHA_API_KEY", "chave");
    const corpos = espiao();
    const { wahaAdapter } = await import("@/lib/channels/adapters/waha");
    await wahaAdapter.send({
      sessionRef: "s1",
      to: "595@c.us",
      kind: "text",
      body: "hijale no recuerdo bro",
      replyToExternalId: CITADA,
    });
    expect(corpos[0]?.reply_to, "o adapter voltou a ignorar a citação").toBe(CITADA);
  });
});
