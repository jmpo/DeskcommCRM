import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { CONFIRMACOES_PARA_QUEDA, julgarQueda } from "@/lib/channels/health";

/**
 * UMA PERGUNTA QUE FALHA NÃO É UMA CONEXÃO CAÍDA.
 *
 * ─── O defeito, medido em produção ──────────────────────────────────────────
 *
 *   20:00:16  a conexão oficial sai de WORKING
 *   20:00:22  o operador manda um texto   → queued
 *   20:01:19  o operador manda um áudio   → queued
 *   20:05:01  a conexão volta
 *
 * Cinco minutos, duas mensagens escritas à mão que nunca saíram. E não houve
 * queda: a lista de contas do provedor piscou UMA vez, e o `checkHealth`
 * traduziu isso em STOPPED na primeira tentativa.
 *
 * O canal por QR não sofria disso porque o transporte dele responde local; o
 * intermediado depende de uma API pela internet, onde piscar é normal.
 *
 * ─── Por que a recuperação NÃO espera confirmação ──────────────────────────
 *
 * Os dois erros não custam o mesmo. Demorar a acreditar numa queda custa alguns
 * minutos de aviso atrasado. Demorar a acreditar numa VOLTA custa continuar
 * barrando envio de um canal que já funciona — e é o operador que paga, tentando
 * responder um cliente que está esperando.
 */

const DE_PE = { reachable: true, status: "WORKING", detail: null };
const CAIDO = { reachable: true, status: "STOPPED", detail: null };
const NAO_SEI = { reachable: false, status: null, detail: "ECONNRESET" };

describe("o pisco não vira queda", () => {
  it("a PRIMEIRA observação ruim não confirma nada", () => {
    // É exatamente o caso que custou as duas mensagens: uma leitura ruim e o
    // sistema já declarava o canal fora do ar.
    const r = julgarQueda(CAIDO, 0);
    expect(r.confirmada, "acreditou na queda na primeira tentativa").toBe(false);
    expect(r.contador).toBe(1);
  });

  it("a segunda seguida confirma", () => {
    const r = julgarQueda(CAIDO, 1);
    expect(r.confirmada).toBe(true);
  });

  it("o limiar é o declarado, não um número solto no meio do código", () => {
    expect(julgarQueda(CAIDO, CONFIRMACOES_PARA_QUEDA - 1).confirmada).toBe(true);
    expect(julgarQueda(CAIDO, CONFIRMACOES_PARA_QUEDA - 2).confirmada).toBe(false);
  });

  it("uma observação BOA zera o contador na hora", () => {
    // Sem isto, dois piscos separados por horas somariam e derrubariam o canal.
    const r = julgarQueda(DE_PE, 1);
    expect(r.contador).toBe(0);
    expect(r.confirmada).toBe(false);
  });

  it("a volta NÃO espera confirmação — quem já voltou volta na primeira", () => {
    // O caso assimétrico de propósito. Ver o cabeçalho.
    expect(julgarQueda(DE_PE, 5).contador).toBe(0);
  });

  it("'não deu para perguntar' conta como ruim", () => {
    // Do lado de quem atende, provedor que não responde e canal caído são a
    // mesma coisa: ninguém recebe mensagem. O que muda é o texto do aviso.
    expect(julgarQueda(NAO_SEI, 0).contador).toBe(1);
    expect(julgarQueda(NAO_SEI, 1).confirmada).toBe(true);
  });

  it("status que não está na lista de alarme não conta como ruim", () => {
    // `STARTING` é o estado normal de todo boot. Contá-lo faria cada reinício
    // caminhar em direção a um aviso de queda.
    const r = julgarQueda({ reachable: true, status: "STARTING", detail: null }, 1);
    expect(r.contador).toBe(0);
  });
});

describe("a fiação no vigia", () => {
  const CRON = readFileSync("app/api/v1/cron/channel-health/route.ts", "utf8");

  it("o vigia pergunta ao juiz antes de gravar status", () => {
    const juizo = CRON.indexOf("julgarQueda(");
    const gravaStatus = CRON.indexOf('.update({ status: saude.status');
    expect(juizo).toBeGreaterThan(-1);
    expect(juizo, "gravou o status antes de julgar se a queda é real").toBeLessThan(gravaStatus);
  });

  it("enquanto não confirma, NÃO grava status nem abre aviso", () => {
    // O `continue` é o que absorve o pisco. Sem ele o contador subiria e o
    // mundo mudaria do mesmo jeito — contar sem usar não conserta nada.
    expect(CRON).toMatch(/if \(julgamento\.contador > 0 && !julgamento\.confirmada\) \{/);
    expect(CRON).toMatch(/continue;/);
  });

  it("o contador é PERSISTIDO — senão cada rodada recomeça do zero", () => {
    // Este é o modo de falha silencioso: um contador em memória num processo
    // que roda a cada 5 minutos nunca chega a 2, e o anti-pisco vira anti-tudo.
    expect(CRON).toMatch(/consecutive_health_fails: julgamento\.contador/);
  });

  it("e é LIDO da linha, não suposto", () => {
    expect(CRON).toMatch(/consecutive_health_fails, \$\{CHANNEL_SESSION_REF_COLUMNS\}/);
  });
});

describe("a espera esquecida vira aviso", () => {
  const CRON = readFileSync("app/api/v1/cron/recover-stuck-messages/route.ts", "utf8");

  it("roda MESMO quando não há nada preso em `sending`", () => {
    // É o caso comum, e a primeira versão deste conserto saía antes por um
    // `return` de atalho — teria deixado o defeito exatamente onde estava.
    const chamadas = [...CRON.matchAll(/await avisarEsperaEsquecida\(/g)];
    expect(chamadas.length, "só roda quando havia algo preso em sending").toBe(2);
  });

  it("só avisa quando a conexão JÁ VOLTOU", () => {
    // Enquanto o canal segue caído, esperar é o certo — e avisar seria repetir
    // o alerta de queda com outro nome.
    expect(CRON).toMatch(/channel_sessions\?\.status === "WORKING"/);
  });

  it("NÃO marca a mensagem como falha", () => {
    // `queued` tem dono no canal por QR; falhá-la perderia mensagem que ia
    // sair. Este conserto torna visível, não decide pelo operador.
    const trecho = CRON.slice(CRON.indexOf("async function avisarEsperaEsquecida"));
    const corpo = trecho.slice(0, trecho.indexOf("\nexport async function"));
    expect(corpo, "a varredura de espera está mudando o status da mensagem").not.toMatch(
      /status: "failed"/,
    );
  });

  it("e NÃO reenvia sozinha", () => {
    const trecho = CRON.slice(CRON.indexOf("async function avisarEsperaEsquecida"));
    const corpo = trecho.slice(0, trecho.indexOf("\nexport async function"));
    expect(corpo).not.toMatch(/sendMessageHandler|adapter\.send\(/);
  });
});
