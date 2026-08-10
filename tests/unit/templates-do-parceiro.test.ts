import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * AS DEFINIÇÕES APROVADAS DO CANAL INTERMEDIADO.
 *
 * ─── O que não existia ─────────────────────────────────────────────────────
 *
 * O adapter sabe listar, criar, editar e apagar definições desde que o canal
 * entrou. O que faltava era a PORTA: a aba "Templates da Meta" vive dentro do
 * canal oficial, e o endpoint dela resolve a conexão por `metaSessionForOrg`.
 *
 * Numa instalação que só tem o canal intermediado — a do dono — isso devolve
 * lista vazia, e o seletor do inbox dizia "nenhum modelo aprovado ainda" para
 * uma conta cheia deles. Barrar o texto livre sem oferecer a saída deixou o
 * operador sem caminho nenhum.
 *
 * ─── O que estes casos prendem ─────────────────────────────────────────────
 *
 * Que a tela não decida a fonte com o nome do provider na mão; que o seletor do
 * inbox e a tela de gestão leiam a MESMA fonte; e que a lista de uma conta não
 * vaze para a conversa da outra.
 */
import { fonteDeTemplates, rotaDeTemplates } from "@/lib/channels/templates-fonte";

describe("de onde vêm as definições", () => {
  it("canal intermediado busca na rota do parceiro", () => {
    expect(fonteDeTemplates("zernio")).toBe("parceiro");
  });

  it("canal oficial busca na rota de sempre", () => {
    expect(fonteDeTemplates("meta_cloud")).toBe("oficial");
  });

  it("número por QR não tem definição a listar", () => {
    // Ele manda texto livre a qualquer hora: um seletor ali ofereceria uma
    // solução para um problema que aquele canal não tem.
    expect(fonteDeTemplates("waha")).toBeNull();
  });

  it("sem canal resolvido, não busca nada", () => {
    expect(fonteDeTemplates(null)).toBeNull();
    expect(fonteDeTemplates(undefined)).toBeNull();
  });

  it("cada fonte tem sua rota, e são DIFERENTES", () => {
    // Se as duas apontassem para a mesma, o canal intermediado voltaria a ler a
    // lista da Meta — que é exatamente o defeito de origem.
    expect(rotaDeTemplates("parceiro")).toBe("/api/v1/channels/partner/templates");
    expect(rotaDeTemplates("oficial")).toBe("/api/v1/channels/templates");
    expect(rotaDeTemplates("parceiro")).not.toBe(rotaDeTemplates("oficial"));
  });
});

describe("os elos que somem sem barulho", () => {
  it("a tela do inbox NÃO decide pelo nome do provider", () => {
    const fonte = readFileSync("components/inbox/JanelaFechadaAviso.tsx", "utf8");
    expect(fonte).toMatch(/fonteDeTemplates/);
    expect(fonte, "a tela está nomeando provider").not.toMatch(/"zernio"|"meta_cloud"|"waha"/);
  });

  it("o cache é POR FONTE — senão a lista de uma conta vaza para a outra", () => {
    // Trocar de conversa entre canais com a mesma chave serviria o cache do
    // anterior, e o operador mandaria um modelo que não existe nesta conta.
    const fonte = readFileSync("components/inbox/JanelaFechadaAviso.tsx", "utf8");
    expect(fonte).toMatch(/queryKey: \["templates-da-conversa", fonte\]/);
  });

  it("a aba existe dentro do canal do parceiro", () => {
    // Sem porta, a tela não é alcançável — e o CI já reprova tela sem porta.
    const fonte = readFileSync("components/connections/ConexoesShell.tsx", "utf8");
    expect(fonte).toMatch(/\n\s*<TemplatesParceiroClient \/>/);
    expect(fonte).toMatch(/Modelos do parceiro/);
  });

  it("a rota passa pelo SEAM, e não fala com a plataforma direto", () => {
    const fonte = readFileSync("app/api/v1/channels/partner/templates/route.ts", "utf8");
    expect(fonte).toMatch(/adapter\.templates\.list/);
    expect(fonte).toMatch(/adapter\.templates\.create/);
    // No SELECT, não só importada: a primeira versão deste caso aceitava a
    // constante presente no `import` enquanto o `select` nomeava as colunas à
    // mão. O guarda primário disto é o `lint:channels`, que reprovou a primeira
    // versão do arquivo; este caso é a rede de baixo.
    expect(fonte, "o select não usa a constante do seam").toMatch(
      /\.select\(`id, \$\{CHANNEL_SESSION_REF_COLUMNS\}`\)/,
    );
  });

  it("o espelho grava DE QUAL conexão veio (migration 0144)", () => {
    // Sem isso, dois números do mesmo provider dividem a mesma lista — e o
    // seletor de um oferece o modelo do outro.
    const fonte = readFileSync("app/api/v1/channels/partner/templates/route.ts", "utf8");
    expect(fonte).toMatch(/channel_session_id: r\.ctx\.sessionId/);
    expect(fonte).toMatch(/\.eq\("channel_session_id", r\.ctx\.sessionId\)/);
  });

  it("criar TAMBÉM sincroniza — senão o operador cria a mesma duas vezes", () => {
    // A definição nasce em revisão e não aparece na lista de envio. Se a tela
    // não a mostrasse pendente, ele concluiria que não salvou.
    const fonte = readFileSync("app/api/v1/channels/partner/templates/route.ts", "utf8");
    const iCriar = fonte.indexOf('corpo.acao === "criar"');
    const iSync = fonte.indexOf("adapter.templates.list");
    expect(iCriar).toBeGreaterThan(-1);
    expect(iSync).toBeGreaterThan(iCriar);
  });
});
