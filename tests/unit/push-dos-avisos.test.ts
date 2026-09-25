/**
 * Os avisos que pedem gente vão ao CELULAR, no idioma da organização.
 *
 * Medido em produção: um caso aberto às 23h42 esperou sem ninguém saber — o som
 * da Central só toca com o CRM aberto. Os mesmos dois momentos que têm som
 * (passagem para pessoa, venda confirmada) mais o caso aberto viram push; o
 * resto da Central não.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/notifications/vapid", () => ({ vapidPronto: () => true, vapidPublica: () => "pub", vapidSubject: async () => "mailto:x@y" }));
vi.mock("@/lib/notifications/web_push", () => ({
  enviarPushDaOrg: vi.fn().mockResolvedValue({ sent: 1, gone: 0 }),
  enviarPushAoUsuario: vi.fn().mockResolvedValue({ sent: 1, gone: 0 }),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import { enviarPushDaOrg } from "@/lib/notifications/web_push";
import { webPushInboundHandler } from "@/lib/notifications/push.handler";
import type { EventRow } from "@/lib/event-log/dispatcher";

const ORG = "11111111-1111-4111-8111-111111111111";

function banco(linhas: Record<string, Record<string, unknown> | null>) {
  return {
    from(tabela: string) {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: linhas[tabela] ?? null, error: null }),
      };
      return q;
    },
  };
}

const evento = (event_type: string, payload: Record<string, unknown>): EventRow => ({
  id: "evt", organization_id: ORG, event_type, entity_kind: "x", entity_id: null,
  payload, metadata: {}, consumed_by: [], attempts: 0, created_at: new Date().toISOString(),
});

beforeEach(() => vi.mocked(enviarPushDaOrg).mockClear());

describe("aviso da Central → celular", () => {
  it("venda confirmada: o VALOR no título e a etapa no corpo, abrindo o funil", async () => {
    vi.mocked(createAdminClient).mockReturnValue(banco({
      agent_inbox_items: { id: "i1", kind: "other", ref_kind: "lead", ref_id: "l1", title: "Negocio entró en «Pedido confirmado»" },
      organizations: { locale: "es" },
      crm_leads: { title: "Pico de alta presión x1 - Juan Pompa", pipeline_id: "p1", value_cents: 12_500_000, currency: "PYG" },
    }) as never);
    const r = await webPushInboundHandler.handle(evento("central.aviso_criado", { item_id: "i1" }));
    expect(r.status).toBe("ok");
    // Sem o resumo do dia: este banco de mentira não responde à lista, e o push
    // sai mesmo assim. O resumo é medido em `push-de-venda.test.ts`.
    expect(vi.mocked(enviarPushDaOrg).mock.calls[0]![1]).toEqual({
      title: "🎉 ¡Nueva venta! Gs. 125.000",
      body: "Pedido confirmado",
      tag: "aviso:i1",
      href: "/app/pipelines/p1",
      icon: "/icone/192",
    });
  });

  it("passagem para pessoa: em espanhol, abrindo a conversa", async () => {
    vi.mocked(createAdminClient).mockReturnValue(banco({
      agent_inbox_items: { id: "i2", kind: "handoff", ref_kind: "conversation", ref_id: "c1", title: "Handoff humano solicitado — assumir a conversa" },
      organizations: { locale: "es" },
    }) as never);
    await webPushInboundHandler.handle(evento("central.aviso_criado", { item_id: "i2" }));
    expect(vi.mocked(enviarPushDaOrg).mock.calls[0]![1]).toMatchObject({
      title: "La IA pasó una conversación al equipo",
      href: "/app/inbox?id=c1",
    });
  });

  it("aviso que não pede gente (revisão de modelo, promessa) fica só na tela", async () => {
    vi.mocked(createAdminClient).mockReturnValue(banco({
      agent_inbox_items: { id: "i3", kind: "channel_template_review", ref_kind: null, ref_id: null, title: "Modelo aprovado" },
      organizations: { locale: "es" },
    }) as never);
    const r = await webPushInboundHandler.handle(evento("central.aviso_criado", { item_id: "i3" }));
    expect(r.status).toBe("skipped");
    expect(enviarPushDaOrg).not.toHaveBeenCalled();
  });
});

describe("caso aberto → celular", () => {
  it("o aviso do caso vira push com o título que a IA escreveu, abrindo o caso", async () => {
    vi.mocked(createAdminClient).mockReturnValue(banco({
      agent_inbox_items: { id: "i4", kind: "other", ref_kind: "agent_case", ref_id: "k1", title: "La IA pidió ayuda al equipo" },
      agent_cases: { title: "Cliente pregunta transportadora del envío" },
      organizations: { locale: "es" },
    }) as never);
    await webPushInboundHandler.handle(evento("central.aviso_criado", { item_id: "i4" }));
    expect(vi.mocked(enviarPushDaOrg).mock.calls[0]![1]).toEqual({
      title: "La IA pidió ayuda al equipo",
      body: "Cliente pregunta transportadora del envío",
      tag: "aviso:i4",
      href: "/app/ai/cases?caso=k1",
    });
  });

  it("o evento do caso NÃO manda push por fora — só o aviso da Central, senão chegam dois", () => {
    expect(webPushInboundHandler.events).not.toContain("ai.case_opened");
  });
});
