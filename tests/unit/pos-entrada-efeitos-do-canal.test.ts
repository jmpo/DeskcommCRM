import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EntradaDeMensagem } from "@/lib/channels/pos-entrada";

/**
 * OS EFEITOS QUE TRANSFORMAM UMA MENSAGEM EM TRABALHO.
 *
 * ─── O defeito, medido em produção ──────────────────────────────────────────
 *
 *   ai_agent.dispatch_requested   QR 806   oficial 0
 *   leads a partir da conversa    QR  19   oficial 1  (em 28 conversas)
 *   contatos bloqueados por STOP           0 em 101
 *
 * Opt-out, nascimento do lead e despacho do agente moravam dentro de
 * `lib/waha/ingest.ts`. A pessoa que escrevia para o número oficial entrava no
 * CRM e parava ali: sem card no funil, sem agente, e — o pior — com o pedido de
 * "PARAR" evaporando num canal onde a plataforma cobra por mensagem e pune a
 * denúncia de spam.
 *
 * ─── Por que a maioria dos casos é sobre ORDEM ──────────────────────────────
 *
 * Os três efeitos rodam em sequência, e a sequência é regra de negócio:
 * inverter opt-out e lead faz quem pediu para sair virar card de oportunidade.
 * Uma troca de ordem não quebra tipo nem derruba nada em runtime — quebra em
 * silêncio, semanas depois. Só um teste que observe a ORDEM a segura.
 */

const audit = vi.fn(async () => {});
const garantirLeadDaConversa = vi.fn(async () => ({ criado: true, leadId: "lead-1" }) as never);

vi.mock("@/lib/audit", () => ({ audit: (...a: unknown[]) => audit(...(a as [])) }));
vi.mock("@/lib/leads/nascimento-do-lead", () => ({
  garantirLeadDaConversa: (...a: unknown[]) => garantirLeadDaConversa(...(a as [])),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

/** A sequência do que ACONTECEU — é o que os casos de ordem inspecionam. */
let sequencia: string[] = [];
let updateErro: { message: string } | null = null;
let rpcErro: { message: string } | null = null;
let ultimoUpdate: Record<string, unknown> | null = null;
let ultimaRpc: Record<string, unknown> | null = null;

/** Imita o builder do PostgREST: encadeável, o efeito acontece no `await`. */
function cadeia(rotulo: string): Record<string, unknown> {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown) => void) => {
            sequencia.push(rotulo);
            return Promise.resolve({ error: updateErro }).then(resolve);
          };
        }
        return () => cadeia(rotulo);
      },
    },
  ) as Record<string, unknown>;
}

const admin = {
  from(tabela: string) {
    return {
      update(payload: Record<string, unknown>) {
        ultimoUpdate = payload;
        return cadeia(`update:${tabela}`);
      },
    };
  },
  async rpc(nome: string, args: Record<string, unknown>) {
    ultimaRpc = args;
    sequencia.push(`rpc:${args.p_event_type ?? nome}`);
    return { error: rpcErro };
  },
} as never;

const ENTRADA: EntradaDeMensagem = {
  organizationId: "org-1",
  contactId: "contato-1",
  conversationId: "conversa-1",
  messageId: "msg-1",
  channelSessionId: "sessao-1",
  texto: "oi, tudo bem?",
  nomeDoContato: "Cliente",
  requestId: "req-1",
  origem: "canal_de_teste",
};

async function rodar(over: Partial<EntradaDeMensagem> = {}) {
  const { aplicarEfeitosPosEntrada } = await import("@/lib/channels/pos-entrada");
  await aplicarEfeitosPosEntrada(admin, { ...ENTRADA, ...over });
}

beforeEach(() => {
  sequencia = [];
  updateErro = null;
  rpcErro = null;
  ultimoUpdate = null;
  ultimaRpc = null;
  audit.mockClear();
  garantirLeadDaConversa.mockClear();
  garantirLeadDaConversa.mockResolvedValue({ criado: true, leadId: "lead-1" } as never);
});

describe("a ordem dos três efeitos", () => {
  it("opt-out acontece ANTES do nascimento do lead", async () => {
    // Esta é a razão de o arquivo existir. `garantirLeadDaConversa` RELÊ o
    // contato e recusa criar card para bloqueado — mas só se o bloqueio já
    // estiver gravado. Ao contrário, quem acabou de pedir para sair vira
    // oportunidade nova no funil, e ninguém olha um card para descobrir isso.
    let leadViuASequencia: string[] = [];
    garantirLeadDaConversa.mockImplementation(async () => {
      leadViuASequencia = [...sequencia];
      return { criado: true, leadId: "lead-1" } as never;
    });

    await rodar({ texto: "PARAR" });

    expect(leadViuASequencia, "o lead nasceu antes de o opt-out ser gravado").toContain(
      "update:contacts",
    );
  });

  it("o lead nasce ANTES de o agente ser acordado", async () => {
    // O turno do agente resolve o lead ativo do contato. Despachar primeiro faz
    // o primeiro turno rodar sem lead — exatamente o buraco que esta peça fecha.
    let leadJaTinhaNascido = false;
    garantirLeadDaConversa.mockImplementation(async () => {
      leadJaTinhaNascido = !sequencia.includes("rpc:ai_agent.dispatch_requested");
      return { criado: true, leadId: "lead-1" } as never;
    });

    await rodar();

    expect(leadJaTinhaNascido, "o despacho saiu antes do lead").toBe(true);
    expect(sequencia).toContain("rpc:ai_agent.dispatch_requested");
  });
});

describe("opt-out", () => {
  it("bloqueia o contato quando a mensagem pede para sair", async () => {
    await rodar({ texto: "quero PARAR de receber" });
    expect(ultimoUpdate).toMatchObject({ is_blocked: true, blocked_reason: "stop_keyword" });
  });

  it("NÃO bloqueia quem só escreveu uma palavra parecida", async () => {
    // Sem as bordas `\b`, "PARARÁ" e "SAIRÁ" bloqueariam o contato — e o cliente
    // deixaria de receber sem ter pedido nada. É o falso positivo que custa mais
    // caro dos dois, porque some em silêncio.
    await rodar({ texto: "amanhã ele sairá do escritório e pararão as obras" });
    expect(sequencia, "bloqueou por uma palavra que só CONTÉM o termo").not.toContain(
      "update:contacts",
    );
  });

  it("mensagem sem texto não bloqueia ninguém", async () => {
    await rodar({ texto: null });
    expect(sequencia).not.toContain("update:contacts");
  });

  it("registra a auditoria do bloqueio", async () => {
    // É a linha que prova, depois, que o pedido chegou e foi respeitado.
    await rodar({ texto: "STOP" });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "contact.blocked", organizationId: "org-1" }),
    );
  });

  it("falha ao gravar o bloqueio NÃO impede o resto da ingestão", async () => {
    // A mensagem já está gravada. Derrubar aqui devolveria 500 ao provider, que
    // reenviaria tudo — trocaria um efeito faltando por uma tempestade.
    updateErro = { message: "banco indisponível" };
    await rodar({ texto: "PARAR" });
    expect(garantirLeadDaConversa).toHaveBeenCalled();
    expect(sequencia).toContain("rpc:ai_agent.dispatch_requested");
  });
});

describe("despacho do agente", () => {
  it("emite com o payload que o consumidor lê, campo a campo", async () => {
    // O consumidor é UM só. Um payload por canal faria o worker adivinhar de
    // quem veio.
    await rodar();
    expect(ultimaRpc).toMatchObject({
      p_event_type: "ai_agent.dispatch_requested",
      p_entity_kind: "message",
      p_entity_id: "msg-1",
      p_organization_id: "org-1",
      p_payload: {
        organization_id: "org-1",
        conversation_id: "conversa-1",
        contact_id: "contato-1",
        channel_session_id: "sessao-1",
        inbound_message_id: "msg-1",
      },
    });
  });

  it("sem id de mensagem NÃO despacha", async () => {
    // Reentrega não gera linha nova. Despachar sem id faria o worker buscar uma
    // mensagem que não existe e marcar falha numa ingestão perfeita.
    await rodar({ messageId: null });
    expect(sequencia).not.toContain("rpc:ai_agent.dispatch_requested");
  });

  it("falha do emit não derruba a ingestão", async () => {
    rpcErro = { message: "rpc fora do ar" };
    await expect(rodar()).resolves.toBeUndefined();
  });
});

describe("nascimento do lead", () => {
  it("leva o nome do contato para batizar o card", async () => {
    await rodar({ nomeDoContato: "Marcela" });
    expect(garantirLeadDaConversa).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ nomeDoContato: "Marcela", conversationId: "conversa-1" }),
    );
  });

  it("exceção no nascimento não impede o despacho", async () => {
    garantirLeadDaConversa.mockRejectedValue(new Error("funil não configurado") as never);
    await rodar();
    expect(sequencia).toContain("rpc:ai_agent.dispatch_requested");
  });
});

/**
 * A fiação. Os casos acima provam que o passo compartido FAZ a coisa certa;
 * estes provam que os dois canais o CHAMAM — que é o defeito original.
 */
describe("os dois canais usam o mesmo passo", () => {
  const ZERNIO = readFileSync("lib/channels/zernio/ingest.ts", "utf8");
  const WAHA = readFileSync("lib/waha/ingest.ts", "utf8");

  it("o canal intermediado chama nos DOIS caminhos de inserção", () => {
    // A ingestão resolve a conversa por dois caminhos — thread conhecida e
    // âncora — e o primeiro é o mais comum. Chamar só no segundo deixaria a
    // maioria das mensagens sem nenhum dos três efeitos.
    const chamadas = [...ZERNIO.matchAll(/await efeitosDaEntrada\(/g)];
    expect(chamadas.length, "faltou o passo em um dos caminhos").toBe(2);
  });

  it("o canal intermediado só aplica os efeitos na ENTRADA", () => {
    // O eco de um envio nosso não pede para sair nem abre demanda.
    expect(ZERNIO).toMatch(/if \(msg\.direction !== "inbound"\) return;/);
  });

  it("o canal por QR delega no compartilhado em vez de reimplementar", () => {
    expect(WAHA).toMatch(/await aplicarEfeitosPosEntrada\(admin, \{/);
  });

  it("e não guarda mais uma cópia privada da regra de opt-out", () => {
    // Duas cópias divergem na primeira vez que alguém acrescentar um termo — e
    // a que diverge é sempre a que ninguém lembra que existe.
    expect(WAHA, "o canal por QR voltou a ter regex própria de STOP").not.toMatch(
      /STOP\|PARAR\|SAIR\|UNSUBSCRIBE/,
    );
  });

  it("o vocabulário do opt-out vive num lugar só", () => {
    const compartilhado = readFileSync("lib/channels/pos-entrada.ts", "utf8");
    expect(compartilhado).toMatch(/export const STOP_RX/);
  });
});
