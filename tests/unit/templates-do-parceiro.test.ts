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
import {
  contarVariaveis,
  lerConteudo,
  montarComponents,
} from "@/lib/channels/template-conteudo";

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

describe("o conteúdo da definição, e o campo que causava as recusas", () => {
  it("lê corpo, cabeçalho, rodapé e botões do payload cru", () => {
    const c = lerConteudo([
      { type: "HEADER", format: "TEXT", text: "Olá" },
      { type: "BODY", text: "Seu pedido {{1}} chega dia {{2}}." },
      { type: "FOOTER", text: "Equipe" },
      { type: "BUTTONS", buttons: [{ type: "URL", text: "Rastrear" }] },
    ]);
    expect(c.body).toContain("Seu pedido");
    expect(c.header).toMatchObject({ formato: "TEXT", texto: "Olá" });
    expect(c.footer).toBe("Equipe");
    expect(c.botoes).toEqual([{ tipo: "URL", texto: "Rastrear" }]);
  });

  it("tolera caixa minúscula — leitura e escrita usam formatos diferentes", () => {
    // A leitura vem da plataforma em maiúsculas; a escrita do intermediário em
    // minúsculas. Um lado só faria metade das definições parecer vazia.
    const c = lerConteudo([{ type: "body", text: "oi" }]);
    expect(c.body).toBe("oi");
  });

  it("definição sem rodapé não é erro", () => {
    const c = lerConteudo([{ type: "BODY", text: "oi" }]);
    expect(c.footer).toBeNull();
    expect(c.botoes).toEqual([]);
  });

  it("conta as variáveis pelo MAIOR índice, não pelas ocorrências", () => {
    // `{{1}}` repetido pede UM valor; `{{1}}` e `{{3}}` pedem TRÊS, porque a
    // plataforma numera por posição e recusa lista com buracos.
    expect(contarVariaveis("oi {{1}}, tudo bem {{1}}?")).toBe(1);
    expect(contarVariaveis("{{1}} e {{3}}")).toBe(3);
    expect(contarVariaveis("sem variável")).toBe(0);
  });

  it("MONTA o example que a revisão exige — a causa das recusas", () => {
    // O formulário deixava digitar `{{1}}` e nunca coletava a amostra. Recusa
    // garantida, por omissão da nossa tela.
    const comps = montarComponents({ body: "Olá {{1}}", exemplos: ["María"] }) as {
      type: string;
      example?: { body_text: string[][] };
    }[];
    expect(comps[0]?.example?.body_text).toEqual([["María"]]);
  });

  it("o example é ARRAY DE ARRAYS — array simples é recusado", () => {
    const comps = montarComponents({ body: "{{1}} {{2}}", exemplos: ["a", "b"] }) as {
      example?: { body_text: string[][] };
    }[];
    expect(Array.isArray(comps[0]?.example?.body_text?.[0])).toBe(true);
  });

  it("campo em branco vira marcador, não vazio — vazio também é recusado", () => {
    const comps = montarComponents({ body: "Olá {{1}}", exemplos: ["  "] }) as {
      example?: { body_text: string[][] };
    }[];
    expect(comps[0]?.example?.body_text?.[0]?.[0]).toBe("exemplo");
  });

  it("sem variável NÃO manda example — campo vazio à toa também é recusa", () => {
    const comps = montarComponents({ body: "Texto fixo", exemplos: [] }) as {
      example?: unknown;
    }[];
    expect(comps[0]?.example).toBeUndefined();
  });

  it("a tela OFERECE a categoria — antes tudo saía como UTILITY", () => {
    // Mandar promoção como utility é reclassificado ou recusado, e a tarifa da
    // categoria errada é mais cara.
    const fonte = readFileSync("components/connections/TemplatesParceiroClient.tsx", "utf8");
    expect(fonte).toMatch(/category: categoria/);
    expect(fonte).toMatch(/value="MARKETING"/);
    expect(fonte).toMatch(/value="AUTHENTICATION"/);
  });

  it("e PEDE os exemplos, em vez de mandar sem eles", () => {
    const fonte = readFileSync("components/connections/TemplatesParceiroClient.tsx", "utf8");
    expect(fonte).toMatch(/montarComponents\(\{ body: corpo, footer: rodape, exemplos \}\)/);
    expect(fonte).toMatch(/nVariaveis > 0 &&/);
  });

  it("a rota devolve o CONTEÚDO, não só o estado", () => {
    const fonte = readFileSync("app/api/v1/channels/partner/templates/route.ts", "utf8");
    expect(fonte).toMatch(/components: \(t\.components as unknown\[\]\) \?\? \[\]/);
  });
});
