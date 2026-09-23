/**
 * Venda reportada à Meta pela ponte do canal intermediado.
 *
 * Três modos de falha que este arquivo vigia:
 *   1. o 200 com `eventsFailed` lido como sucesso — a venda "enviada" que nunca chegou;
 *   2. centavos mandados como unidade — a compra de 150.000 ₲ virando 15 milhões;
 *   3. a mesma venda saindo pelos DOIS caminhos (canal e Meta direto).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { conversaoDeVendaHandler } from "@/lib/conversoes/envio.handler";
import { zernioReportConversion } from "@/lib/channels/zernio/conversoes";
import { resolveZernioCreds } from "@/lib/channels/zernio/credentials";
import type { EventRow } from "@/lib/event-log/dispatcher";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/channels/zernio/credentials", async (orig) => ({
  ...(await orig<typeof import("@/lib/channels/zernio/credentials")>()),
  resolveZernioCreds: vi.fn(),
}));

const ORG = "11111111-1111-1111-1111-111111111111";
const LEAD = "22222222-2222-2222-2222-222222222222";
const CONTATO = "33333333-3333-3333-3333-333333333333";
const CREDS = { accountId: "ACC", apiKey: "k", baseUrl: "https://z.test/api", source: "session" as const };

const VENDA = {
  organizationId: ORG,
  sessionRef: "ACC",
  providerConversationId: "CONV1",
  phone: "595981000000",
  event: "Purchase" as const,
  eventId: `${LEAD}:Purchase`,
  occurredAt: new Date("2026-09-23T12:00:00Z"),
  valueCents: 150_000_00,
  currency: "PYG",
};

const resposta = (corpo: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(corpo), { status, headers });

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(resolveZernioCreds).mockResolvedValue(CREDS);
});

describe("o envio pelo canal", () => {
  it("manda a venda em UNIDADES, com conversa, telefone e id de deduplicação", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      resposta({ eventsReceived: 1, eventsFailed: 0, traceId: "T1" }),
    );

    const r = await zernioReportConversion(VENDA);

    expect(r).toEqual({ outcome: "ok", detail: "via canal (trace T1)" });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://z.test/api/v1/whatsapp/conversions");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer k");
    expect(JSON.parse(init?.body as string)).toEqual({
      accountId: "ACC",
      eventName: "Purchase",
      eventId: `${LEAD}:Purchase`,
      eventTime: Math.floor(VENDA.occurredAt.getTime() / 1000),
      value: 150_000,
      currency: "PYG",
      conversationId: "CONV1",
      phoneE164: "595981000000",
    });
  });

  it("200 com eventsFailed é RECUSA, não sucesso", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      resposta({ eventsReceived: 0, eventsFailed: 1, failures: [{ message: "no ctwa_clid" }], traceId: "T2" }),
    );
    expect(await zernioReportConversion(VENDA)).toEqual({
      outcome: "rejected",
      detail: "no ctwa_clid (trace T2)",
    });
  });

  it("429 e 5xx esperam; o Retry-After manda", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(resposta({}, 429, { "retry-after": "30" }));
    expect(await zernioReportConversion(VENDA)).toMatchObject({ outcome: "retry", retryInMs: 30_000 });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(resposta({}, 503));
    expect(await zernioReportConversion(VENDA)).toMatchObject({ outcome: "retry" });
  });

  it("queda de rede espera; 4xx precisa de gente", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await zernioReportConversion(VENDA)).toMatchObject({ outcome: "retry" });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      resposta({ code: "INVALID", error: "currency" }, 422),
    );
    expect(await zernioReportConversion(VENDA)).toEqual({
      outcome: "rejected",
      detail: "zernio_422 INVALID: currency",
    });
  });

  it("sem conversa conhecida, manda só o telefone", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(resposta({ eventsReceived: 1, eventsFailed: 0 }));
    await zernioReportConversion({ ...VENDA, providerConversationId: null });
    const corpo = JSON.parse(f.mock.calls[0]![1]?.body as string);
    expect(corpo).not.toHaveProperty("conversationId");
    expect(corpo.phoneE164).toBe("595981000000");
  });

  it("sem credencial não chama a rede", async () => {
    vi.mocked(resolveZernioCreds).mockResolvedValue(null);
    const f = vi.spyOn(globalThis, "fetch");
    expect(await zernioReportConversion(VENDA)).toEqual({ outcome: "rejected", detail: "zernio_not_configured" });
    expect(f).not.toHaveBeenCalled();
  });
});

// ─── A escolha do caminho no handler ─────────────────────────────────────────

const gravados: Record<string, unknown>[] = [];

function fakeAdmin(t: { sessao: unknown; metaConfigurada?: boolean }) {
  return {
    from(tabela: string) {
      const linhas: Record<string, unknown> = {
        crm_leads: {
          id: LEAD,
          status: "won",
          value_cents: 150_000_00,
          currency: "PYG",
          closed_at: "2026-09-23T12:00:00Z",
          contact_id: CONTATO,
        },
        contacts: {
          phone_number: "+595 981 000000",
          source_metadata: { ad_platform: "meta_ads", ad_source_id: "CTWA_X" },
        },
        channel_sessions: t.sessao,
        ad_platform_connections: t.metaConfigurada
          ? { dataset_id: "1", access_token_encrypted: "\\xde", test_event_code: null, enabled: true }
          : null,
      };
      const q = {
        select: () => q,
        eq: () => q,
        is: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: linhas[tabela] ?? null, error: null }),
        upsert: async (v: Record<string, unknown>) => {
          gravados.push(v);
          return { error: null };
        },
        // Leitura em lista (as conversas do contato).
        then: (ok: (r: unknown) => unknown) =>
          ok({
            data: tabela === "conversations" ? [{ channel_session_id: "S1", provider_conversation_id: "CONV1" }] : [],
            error: null,
          }),
      };
      return q;
    },
    rpc: async () => ({ data: "token", error: null }),
  };
}

const evento: EventRow = {
  id: "evt",
  organization_id: ORG,
  event_type: "lead.won",
  entity_kind: "crm_lead",
  entity_id: LEAD,
  payload: {},
  metadata: {},
  consumed_by: [],
  attempts: 0,
  created_at: new Date().toISOString(),
};

describe("o handler escolhe UM caminho", () => {
  beforeEach(() => {
    gravados.length = 0;
  });

  it("conversa no canal com ponte: vai pelo canal, sem precisar de token da Meta", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      fakeAdmin({ sessao: { provider: "zernio", zernio_account_id: "ACC" } }) as never,
    );
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(resposta({ eventsReceived: 1, eventsFailed: 0 }));

    const r = await conversaoDeVendaHandler.handle(evento);

    expect(r.status).toBe("ok");
    expect(f).toHaveBeenCalledOnce();
    expect(String(f.mock.calls[0]![0])).toContain("/v1/whatsapp/conversions");
    expect(gravados.at(-1)).toMatchObject({ status: "sent", platform: "meta_ads" });
  });

  it("mesmo com a Meta direta configurada, a venda sai UMA vez — pelo canal", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      fakeAdmin({ sessao: { provider: "zernio", zernio_account_id: "ACC" }, metaConfigurada: true }) as never,
    );
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(resposta({ eventsReceived: 1, eventsFailed: 0 }));

    await conversaoDeVendaHandler.handle(evento);

    expect(f).toHaveBeenCalledOnce();
    expect(String(f.mock.calls[0]![0])).not.toContain("graph.facebook.com");
  });

  it("canal sem a capacidade (ou arquivado): segue o caminho da Meta direta", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      fakeAdmin({ sessao: { provider: "waha", waha_session_name: "default" } }) as never,
    );
    const f = vi.spyOn(globalThis, "fetch");

    const r = await conversaoDeVendaHandler.handle(evento);

    // Sem credencial da Meta direta, o desfecho é o de sempre: pendência na tela.
    expect(f).not.toHaveBeenCalled();
    expect(r.status).toBe("skipped");

    vi.mocked(createAdminClient).mockReturnValue(fakeAdmin({ sessao: null }) as never);
    expect((await conversaoDeVendaHandler.handle(evento)).status).toBe("skipped");
    expect(f).not.toHaveBeenCalled();
  });
});
