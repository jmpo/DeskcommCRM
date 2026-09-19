import { describe, expect, it } from "vitest";

import { lerPlanilha } from "./planilha";

/**
 * `traduzir()` real só troca a CHAVE que bate byte a byte com uma entrada do
 * dicionário; o resto degrada para o próprio texto (`lib/i18n/dicionario.ts`).
 * Um mock que maiusculiza QUALQUER string escondia o bug real: a chave que o
 * código montava (`") — escreva assim…"`, com o parêntese dentro de `t()`)
 * nunca bateu com a entrada do dicionário (sem o parêntese) — e um mock
 * "universal" não reproduz esse descasamento, porque ele nunca falha em
 * traduzir nada. Este fake replica o comportamento de fallback: só a chave
 * que está no mapa mock é transformada; o resto sai como entrou.
 */
const DICIONARIO_FAKE: Record<string, string> = {
  "preço não reconhecido (": "PRECIO NO RECONOCIDO (",
  " — escreva assim: 5.499,00": " — ESCRÍBALO ASÍ: 5.499,00",
  "custo não reconhecido (": "COSTO NO RECONOCIDO (",
  "código repetido na planilha (": "CÓDIGO REPETIDO EN LA PLANILLA (",
};
const gritar = (texto: string): string => DICIONARIO_FAKE[texto] ?? texto;

describe("lerPlanilha — mensagens de erro passam por t()", () => {
  it("traduz a mensagem de preço não reconhecido por completo, incluindo o texto após o valor cru", () => {
    const csv = "codigo,nome,preco\nX1,Produto,abc\n";
    const resultado = lerPlanilha(csv, gritar);
    if ("erro" in resultado) throw new Error("não deveria ser erro de planilha inteira");
    expect(resultado.erros).toHaveLength(1);
    // O valor cru ("abc") não passa por t() — só o texto fixo ao redor, e
    // TODO ele: um pedaço que ficasse fora de `_t()` bateria com uma chave
    // ausente do DICIONARIO_FAKE e sairia em português, reprovando o teste.
    const motivo = resultado.erros[0]!.motivo;
    expect(motivo).toBe('PRECIO NO RECONOCIDO ("abc") — ESCRÍBALO ASÍ: 5.499,00');
  });

  it("traduz custo não reconhecido por completo", () => {
    const csv = "codigo,nome,preco,custo\nX1,Produto,10.00,xyz\n";
    const resultado = lerPlanilha(csv, gritar);
    if ("erro" in resultado) throw new Error("não deveria ser erro de planilha inteira");
    expect(resultado.erros[0]!.motivo).toBe('COSTO NO RECONOCIDO ("xyz")');
  });

  it("traduz código repetido por completo", () => {
    const csv = "codigo,nome,preco\nDUP,Um,10.00\nDUP,Dois,20.00\n";
    const resultado = lerPlanilha(csv, gritar);
    if ("erro" in resultado) throw new Error("não deveria ser erro de planilha inteira");
    expect(resultado.erros[0]!.motivo).toBe('CÓDIGO REPETIDO EN LA PLANILLA ("DUP")');
  });

  it("sem função t: comportamento idêntico ao de antes (degrada para o texto original)", () => {
    const csv = "codigo,nome,preco\nX1,Produto,abc\n";
    const resultado = lerPlanilha(csv);
    if ("erro" in resultado) throw new Error("não deveria ser erro de planilha inteira");
    expect(resultado.erros[0]!.motivo).toBe('preço não reconhecido ("abc") — escreva assim: 5.499,00');
  });
});

/**
 * A RECUSA DIZ QUAL COLUNA FALTA — e isso vale nos DOIS idiomas.
 *
 * ─── O defeito que este bloco guarda ────────────────────────────────────────
 *
 * A mensagem era montada com o que de fato faltava
 * (`faltando.map(...).join(" e de ")`). Ao virar chave de tradução ela virou
 * uma frase FIXA: "precisa de uma coluna de nome e de preço", dita também para
 * quem já tinha a coluna `nome` e só não tinha a de preço.
 *
 * Quem recebe esse texto vai conferir a coluna `nome` — que está lá —, não
 * encontra o erro que a mensagem descreve, e desiste do arquivo. É a primeira
 * tela do catálogo, e o idioma majoritário do produto é o português: a
 * tradução não pode custar informação a quem já usava o sistema.
 *
 * ─── Por que o caso "faltam as duas" está aqui mesmo não discriminando ──────
 *
 * Ele passa nas duas versões, de propósito: é o par do «não faça X». Sem ele,
 * "sempre diga só uma coluna" satisfaria os outros dois casos e quebraria a
 * frase de quem manda uma planilha sem cabeçalho nenhum.
 */
const ES: Record<string, string> = {
  "A planilha precisa de uma coluna de nome. Encontrei: ":
    "La planilla necesita una columna de nombre. Encontré: ",
  "A planilha precisa de uma coluna de preço. Encontrei: ":
    "La planilla necesita una columna de precio. Encontré: ",
  "A planilha precisa de uma coluna de nome e de preço. Encontrei: ":
    "La planilla necesita una columna de nombre y de precio. Encontré: ",
};
const espanhol = (texto: string): string => ES[texto] ?? texto;

function recusa(csv: string, t?: (s: string) => string): string {
  const r = lerPlanilha(csv, t);
  if (!("erro" in r)) throw new Error("a planilha deveria ter sido recusada inteira");
  return r.erro;
}

describe("lerPlanilha — a recusa nomeia a coluna que falta", () => {
  it("tem nome, falta preço: pede PREÇO e não menciona a coluna que já existe", () => {
    const erro = recusa("nome,marca\nCafé,Melitta\n");
    expect(erro).toBe("A planilha precisa de uma coluna de preço. Encontrei: nome, marca.");
    // A asserção que reprova a frase fixa: ela pediria "nome e de preço".
    expect(erro).not.toContain("coluna de nome");
  });

  it("tem preço, falta nome: pede NOME", () => {
    const erro = recusa("preco,marca\n9.90,Melitta\n");
    expect(erro).toBe("A planilha precisa de uma coluna de nome. Encontrei: preco, marca.");
    expect(erro).not.toContain("de preço");
  });

  it("faltam as duas: pede as duas", () => {
    const erro = recusa("marca,categoria\nMelitta,Café\n");
    expect(erro).toBe(
      "A planilha precisa de uma coluna de nome e de preço. Encontrei: marca, categoria.",
    );
  });

  it("em espanhol, a coluna que falta continua sendo a nomeada", () => {
    // A intenção do PR #600 — quem usa espanhol lê espanhol — sobrevive ao
    // conserto: o que não podia sobreviver era perder QUAL coluna falta.
    const erro = recusa("nome,marca\nCafé,Melitta\n", espanhol);
    expect(erro).toBe("La planilla necesita una columna de precio. Encontré: nome, marca.");
    expect(erro).not.toContain("de nombre");
  });
});

describe("a planilha em espanhol — o arquivo que a loja JÁ TEM", () => {
  /**
   * Até 19/09/2026 o vocabulário de colunas era só português, e uma planilha em
   * espanhol era RECUSADA INTEIRA: "precisa de uma coluna de nome e de preço",
   * listando as colunas que o importador acabara de ler e não entender. Quem
   * abre esse erro vê o próprio cabeçalho na mensagem e não tem como saber que
   * o problema é o idioma.
   */
  it("lê `nombre`, `precio de venta` e `stock` — o cabeçalho de uma loja hispanofalante", () => {
    const r = lerPlanilha(
      "codigo;nombre;precio de venta;precio de costo;stock;marca;categoria\n" +
        "MAS-001;Masajeador de cuello;350.000;180.000;12;RelaxPro;Salud\n",
    );
    expect("erro" in r, "a planilha em espanhol foi recusada inteira").toBe(false);
    if ("erro" in r) return;
    expect(r.produtos).toHaveLength(1);
    expect(r.produtos[0]!.nome).toBe("Masajeador de cuello");
    expect(r.produtos[0]!.preco_cents).toBe(35_000_000);
    expect(r.produtos[0]!.custo_cents).toBe(18_000_000);
    expect(r.produtos[0]!.quantidade).toBe(12);
  });

  it("`descripcion` NÃO vira nome — em espanhol as duas colunas convivem", () => {
    // Em português `descricao` mapeia para `nome`, e é certo: a planilha de lá
    // costuma ter só uma. Em espanhol o arquivo traz `nombre` E `descripcion`,
    // e aceitar a segunda como nome sobrescreveria o título do produto pelo
    // texto longo — o catálogo inteiro com o nome errado, sem erro nenhum.
    const r = lerPlanilha("nombre;descripcion;precio\nMasajeador;Con calor infrarrojo y 3 velocidades;350.000\n");
    expect("erro" in r).toBe(false);
    if ("erro" in r) return;
    expect(r.produtos[0]!.nome).toBe("Masajeador");
    expect(r.colunasIgnoradas).toContain("descripcion");
  });

  it("o português segue lido igual — o vocabulário SOMA, não troca", () => {
    const r = lerPlanilha("nome;preco de venda;estoque\nMassageador;350,00;12\n");
    expect("erro" in r).toBe(false);
    if ("erro" in r) return;
    expect(r.produtos[0]!.nome).toBe("Massageador");
    expect(r.produtos[0]!.quantidade).toBe(12);
  });
});
