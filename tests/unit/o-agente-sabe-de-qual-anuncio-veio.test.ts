/**
 * O agente sabe de qual anúncio o contato veio.
 *
 * A ingestão grava `ad_title`/`ad_body` em `contacts.source_metadata` quando a
 * conversa nasce de um clique em anúncio de WhatsApp — e até aqui ninguém
 * entregava isso ao agente: o cliente que clicou no anúncio do produto e
 * escreveu "hola, quiero info" chegava sem assunto, e o agente perguntava o que
 * o anúncio já tinha dito. O dado tem de chegar no contexto do turno, inclusive
 * quando o contexto é PROJETADO (o modo que esconde ids do modelo).
 */
import { describe, expect, it } from "vitest";

import { getLeadContext } from "@/lib/agent-engine/edge/crm/get-lead-context";
import { projetarContexto } from "@/lib/agent-engine/agent/projecao";

function dbFalso(anuncio: { ad_title: string | null; ad_body: string | null }) {
  return {
    query: async (sql: string) => {
      if (sql.includes("from contacts")) {
        return {
          rows: [{
            name: "Carlos", display_name: null, email: null, phone_number: "+595981000000", tags: [],
            is_blocked: false, source: "whatsapp", consent: null, is_anonymized: false, ...anuncio,
          }],
        };
      }
      return { rows: [] };
    },
  };
}

const KNOBS = { historyLimit: 20, maxTokens: 1_000 };
const ENTRADA = { tenantId: "org-1", leadId: "contato-1", fuso: "America/Asuncion" };

describe("anúncio de origem no contexto do agente", () => {
  it("contato que veio de anúncio: título e texto chegam ao turno", async () => {
    const r = await getLeadContext(
      dbFalso({ ad_title: "Pico de alta presión", ad_body: "Lavá tu auto en minutos. Envío gratis." }) as never,
      {} as never, ENTRADA, KNOBS,
    );
    if (!r.ok) throw new Error("contexto falhou");
    expect(r.context.anuncio_de_origem).toEqual({
      titulo: "Pico de alta presión",
      texto: "Lavá tu auto en minutos. Envío gratis.",
    });
    // O modo projetado também leva — é nele que o agente com catálogo roda.
    expect(projetarContexto(r.context).anuncio_de_origem?.titulo).toBe("Pico de alta presión");
  });

  it("contato orgânico: a chave nem aparece (não gasta token dizendo que não há)", async () => {
    const r = await getLeadContext(dbFalso({ ad_title: null, ad_body: null }) as never, {} as never, ENTRADA, KNOBS);
    if (!r.ok) throw new Error("contexto falhou");
    expect("anuncio_de_origem" in r.context).toBe(false);
    expect("anuncio_de_origem" in projetarContexto(r.context)).toBe(false);
  });
});
