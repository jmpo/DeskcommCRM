/**
 * TOOLTIP COM FRASE LONGA PRECISA DECLARAR LARGURA MÁXIMA.
 *
 * O `TooltipContent` do projeto (`components/ui/tooltip.tsx`) não tem `max-w`
 * na classe base, e o Radix desenha o conteúdo com `minWidth: max-content`. Sem
 * uma largura máxima, a frase vira UMA linha: 267 caracteres deram ~1467px de
 * texto, e o fim ("…a exclusão fica travada enquanto esse histórico existir")
 * sai da tela em 1280, 1366 e 1440 px. Achado na triagem do #1215, onde o
 * tooltip é a ÚNICA explicação de por que o botão de excluir está desligado.
 *
 * A régua é o texto LITERAL dentro do bloco, porque é o que dá para medir sem
 * browser. Acima de 80 caracteres, a tag de abertura tem de trazer `max-w-`.
 *
 * ## O que este arquivo NÃO alcança
 *
 * Tooltip cujo conteúdo é uma EXPRESSÃO (`{erro.mensagem}`) pode ser tão longo
 * quanto o dado que chegar, e aqui ele conta como zero. É o caso de
 * `components/inbox/MessageBubble.tsx`, que mostra o erro do provedor: a mesma
 * classe, ainda aberta, e medi-la exige a tela. Declarado em vez de escondido.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();
const PASTAS = ["app", "components"];
const LIMITE = 80;

function arquivos(dir: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    if (nome === "node_modules" || nome === ".next") continue;
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) saida.push(...arquivos(caminho));
    else if (/\.tsx$/.test(nome)) saida.push(caminho);
  }
  return saida;
}

/** Cada `<TooltipContent …> … </TooltipContent>` do arquivo. */
function blocos(fonte: string): Array<{ abertura: string; corpo: string }> {
  const achados: Array<{ abertura: string; corpo: string }> = [];
  const re = /<TooltipContent([^>]*)>([\s\S]*?)<\/TooltipContent>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fonte)) !== null) achados.push({ abertura: m[1]!, corpo: m[2]! });
  return achados;
}

/**
 * O texto que o tooltip mostra SEM depender de dado: some com `{…}` (expressão)
 * e devolve o que sobra. `t("frase")` conta, porque a frase está no código.
 */
function textoLiteral(corpo: string): string {
  const deT = [...corpo.matchAll(/\bt\(\s*["'`]([^"'`]+)["'`]/g)].map((x) => x[1]!).join(" ");
  const fora = corpo.replace(/\{[\s\S]*?\}/g, " ").replace(/\s+/g, " ").trim();
  return `${deT} ${fora}`.trim();
}

const TOOLTIPS = arquivos(join(RAIZ, "app"))
  .concat(...PASTAS.slice(1).map((p) => arquivos(join(RAIZ, p))))
  .flatMap((caminho) =>
    blocos(readFileSync(caminho, "utf-8")).map((b) => ({
      arquivo: caminho.slice(RAIZ.length + 1),
      ...b,
      texto: textoLiteral(b.corpo),
    })),
  );

describe("tooltip com frase longa declara largura máxima", () => {
  it("a varredura acha tooltips (controle de vivacidade)", () => {
    // Sem isto, um caminho errado devolveria lista vazia e a regra abaixo
    // passaria sobre nada.
    expect(TOOLTIPS.length).toBeGreaterThanOrEqual(3);
  });

  it(`todo tooltip com mais de ${LIMITE} caracteres de texto literal tem max-w`, () => {
    const semLargura = TOOLTIPS.filter(
      (x) => x.texto.length > LIMITE && !/\bmax-w-/.test(x.abertura),
    ).map((x) => `${x.arquivo}: ${x.texto.length} caracteres`);
    expect(semLargura).toEqual([]);
  });
});
