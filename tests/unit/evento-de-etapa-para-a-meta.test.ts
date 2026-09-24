/**
 * Evento de conversão de ETAPA (migration 0403): o negócio entra numa etapa
 * marcada com `InitiateCheckout` e o evento sai pela ponte do canal — sem valor
 * quando o negócio ainda não tem, e uma vez só.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { conversaoDeEtapaHandler } from "@/lib/conversoes/etapa.handler";
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
const ETAPA = "44444444-4444-4444-4444-444444444444";

const gravados: Record<string, unknown>[] = [];

function fakeAdmin(t: { evento: string | null; valor?: number | null; jaEnviado?: boolean; anuncio?: boolean }) {
  return {
    from(tabela: string) {
      const linhas: Record<string, unknown> = {
        crm_stages: { evento_de_conversao: t.evento },
        crm_leads: { id: LEAD, value_cents: t.valor ?? null, currency: "PYG", contact_id: CONTATO },
        contacts: {
          phone_number: "+595 981 000000",
          source_metadata: t.anuncio === false ? {} : { ad_platform: "meta_ads", ad_source_id: "CTWA_X" },
        },
        channel_sessions: { provider: "zernio", zernio_account_id: "ACC" },
        ad_conversion_dispatches: t.jaEnviado ? { status: "sent" } : null,
      };
      const q = {
        select: () => q, eq: () => q, is: () => q, neq: () => q, order: () => q, limit: () => q, in: () => q,
        maybeSingle: async () => ({ data: linhas[tabela] ?? null, error: null }),
        upsert: async (v: Record<string, unknown>) => { gravados.push(v); return { error: null }; },
        then: (ok: (r: unknown) => unknown) =>
          ok({ data: tabela === "conversations" ? [{ channel_session_id: "S1", provider_conversation_id: "CONV1" }] : [], error: null }),
      };
      return q;
    },
    rpc: async () => ({ data: "token", error: null }),
  };
}

const evento = (payload: Record<string, unknown> = { from_stage_id: "antes", to_stage_id: ETAPA }): EventRow => ({
  id: "evt", organization_id: ORG, event_type: "lead.stage_changed", entity_kind: "crm_lead", entity_id: LEAD,
  payload, metadata: {}, consumed_by: [], attempts: 0, created_at: new Date().toISOString(),
});

const resposta = (corpo: unknown) => new Response(JSON.stringify(corpo), { status: 200 });

beforeEach(() => {
  gravados.length = 0;
  vi.restoreAllMocks();
  vi.mocked(resolveZernioCreds).mockResolvedValue({ accountId: "ACC", apiKey: "k", baseUrl: "https://z.test/api", source: "session" });
});

describe("evento de conversão da etapa", () => {
  it("escuta a mudança de etapa", () => {
    expect(conversaoDeEtapaHandler.events).toContain("lead.stage_changed");
  });

  it("etapa com InitiateCheckout: sai pelo canal, SEM valor quando o negócio não tem", async () => {
    vi.mocked(createAdminClient).mockReturnValue(fakeAdmin({ evento: "InitiateCheckout", valor: null }) as never);
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(resposta({ eventsReceived: 1, eventsFailed: 0 }));

    const r = await conversaoDeEtapaHandler.handle(evento());

    expect(r.status).toBe("ok");
    const corpo = JSON.parse(f.mock.calls[0]![1]?.body as string);
    expect(corpo).toMatchObject({ eventName: "InitiateCheckout", eventId: `${LEAD}:InitiateCheckout`, conversationId: "CONV1" });
    expect(corpo).not.toHaveProperty("value");
    expect(gravados.at(-1)).toMatchObject({ status: "sent", event_name: "InitiateCheckout" });
  });

  it("com valor no negócio, o valor vai em unidades", async () => {
    vi.mocked(createAdminClient).mockReturnValue(fakeAdmin({ evento: "InitiateCheckout", valor: 125_000_00 }) as never);
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(resposta({ eventsReceived: 1, eventsFailed: 0 }));
    await conversaoDeEtapaHandler.handle(evento());
    expect(JSON.parse(f.mock.calls[0]![1]?.body as string)).toMatchObject({ value: 125_000, currency: "PYG" });
  });

  it("etapa sem evento, contato sem anúncio ou evento já enviado: nada sai", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    for (const cenario of [
      { evento: null },
      { evento: "InitiateCheckout", anuncio: false },
      { evento: "InitiateCheckout", jaEnviado: true },
    ]) {
      vi.mocked(createAdminClient).mockReturnValue(fakeAdmin(cenario) as never);
      expect((await conversaoDeEtapaHandler.handle(evento())).status).toBe("skipped");
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("evento fora do vocabulário (dado corrompido) não sai", async () => {
    vi.mocked(createAdminClient).mockReturnValue(fakeAdmin({ evento: "Purchase" }) as never);
    const f = vi.spyOn(globalThis, "fetch");
    expect((await conversaoDeEtapaHandler.handle(evento())).detail).toBe("etapa_sem_evento");
    expect(f).not.toHaveBeenCalled();
  });
});
