/**
 * `connect.ts` — a credencial da sessão (própria OU ponteiro para a instalação),
 * o webhook registrado pela instalação e o que a exclusão desfaz no provedor.
 *
 * O que este arquivo prova, com banco e provedor dublados:
 *   1. gravar pela instalação deixa a chave própria NULA e o ponteiro ligado
 *      (o CHECK da 0713 recusaria as duas juntas), e o update é filtrado pela
 *      organização;
 *   2. o webhook recusado pelo provedor não desfaz a conexão: devolve `null`;
 *   3. excluir a conexão por um clique apaga o webhook E desconecta o número
 *      da conta da instalação; a por chave própria só apaga o webhook que a
 *      rota registrou, e o webhook colado à mão não é tocado.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  garantirWebhook: vi.fn(),
  apagarWebhook: vi.fn(),
  desconectarConta: vi.fn(),
  chave: vi.fn(),
}));
vi.mock("./zernio/conexao-pela-instalacao", () => ({
  garantirWebhook: h.garantirWebhook,
  apagarWebhook: h.apagarWebhook,
  desconectarConta: h.desconectarConta,
}));
vi.mock("./zernio/credentials", () => ({
  chaveDaInstalacao: h.chave,
  zernioBaseUrl: () => "https://p.test",
}));
vi.mock("@/lib/webhooks/secrets", () => ({ decryptWebhookSecret: async () => "chave-propria" }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { desfazerNoProvedor, registrarWebhookDoNumero, savePartnerSession } from "./connect";

const ORG = "org-1";

interface Escrita {
  tabela: string;
  op: string;
  valor?: Record<string, unknown>;
  filtros: Record<string, unknown>;
}

function dbFalso(linha: Record<string, unknown> | null = null, erroNoUpdate: string | null = null) {
  const escritas: Escrita[] = [];
  const db = {
    from(tabela: string) {
      const filtros: Record<string, unknown> = {};
      let op = "select";
      let valor: Record<string, unknown> | undefined;
      const q = {
        select: () => q,
        update: (v: Record<string, unknown>) => ((op = "update"), (valor = v), q),
        delete: () => ((op = "delete"), q),
        eq: (k: string, v: unknown) => ((filtros[k] = v), q),
        neq: (k: string, v: unknown) => ((filtros[`!${k}`] = v), q),
        maybeSingle: async () => ({ data: linha, error: null }),
        then: (resolve: (r: unknown) => void) => {
          escritas.push({ tabela, op, valor, filtros: { ...filtros } });
          resolve({
            data: null,
            error: op === "update" && erroNoUpdate ? { message: erroNoUpdate } : null,
          });
        },
      };
      return q;
    },
  };
  return { db: db as never, escritas };
}

beforeEach(() => vi.clearAllMocks());

describe("savePartnerSession pela instalação", () => {
  it("chave própria nula, ponteiro ligado, perfil gravado e update filtrado pela organização", async () => {
    const { db, escritas } = dbFalso();
    const r = await savePartnerSession(db, {
      organizationId: ORG,
      existingId: "sessao-1",
      accountId: "conta-1",
      credencial: { tipo: "instalacao", profileId: "perfil-1" },
      webhookPathToken: "tok",
      webhookSecretEncrypted: "seg",
      phoneNumber: "+595981000000",
      displayName: "Loja",
    });
    expect(r).toEqual({ error: null, id: "sessao-1" });
    const update = escritas.find((e) => e.tabela === "channel_sessions" && e.op === "update");
    expect(update?.valor).toMatchObject({
      zernio_token_encrypted: null,
      zernio_credencial_da_instalacao: true,
      zernio_profile_id: "perfil-1",
      zernio_webhook_id: null,
      archived_at: null,
    });
    expect(update?.filtros).toEqual({ id: "sessao-1", organization_id: ORG });
  });

  it("chave própria: grava a chave e desliga o ponteiro", async () => {
    const { db, escritas } = dbFalso();
    await savePartnerSession(db, {
      organizationId: ORG,
      existingId: "sessao-1",
      accountId: "conta-1",
      credencial: { tipo: "propria", apiKeyEncrypted: "chave-cifrada" },
      webhookPathToken: "tok",
      webhookSecretEncrypted: "seg",
      phoneNumber: null,
      displayName: "Loja",
    });
    expect(escritas.find((e) => e.op === "update")?.valor).toMatchObject({
      zernio_token_encrypted: "chave-cifrada",
      zernio_credencial_da_instalacao: false,
      zernio_profile_id: null,
    });
  });
});

describe("registrarWebhookDoNumero", () => {
  const entrada = {
    organizationId: ORG,
    sessionId: "sessao-1",
    apiKey: "k",
    accountId: "b".repeat(24),
    url: "https://crm/api/v1/webhooks/channel/tok",
    segredo: "s",
    segredoNovo: false,
  };

  it("grava o id da assinatura na sessão desta organização", async () => {
    h.garantirWebhook.mockResolvedValue("w-1");
    const { db, escritas } = dbFalso();
    expect(await registrarWebhookDoNumero(db, entrada)).toBe("w-1");
    expect(h.garantirWebhook).toHaveBeenCalledWith("k", {
      url: entrada.url,
      segredo: "s",
      segredoNovo: false,
      accountId: entrada.accountId,
      nome: `CRM WhatsApp ${"b".repeat(8)}`,
    });
    expect(escritas).toEqual([
      {
        tabela: "channel_sessions",
        op: "update",
        valor: { zernio_webhook_id: "w-1" },
        filtros: { organization_id: ORG, id: "sessao-1" },
      },
    ]);
  });

  it("provedor recusa: devolve null e não lança — a conexão já está gravada", async () => {
    h.garantirWebhook.mockRejectedValue(new Error("403"));
    const { db, escritas } = dbFalso();
    expect(await registrarWebhookDoNumero(db, entrada)).toBeNull();
    expect(escritas).toHaveLength(0);
  });
});

describe("desfazerNoProvedor", () => {
  const base = {
    zernio_account_id: "conta-1",
    zernio_token_encrypted: null,
    zernio_credencial_da_instalacao: false,
    zernio_webhook_id: null,
  };

  it("um clique: apaga o webhook e desconecta o número da conta da instalação", async () => {
    h.chave.mockResolvedValue("chave-da-instalacao");
    const { db } = dbFalso({
      ...base,
      zernio_credencial_da_instalacao: true,
      zernio_webhook_id: "w-1",
    });
    expect(await desfazerNoProvedor(db, ORG, "sessao-1")).toBe("desfeito");
    expect(h.apagarWebhook).toHaveBeenCalledWith("chave-da-instalacao", "w-1");
    expect(h.desconectarConta).toHaveBeenCalledWith("chave-da-instalacao", "conta-1");
  });

  it("chave própria com webhook da rota: apaga só o webhook, o número fica na conta da organização", async () => {
    const { db } = dbFalso({
      ...base,
      zernio_token_encrypted: "cifrada",
      zernio_webhook_id: "w-2",
    });
    expect(await desfazerNoProvedor(db, ORG, "sessao-1")).toBe("desfeito");
    expect(h.apagarWebhook).toHaveBeenCalledWith("chave-propria", "w-2");
    expect(h.desconectarConta).not.toHaveBeenCalled();
  });

  it("webhook colado à mão: nada a desfazer, nenhuma chamada ao provedor", async () => {
    const { db } = dbFalso({ ...base, zernio_token_encrypted: "cifrada" });
    expect(await desfazerNoProvedor(db, ORG, "sessao-1")).toBe("nada_a_desfazer");
    expect(h.apagarWebhook).not.toHaveBeenCalled();
    expect(h.desconectarConta).not.toHaveBeenCalled();
  });

  it("um clique sem a chave da instalação: diz que não teve como, sem lançar", async () => {
    h.chave.mockResolvedValue(null);
    const { db } = dbFalso({
      ...base,
      zernio_credencial_da_instalacao: true,
      zernio_webhook_id: "w-1",
    });
    expect(await desfazerNoProvedor(db, ORG, "sessao-1")).toBe("sem_credencial");
    expect(h.apagarWebhook).not.toHaveBeenCalled();
  });
});
