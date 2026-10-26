/**
 * A faixa do topo para quem ainda não tem o WhatsApp atendendo (QA de
 * 26/10/2026: quem pulou o telefone caía numa Inbox vazia sem saber por quê).
 */
import { describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ canais: vi.fn() }));
vi.mock("@/lib/channels/selectable", () => ({ listSelectableChannels: m.canais }));

import { lerAvisoDoPrimeiroNumero } from "@/lib/onboarding/aviso-do-primeiro-numero";

function banco(agente: Record<string, unknown> | null, versoes: Record<string, unknown>[] = []) {
  return {
    from: (tabela: string) => {
      const b = {
        select: () => b,
        eq: () => b,
        limit: () => b,
        maybeSingle: async () => ({ data: agente, error: null }),
        then: (ok: (r: unknown) => unknown) =>
          Promise.resolve(
            tabela === "ai_agent_versions"
              ? { data: versoes, error: null }
              : { data: null, error: null },
          ).then(ok),
      };
      return b;
    },
  } as never;
}

describe("lerAvisoDoPrimeiroNumero", () => {
  it("⭐ sem número nenhum: 'conecte seu WhatsApp'", async () => {
    m.canais.mockResolvedValue([]);
    expect(await lerAvisoDoPrimeiroNumero(banco(null), "org")).toEqual({ tipo: "sem_numero" });
  });

  it("⭐ número conectado e o agente do onboarding em rascunho: 'ative'", async () => {
    m.canais.mockResolvedValue([{ id: "c" }]);
    const agente = { id: "a", name: "Rocío", published_version_id: null, archived_at: null };
    expect(
      await lerAvisoDoPrimeiroNumero(banco(agente, [{ provisioning_origin: "onboarding" }]), "org"),
    ).toEqual({
      tipo: "agente_pronto",
      nome: "Rocío",
    });
  });

  it("agente no ar: sem faixa", async () => {
    m.canais.mockResolvedValue([{ id: "c" }]);
    const agente = { id: "a", name: "Rocío", published_version_id: "v1", archived_at: null };
    expect(await lerAvisoDoPrimeiroNumero(banco(agente), "org")).toBeNull();
  });

  it("rascunho feito no EDITOR: a faixa não oferece publicar por cima", async () => {
    m.canais.mockResolvedValue([{ id: "c" }]);
    const agente = { id: "a", name: "Rocío", published_version_id: null, archived_at: null };
    expect(
      await lerAvisoDoPrimeiroNumero(banco(agente, [{ provisioning_origin: null }]), "org"),
    ).toBeNull();
  });

  it("agente SEM versão nenhuma (faltou chave de IA ao treinar): sem faixa — 'Ativar' seria promessa falsa", async () => {
    m.canais.mockResolvedValue([{ id: "c" }]);
    const agente = { id: "a", name: "Tomik", published_version_id: null, archived_at: null };
    expect(await lerAvisoDoPrimeiroNumero(banco(agente, []), "org")).toBeNull();
  });

  it("leitura que falha: nenhuma faixa (nunca uma faixa errada)", async () => {
    m.canais.mockRejectedValue(new Error("banco fora"));
    expect(await lerAvisoDoPrimeiroNumero(banco(null), "org")).toBeNull();
  });
});
