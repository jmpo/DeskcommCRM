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
  it("venda confirmada: o título do aviso e o negócio, abrindo o funil", async () => {
    vi.mocked(createAdminClient).mockReturnValue(banco({
      agent_inbox_items: { id: "i1", kind: "other", ref_kind: "lead", ref_id: "l1", title: "Negocio entró en «Pedido confirmado»" },
      organizations: { locale: "es" },
      crm_leads: { title: "Pico de alta presión x1 - Juan Pompa", pipeline_id: "p1" },
    }) as never);
    const r = await webPushInboundHandler.handle(evento("central.aviso_criado", { item_id: "i1" }));
    expect(r.status).toBe("ok");
    expect(vi.mocked(enviarPushDaOrg).mock.calls[0]![1]).toEqual({
      title: "Negocio entró en «Pedido confirmado»",
      body: "Pico de alta presión x1 - Juan Pompa",
      tag: "aviso:i1",
      href: "/app/pipelines/p1",
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
  it("o título que a IA escreveu vai no corpo", async () => {
    vi.mocked(createAdminClient).mockReturnValue(banco({
      agent_cases: { id: "k1", title: "Cliente pregunta transportadora del envío", status: "awaiting_human" },
      organizations: { locale: "es" },
    }) as never);
    await webPushInboundHandler.handle(evento("ai.case_opened", { case_id: "k1" }));
    expect(vi.mocked(enviarPushDaOrg).mock.calls[0]![1]).toEqual({
      title: "La IA pidió ayuda al equipo",
      body: "Cliente pregunta transportadora del envío",
      tag: "caso:k1",
      href: "/app/ai/cases",
    });
  });

  it("caso já resolvido quando o evento foi drenado: nada sai", async () => {
    vi.mocked(createAdminClient).mockReturnValue(banco({
      agent_cases: { id: "k2", title: "x", status: "resolved" },
    }) as never);
    const r = await webPushInboundHandler.handle(evento("ai.case_opened", { case_id: "k2" }));
    expect(r.status).toBe("skipped");
    expect(enviarPushDaOrg).not.toHaveBeenCalled();
  });
});
