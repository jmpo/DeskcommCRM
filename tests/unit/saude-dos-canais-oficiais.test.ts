import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * OS CANAIS OFICIAIS ERAM CEGOS À PRÓPRIA QUEDA.
 *
 * ─── O defeito ──────────────────────────────────────────────────────────────
 *
 * Só o canal por QR implementava `checkHealth`. O cron de saúde faz
 * `if (!adapter.checkHealth || !sessionRef) continue` — então a sessão oficial
 * era PULADA, sem log e sem contador, e `channel_sessions.status` só era escrito
 * no instante de conectar. Chave revogada, número suspenso ou permissão retirada
 * viravam silêncio absoluto, para sempre, com a tela dizendo "conectado".
 *
 * O canal intermediado tinha meia visão: traduz os avisos que o provedor
 * EMPURRA (`account.disconnected`, `number.suspended`). Cego mesmo ele era para
 * a falha CALADA — que é a única que ninguém percebe sozinho, e por isso a que
 * mais importa.
 *
 * ─── Por que quase todo caso é sobre DISTINGUIR desfechos ───────────────────
 *
 * A tentação é devolver "caiu" sempre que algo dá errado. Só que oscilação de
 * rede virando "canal caído" ensina o operador a ignorar o aviso — e um aviso
 * ignorado é pior que nenhum, porque dá a sensação de cobertura. Por isso
 * "não sei" (`reachable: false`) é um desfecho de primeira classe, distinto de
 * "sei que caiu" (`status: FAILED`).
 */

const zernioCreds = vi.fn(async () => ({
  accountId: "conta-1",
  apiKey: "chave",
  baseUrl: "https://z.example",
  source: "session" as const,
}));
const metaCreds = vi.fn(async () => ({ phoneNumberId: "555", token: "tok" }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) as never }));
vi.mock("@/lib/channels/zernio/credentials", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  resolveZernioCreds: (...a: unknown[]) => zernioCreds(...(a as [])),
}));
vi.mock("@/lib/channels/meta/credentials", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  resolveMetaCreds: (...a: unknown[]) => metaCreds(...(a as [])),
}));

function respondeCom(body: unknown, init: { status?: number } = {}) {
  const status = init.status ?? 200;
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
  })) as unknown as typeof fetch;
}

const fetchOriginal = globalThis.fetch;

beforeEach(() => {
  zernioCreds.mockClear();
  metaCreds.mockClear();
});
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

describe("canal intermediado", () => {
  async function saude() {
    const { zernioAdapter } = await import("@/lib/channels/adapters/zernio");
    return zernioAdapter.checkHealth!({ sessionRef: "conta-1" });
  }

  it("conta na lista → está de pé", async () => {
    globalThis.fetch = respondeCom({ accounts: [{ _id: "conta-1", platform: "whatsapp" }] });
    expect(await saude()).toEqual({ reachable: true, status: "WORKING", detail: null });
  });

  it("chave recusada → FAILED, que é a falha calada que se procura", async () => {
    // Token revogado responde 401 e mais nada acontece: nenhum webhook avisa,
    // nenhuma tela muda. É exatamente o caso que motivou este método.
    globalThis.fetch = respondeCom({}, { status: 401 });
    expect(await saude()).toMatchObject({ reachable: true, status: "FAILED" });
  });

  it("chave válida mas conta sumiu da lista → STOPPED, não FAILED", async () => {
    // São coisas diferentes e o operador faz coisas diferentes: credencial
    // recusada se troca, conta removida se reconecta. Um status só para os dois
    // mandaria metade das pessoas para o lugar errado.
    globalThis.fetch = respondeCom({ accounts: [{ _id: "outra-conta" }] });
    expect(await saude()).toMatchObject({ reachable: true, status: "STOPPED" });
  });

  it("casa a conta por `_id` OU `id` — a API usa os dois", async () => {
    globalThis.fetch = respondeCom({ accounts: [{ id: "conta-1" }] });
    expect(await saude()).toMatchObject({ status: "WORKING" });
  });

  it("rede caída é NÃO SEI, nunca 'canal caído'", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    const r = await saude();
    expect(r.reachable, "uma oscilação de rede virou queda de canal").toBe(false);
    expect(r.status, "inventou um status que não mediu").toBeNull();
  });

  it("erro inesperado do provedor também é NÃO SEI", async () => {
    // 500 do lado deles não diz nada sobre a nossa credencial.
    globalThis.fetch = respondeCom({}, { status: 503 });
    expect(await saude()).toMatchObject({ reachable: false, status: null });
  });

  it("sessão sem credencial não vira alarme de queda", async () => {
    zernioCreds.mockResolvedValue(null as never);
    expect(await saude()).toMatchObject({ reachable: false, status: null });
  });
});

describe("canal oficial direto", () => {
  async function saude() {
    const { metaCloudAdapter } = await import("@/lib/channels/adapters/meta-cloud");
    return metaCloudAdapter.checkHealth!({ sessionRef: "555" });
  }

  it("número responde → está de pé", async () => {
    globalThis.fetch = respondeCom({ display_phone_number: "+595..." });
    expect(await saude()).toEqual({ reachable: true, status: "WORKING", detail: null });
  });

  it("token recusado → FAILED", async () => {
    globalThis.fetch = respondeCom({}, { status: 401 });
    expect(await saude()).toMatchObject({ reachable: true, status: "FAILED" });
  });

  it("erro no CORPO com HTTP 200 também é FAILED", async () => {
    // Comportamento real da Graph: ela devolve 200 com `error` no corpo. Olhar
    // só o status HTTP deixaria passar justamente o token vencido.
    globalThis.fetch = respondeCom({ error: { message: "Session has expired", code: 190 } });
    const r = await saude();
    expect(r.status).toBe("FAILED");
    expect(r.detail).toContain("expired");
  });

  it("rede caída é NÃO SEI", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ETIMEDOUT");
    }) as unknown as typeof fetch;
    expect(await saude()).toMatchObject({ reachable: false, status: null });
  });

  it("sessão sem credencial não vira alarme de queda", async () => {
    metaCreds.mockResolvedValue(null as never);
    expect(await saude()).toMatchObject({ reachable: false, status: null });
  });
});

describe("o cron enxerga os três canais", () => {
  it("todo adapter registrado sabe responder pela própria saúde", async () => {
    // O cron pula quem não implementa, SEM log e sem contador — então um canal
    // sem este método é invisível para a Central, e a ausência não aparece em
    // lugar nenhum. Este caso existe para que o próximo canal não entre mudo.
    // A lista sai de `CHANNEL_CAPABILITIES`, que é a matriz declarada do seam:
    // canal novo entra ali por obrigação, então este caso o alcança sozinho.
    const { getAdapter, CHANNEL_CAPABILITIES } = await import("@/lib/channels");
    const mudos = Object.keys(CHANNEL_CAPABILITIES).filter(
      (p) => typeof getAdapter(p as never).checkHealth !== "function",
    );
    expect(mudos, `canais sem checkHealth: ${mudos.join(", ")}`).toEqual([]);
  });
});
