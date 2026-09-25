/**
 * O push de VENDA: o valor no título, a soma do dia no corpo, a marca no ícone
 * — e nunca o nome do cliente, porque é a notificação que se printa e se
 * compartilha.
 *
 * Antes: "Negocio entró en «Pedido confirmado»" + nome do cliente, sem valor; e
 * o ganho ("Lead ganho", em português) ia só ao dono do negócio — numa
 * operação atendida pela IA, ninguém (medido: 0 de 243 negócios com dono).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/notifications/vapid", () => ({ vapidPronto: () => true, vapidPublica: () => "pub", vapidSubject: async () => "mailto:x@y" }));
vi.mock("@/lib/notifications/web_push", () => ({
  enviarPushDaOrg: vi.fn().mockResolvedValue({ sent: 1, gone: 0 }),
  enviarPushAoUsuario: vi.fn().mockResolvedValue({ sent: 1, gone: 0 }),
}));

import type { EventRow } from "@/lib/event-log/dispatcher";
import { webPushInboundHandler } from "@/lib/notifications/push.handler";
import {
  etapaDoTituloDoAviso,
  ganhasDeHoje,
  inicioDoDia,
  montarPushDeVenda,
  novasDeHoje,
} from "@/lib/notifications/push-de-venda";
import { enviarPushAoUsuario, enviarPushDaOrg } from "@/lib/notifications/web_push";
import { createAdminClient } from "@/lib/supabase/admin";

const ORG = "11111111-1111-4111-8111-111111111111";

type Linha = Record<string, unknown>;

/**
 * Banco de mentira que responde às duas formas de leitura: `maybeSingle()`
 * devolve `unicos[tabela]`, e o `await` direto na consulta devolve
 * `listas[tabela]`. Os filtros ficam registrados para o teste conferir o escopo.
 */
function banco(unicos: Record<string, Linha | null>, listas: Record<string, Linha[]> = {}) {
  const filtros: Array<[string, string, string, unknown]> = [];
  return {
    filtros,
    from(tabela: string) {
      const q: Record<string, unknown> = {};
      const anota = (op: string) => (col: string, val: unknown) => {
        filtros.push([tabela, op, col, val]);
        return q;
      };
      Object.assign(q, {
        select: () => q,
        eq: anota("eq"),
        gte: anota("gte"),
        in: anota("in"),
        limit: () => q,
        maybeSingle: async () => ({ data: unicos[tabela] ?? null, error: null }),
        then: (ok: (v: unknown) => unknown) => ok({ data: listas[tabela] ?? [], error: null }),
      });
      return q;
    },
  };
}

const evento = (event_type: string, payload: Record<string, unknown>): EventRow => ({
  id: "evt", organization_id: ORG, event_type, entity_kind: "lead", entity_id: null,
  payload, metadata: {}, consumed_by: [], attempts: 0, created_at: new Date().toISOString(),
});

beforeEach(() => {
  vi.mocked(enviarPushDaOrg).mockClear();
  vi.mocked(enviarPushAoUsuario).mockClear();
});

describe("o texto do push de venda", () => {
  it("nova venda: valor no título, etapa e o dia no corpo, ícone da marca", () => {
    expect(
      montarPushDeVenda({
        momento: "nova",
        valor: { cents: 12_500_000, moeda: "PYG" },
        etapa: "Pedido confirmado",
        hoje: { quantidade: 3, totalCents: 37_500_000 },
        idioma: "es",
        tag: "aviso:i1",
        href: "/app/pipelines/p1",
      }),
    ).toEqual({
      title: "🎉 ¡Nueva venta! Gs. 125.000",
      body: "Pedido confirmado · Hoy: 3 ventas (Gs. 375.000)",
      tag: "aviso:i1",
      href: "/app/pipelines/p1",
      icon: "/icone/192",
    });
  });

  it("venda ganha em português, com centavos do real", () => {
    const p = montarPushDeVenda({
      momento: "ganha",
      valor: { cents: 9_700, moeda: "BRL" },
      etapa: "Pago",
      hoje: { quantidade: 1, totalCents: 9_700 },
      idioma: "pt-BR",
      tag: "lead-won:l1",
      href: "/app/kanban",
    });
    expect(p.title).toBe("💰 Venda ganha! R$ 97,00");
    expect(p.body).toBe("Pago · Hoje: 1 venda (R$ 97,00)");
  });

  it("sem valor no negócio: a chamada sozinha, sem 'Gs. 0'", () => {
    const p = montarPushDeVenda({
      momento: "nova", valor: null, etapa: null, hoje: null, idioma: "es", tag: "t", href: "/h",
    });
    expect(p.title).toBe("🎉 ¡Nueva venta!");
    expect(p.body).toBe("");
  });

  it("a etapa sai do título do aviso, em qualquer idioma", () => {
    expect(etapaDoTituloDoAviso("Negocio entró en «Pedido confirmado»")).toBe("Pedido confirmado");
    expect(etapaDoTituloDoAviso("Negócio entrou em «Fechado»")).toBe("Fechado");
    expect(etapaDoTituloDoAviso("sem etapa")).toBeNull();
  });

  it("'hoje' começa à meia-noite do fuso da organização, não da UTC", () => {
    // 02:00 UTC do dia 25 ainda é 23:00 do dia 24 em São Paulo (UTC-3).
    expect(inicioDoDia(new Date("2026-09-25T02:00:00Z"), "America/Sao_Paulo").toISOString()).toBe(
      "2026-09-24T03:00:00.000Z",
    );
    // Fuso torto não derruba o push: cai no padrão.
    expect(() => inicioDoDia(new Date(), "Lua/Crateras")).not.toThrow();
  });
});

describe("a soma do dia", () => {
  it("novas: conta negócios únicos da MESMA etapa e soma só a moeda da venda", async () => {
    const db = banco({}, {
      agent_inbox_items: [{ ref_id: "l1" }, { ref_id: "l2" }, { ref_id: "l2" }, { ref_id: "l3" }],
      crm_leads: [
        { value_cents: 12_500_000, currency: "PYG" },
        { value_cents: 13_500_000, currency: "PYG" },
        { value_cents: 5_000, currency: "USD" },
      ],
    });
    const r = await novasDeHoje(db as never, ORG, "Negocio entró en «Pedido confirmado»", "PYG", new Date("2026-09-25T03:00:00Z"));
    expect(r).toEqual({ quantidade: 3, totalCents: 26_000_000 });
    // Escopo: a organização, a etapa (pelo título) e o dia.
    expect(db.filtros).toContainEqual(["agent_inbox_items", "eq", "organization_id", ORG]);
    expect(db.filtros).toContainEqual(["agent_inbox_items", "eq", "title", "Negocio entró en «Pedido confirmado»"]);
    expect(db.filtros).toContainEqual(["agent_inbox_items", "gte", "created_at", "2026-09-25T03:00:00.000Z"]);
    expect(db.filtros).toContainEqual(["crm_leads", "eq", "organization_id", ORG]);
  });

  it("ganhas: negócios ganhos desde a meia-noite, na organização", async () => {
    const db = banco({}, { crm_leads: [{ value_cents: 100, currency: "BRL" }, { value_cents: 200, currency: "BRL" }] });
    expect(await ganhasDeHoje(db as never, ORG, "BRL", new Date("2026-09-25T03:00:00Z"))).toEqual({
      quantidade: 2,
      totalCents: 300,
    });
    expect(db.filtros).toContainEqual(["crm_leads", "eq", "status", "won"]);
    expect(db.filtros).toContainEqual(["crm_leads", "gte", "closed_at", "2026-09-25T03:00:00.000Z"]);
  });

  it("banco que falha: o resumo some, o push não", async () => {
    const quebrado = { from: () => { throw new Error("fora do ar"); } };
    expect(await novasDeHoje(quebrado as never, ORG, "x", "PYG", new Date())).toBeNull();
    expect(await ganhasDeHoje(quebrado as never, ORG, "PYG", new Date())).toBeNull();
  });
});

describe("pelo handler", () => {
  it("venda confirmada leva a soma do dia e NUNCA o nome do cliente", async () => {
    vi.mocked(createAdminClient).mockReturnValue(banco(
      {
        agent_inbox_items: { id: "i1", kind: "other", ref_kind: "lead", ref_id: "l1", title: "Negocio entró en «Pedido confirmado»" },
        organizations: { locale: "es", timezone: "America/Asuncion" },
        crm_leads: { title: "Juan Pompa", pipeline_id: "p1", value_cents: 12_500_000, currency: "PYG" },
      },
      {
        agent_inbox_items: [{ ref_id: "l1" }, { ref_id: "l0" }],
        crm_leads: [{ value_cents: 12_500_000, currency: "PYG" }, { value_cents: 13_500_000, currency: "PYG" }],
      },
    ) as never);
    await webPushInboundHandler.handle(evento("central.aviso_criado", { item_id: "i1" }));
    const payload = vi.mocked(enviarPushDaOrg).mock.calls[0]![1];
    expect(payload.title).toBe("🎉 ¡Nueva venta! Gs. 125.000");
    expect(payload.body).toBe("Pedido confirmado · Hoy: 2 ventas (Gs. 260.000)");
    expect(JSON.stringify(payload)).not.toContain("Juan");
  });

  it("venda ganha SEM dono vai para a equipe inteira, no idioma da organização", async () => {
    vi.mocked(createAdminClient).mockReturnValue(banco(
      {
        organizations: { locale: "es", timezone: "America/Asuncion" },
        crm_leads: { title: "Juan Pompa", owner_user_id: null, pipeline_id: "p1", stage_id: "s9", value_cents: 13_500_000, currency: "PYG" },
        crm_stages: { name: "Entregado" },
      },
      { crm_leads: [{ value_cents: 13_500_000, currency: "PYG" }] },
    ) as never);
    const r = await webPushInboundHandler.handle(evento("lead.won", { lead_id: "l1" }));
    expect(r.status).toBe("ok");
    expect(enviarPushAoUsuario).not.toHaveBeenCalled();
    const [org, payload] = vi.mocked(enviarPushDaOrg).mock.calls[0]!;
    expect(org).toBe(ORG);
    expect(payload).toMatchObject({
      title: "💰 ¡Venta ganada! Gs. 135.000",
      body: "Entregado · Hoy: 1 venta (Gs. 135.000)",
      tag: "lead-won:l1",
      href: "/app/pipelines/p1",
    });
    expect(JSON.stringify(payload)).not.toContain("Juan");
  });

  it("venda ganha COM dono segue indo só a ele", async () => {
    vi.mocked(createAdminClient).mockReturnValue(banco({
      organizations: { locale: "pt-BR" },
      crm_leads: { title: "Maria", owner_user_id: "u1", pipeline_id: "p1", stage_id: "s1", value_cents: 9_700, currency: "BRL" },
      crm_stages: { name: "Ganho" },
    }) as never);
    await webPushInboundHandler.handle(evento("lead.won", { lead_id: "l1" }));
    expect(enviarPushDaOrg).not.toHaveBeenCalled();
    expect(vi.mocked(enviarPushAoUsuario).mock.calls[0]![1]).toBe("u1");
    expect(vi.mocked(enviarPushAoUsuario).mock.calls[0]![2].title).toBe("💰 Venda ganha! R$ 97,00");
  });

  it("perda e menção também saem no idioma da organização", async () => {
    vi.mocked(createAdminClient).mockReturnValue(banco({
      organizations: { locale: "es" },
      crm_leads: { title: "Maria", owner_user_id: "u1", pipeline_id: "p1" },
    }) as never);
    await webPushInboundHandler.handle(evento("lead.lost", { lead_id: "l1" }));
    expect(vi.mocked(enviarPushAoUsuario).mock.calls[0]![2].title).toBe("Lead perdido");
    await webPushInboundHandler.handle(evento("user.mentioned", { to_user_id: "u2", conversation_id: "c1" }));
    expect(vi.mocked(enviarPushAoUsuario).mock.calls[1]![2]).toMatchObject({
      title: "Te mencionaron",
      body: "Te mencionaron",
    });
  });
});
