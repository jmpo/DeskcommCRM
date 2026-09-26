/**
 * A etapa marcada avisa a equipe na Central (migration 0426).
 *
 * Os modos de falha vigiados: avisar etapa que ninguém marcou (ruído que
 * ensina a ignorar a Central), empilhar o mesmo aviso a cada reprocessamento,
 * e vazar o nome/telefone do cliente no texto do aviso.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { avisoDeEtapaHandler } from "@/lib/leads/aviso-de-etapa.handler";
import type { EventRow } from "@/lib/event-log/dispatcher";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

const ORG = "11111111-1111-1111-1111-111111111111";
const LEAD = "22222222-2222-2222-2222-222222222222";
const ETAPA = "33333333-3333-3333-3333-333333333333";

const inseridos: Record<string, unknown>[] = [];

function fakeAdmin(t: { avisar: boolean | null; jaAberto?: boolean; locale?: string }) {
  return {
    from(tabela: string) {
      const q = {
        select: () => q,
        eq: () => q,
        limit: async () => ({ data: t.jaAberto ? [{ id: "x" }] : [], error: null }),
        maybeSingle: async () => ({
          data:
            tabela === "crm_stages"
              ? { name: "Pedido confirmado", avisar_na_central: t.avisar }
              : tabela === "organizations"
                ? { locale: t.locale ?? "es" }
                : null,
          error: null,
        }),
        insert: async (linha: Record<string, unknown>) => {
          inseridos.push(linha);
          return { error: null };
        },
      };
      return q;
    },
  };
}

const evento = (payload: Record<string, unknown>): EventRow => ({
  id: "evt",
  organization_id: ORG,
  event_type: "lead.stage_changed",
  entity_kind: "crm_lead",
  entity_id: LEAD,
  payload,
  metadata: {},
  consumed_by: [],
  attempts: 0,
  created_at: new Date().toISOString(),
});

beforeEach(() => {
  inseridos.length = 0;
});

describe("aviso na Central ao entrar numa etapa marcada", () => {
  it("escuta a mudança de etapa", () => {
    expect(avisoDeEtapaHandler.events).toContain("lead.stage_changed");
  });

  it("etapa marcada: abre um aviso que aponta para o negócio, no idioma da organização", async () => {
    vi.mocked(createAdminClient).mockReturnValue(fakeAdmin({ avisar: true }) as never);

    const r = await avisoDeEtapaHandler.handle(evento({ from_stage_id: "outra", to_stage_id: ETAPA }));

    expect(r.status).toBe("ok");
    expect(inseridos).toHaveLength(1);
    expect(inseridos[0]).toMatchObject({
      organization_id: ORG,
      kind: "other",
      ref_kind: "lead",
      ref_id: LEAD,
      title: "Negocio entró en «Pedido confirmado»",
    });
  });

  it("o texto não carrega nada do cliente — só a etapa", async () => {
    vi.mocked(createAdminClient).mockReturnValue(fakeAdmin({ avisar: true, locale: "pt-BR" }) as never);

    await avisoDeEtapaHandler.handle(evento({ to_stage_id: ETAPA, lead_title: "Ana Gómez +595981000000" }));

    const texto = JSON.stringify(inseridos[0]);
    expect(texto).not.toContain("Ana");
    expect(texto).not.toContain("595981");
    expect(inseridos[0]!.title).toBe("Negócio entrou em «Pedido confirmado»");
  });

  it("etapa sem a marca não avisa", async () => {
    vi.mocked(createAdminClient).mockReturnValue(fakeAdmin({ avisar: false }) as never);
    const r = await avisoDeEtapaHandler.handle(evento({ to_stage_id: ETAPA }));
    expect(r.status).toBe("skipped");
    expect(inseridos).toHaveLength(0);
  });

  it("aviso já aberto para o mesmo negócio e etapa não empilha", async () => {
    vi.mocked(createAdminClient).mockReturnValue(fakeAdmin({ avisar: true, jaAberto: true }) as never);
    const r = await avisoDeEtapaHandler.handle(evento({ to_stage_id: ETAPA }));
    expect(r.detail).toBe("aviso_ja_aberto");
    expect(inseridos).toHaveLength(0);
  });

  it("sem etapa de destino, ou movendo para a mesma etapa, não faz nada", async () => {
    vi.mocked(createAdminClient).mockReturnValue(fakeAdmin({ avisar: true }) as never);
    expect((await avisoDeEtapaHandler.handle(evento({}))).status).toBe("skipped");
    expect((await avisoDeEtapaHandler.handle(evento({ from_stage_id: ETAPA, to_stage_id: ETAPA }))).status).toBe("skipped");
    expect(inseridos).toHaveLength(0);
  });
});
