/**
 * O transporte do Google Ads leva as conversões de ETAPA que as regras do
 * Google (0436) mandam enviar — e só elas, além da venda.
 *
 * Modo de falha vigiado: a guarda do fork no transporte (`enviar` de
 * `lib/plataformas-de-anuncio/google/conversions.ts`) aceitava só `Purchase`
 * e `QualifiedLead`. As regras por etapa novas gravam `Etapa:<uuid>` no
 * livro-razão (`eventoDaEtapa`), e o consumidor de etapa as manda ao
 * transporte — que as recusava como `permanente`: nenhuma etapa configurada
 * na tela chegava ao Google, e o registro ficava "recusado" sem defeito de
 * configuração nenhum.
 *
 * O que a guarda protegia continua protegido: a regra de etapa da META
 * (`MetaEtapa:<uuid>`, 0524) não tem ação no Google, e mandá-la com a ação da
 * conexão contaria como venda o que não é venda.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConversaoOffline, CredencialDeConversao } from "@/lib/plataformas-de-anuncio/types";

const mocks = vi.hoisted(() => ({ enviarDataManager: vi.fn() }));
vi.mock("@/lib/plataformas-de-anuncio/google/data-manager", () => ({
  enviarDataManager: mocks.enviarDataManager,
  consultarDataManager: vi.fn(),
}));

const { transporteGoogle, oGoogleRecebe } = await import(
  "@/lib/plataformas-de-anuncio/google/conversions"
);
const { eventoDaEtapa, ehEventoDeEtapa } = await import("@/lib/conversoes/regras-google");
const { eventoDaEtapaMeta } = await import("@/lib/conversoes/regras-meta");

const ETAPA = "3f6c2a9e-5b1d-4c7e-9a2f-8d0b1e4c6a7f";

const credencial = {
  datasetId: "1234567890",
  accessToken: "",
  testEventCode: null,
  google: {
    api: "data_manager",
    refreshToken: "r",
    customerId: "1234567890",
    loginCustomerId: null,
    conversionActionId: "99",
    modoDeValorDaVenda: "quando_houver",
  },
} as unknown as CredencialDeConversao;

function conversao(evento: ConversaoOffline["evento"]): ConversaoOffline {
  return {
    organizationId: "org",
    leadId: "lead",
    evento,
    eventoId: `lead:${evento}`,
    ocorridoEm: new Date("2026-10-26T12:00:00.000Z"),
    cliqueDeOrigem: "G1",
    identificadoresGoogle: { gclid: "G1" },
    telefone: null,
    valorCentavos: null,
    moeda: "PYG",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enviarDataManager.mockResolvedValue({ tipo: "ok" });
});

describe("o transporte do Google leva a etapa que a regra do Google mandou", () => {
  it("Etapa:<uuid> (regra por etapa, 0436) sai para o Google", async () => {
    const r = await transporteGoogle.enviar(credencial, conversao(eventoDaEtapa(ETAPA)));
    expect(r).toEqual({ tipo: "ok" });
    expect(mocks.enviarDataManager).toHaveBeenCalledTimes(1);
    expect(mocks.enviarDataManager.mock.calls[0]![1]).toMatchObject({ evento: `Etapa:${ETAPA}` });
  });

  it("a venda e a qualificação legada seguem saindo (controle)", async () => {
    expect(await transporteGoogle.enviar(credencial, conversao("Purchase"))).toEqual({ tipo: "ok" });
    expect(await transporteGoogle.enviar(credencial, conversao("QualifiedLead"))).toEqual({
      tipo: "ok",
    });
    expect(mocks.enviarDataManager).toHaveBeenCalledTimes(2);
  });

  it("a etapa da META não vai ao Google: recusa permanente, sem chamar a API", async () => {
    const r = await transporteGoogle.enviar(credencial, conversao(eventoDaEtapaMeta(ETAPA)));
    expect(r.tipo).toBe("permanente");
    expect(mocks.enviarDataManager).not.toHaveBeenCalled();
  });

  it("evento fora do contrato (nome da Meta, etapa sem uuid) também não vai", async () => {
    for (const evento of ["InitiateCheckout", "Etapa:nao-e-uuid", "Etapa:"]) {
      const r = await transporteGoogle.enviar(
        credencial,
        conversao(evento as ConversaoOffline["evento"]),
      );
      expect(r.tipo, evento).toBe("permanente");
    }
    expect(mocks.enviarDataManager).not.toHaveBeenCalled();
  });
});

describe("o transporte e o consumidor de etapa falam a mesma língua", () => {
  it("todo evento que o consumidor de etapa atende, o transporte aceita", () => {
    for (const evento of ["QualifiedLead", eventoDaEtapa(ETAPA)]) {
      expect(ehEventoDeEtapa(evento), evento).toBe(true);
      expect(oGoogleRecebe(evento), evento).toBe(true);
    }
    expect(oGoogleRecebe(eventoDaEtapaMeta(ETAPA))).toBe(false);
  });
});
