import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * O TÍTULO DO EVENTO PESSOAL NÃO ATRAVESSA PARA A TELA DO CRM.
 *
 * ─── Por que isto é um gate e não um comentário ──────────────────────────────
 * A decisão de mostrar a ocupação do Google SEM o nome do evento é deliberada, e
 * um comentário sozinho não a protege: quem chega depois lê a ausência do título
 * como esquecimento e o acrescenta achando que está melhorando a tela. Nesta
 * base a regra é conhecida — mecanismo protege, prosa é intenção.
 *
 * ─── A decisão, e ela é medida ───────────────────────────────────────────────
 * `calendar_external_events.title` EXISTE e nós o gravamos. O que não pode é
 * chegar à tela: a agenda conectada é PESSOAL de quem atende e a tela da Agenda
 * é multi-tenant, vista por gestor. "Consulta médica", "terapia", "entrevista de
 * emprego" apareceriam para o chefe.
 *
 * O cal.com decidiu o mesmo, e a prova de que é decisão e não limitação é que
 * eles gravam `summary`/`description`/`location` no cache e o `select` da
 * leitura devolve só `start`/`end`/`timeZone`. Guardar e não ler é intenção.
 *
 * E o nosso caso é pior que o deles: no cal.com a tela é do próprio dono da
 * agenda; aqui, não.
 *
 * ─── O que este gate NÃO proíbe ──────────────────────────────────────────────
 * Ler `title` no SERVIDOR para outra finalidade — um relatório do próprio dono
 * da agenda, um export de LGPD para o titular — não é o que está em jogo. O que
 * se guarda é a travessia para a TELA da Agenda, que é onde a exposição
 * acontece. Por isso o recorte é `app/app/agenda/**`, e não o repo inteiro.
 *
 * Se um dia a decisão mudar, o caminho é POR ORGANIZAÇÃO e com aviso de quem vê
 * — nunca por default. Quem for fazer isso troca este teste junto, de propósito:
 * é o passo que obriga a decisão a ser tomada por gente.
 */
const RAIZ = process.cwd();
const TELA_DA_AGENDA = path.join(RAIZ, "app", "app", "agenda");

function arquivos(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return arquivos(p);
    return e.isFile() && /\.tsx?$/.test(p) ? [p] : [];
  });
}

/** Apaga o conteúdo de linhas que são só comentário, preservando as quebras. */
function semComentarios(fonte: string): string {
  return fonte
    .split("\n")
    .map((l) => (/^\s*(\/\/|\/\*|\*)/.test(l) ? "" : l))
    .join("\n");
}

/**
 * As consultas a `calendar_external_events` feitas pela tela da Agenda, com as
 * colunas que cada uma pede.
 */
function consultasDeEventoExterno(): Array<{ onde: string; colunas: string }> {
  const out: Array<{ onde: string; colunas: string }> = [];
  for (const arquivo of arquivos(TELA_DA_AGENDA)) {
    const fonte = semComentarios(fs.readFileSync(arquivo, "utf8"));
    const rel = path.relative(RAIZ, arquivo);
    for (const m of fonte.matchAll(/\.from\("calendar_external_events"\)([\s\S]*?);/g)) {
      const cadeia = m[1] ?? "";
      const sel = /\.select\(\s*"([^"]*)"/.exec(cadeia);
      out.push({
        onde: `${rel}:${fonte.slice(0, m.index ?? 0).split("\n").length}`,
        colunas: sel?.[1] ?? "",
      });
    }
  }
  return out;
}

describe("a ocupação do Google não leva o nome do evento para a tela", () => {
  it("a tela da Agenda consulta os eventos externos (senão o gate mede o vazio)", () => {
    // Controle do instrumento. Sem isto, mover a consulta ou renomear o
    // diretório deixaria o gate verde por não medir nada — e ele afirmaria o que
    // não mediu, que é o pior desfecho para uma guarda de privacidade.
    const consultas = consultasDeEventoExterno();
    expect(
      consultas.length,
      "nenhuma consulta a `calendar_external_events` em `app/app/agenda/` — ou a " +
        "ocupação deixou de ser buscada, ou ela mudou de lugar e este gate ficou cego",
    ).toBeGreaterThanOrEqual(1);
  });

  it("nenhuma delas pede a coluna `title`", () => {
    const comTitulo = consultasDeEventoExterno()
      .filter((c) => /\btitle\b/.test(c.colunas))
      .map((c) => `${c.onde} → select("${c.colunas}")`);

    expect(
      comTitulo,
      "A tela da Agenda passou a pedir o `title` do evento externo. A agenda conectada é " +
        "PESSOAL de quem atende e esta tela é multi-tenant, vista por gestor: o nome de um " +
        "compromisso particular — 'consulta médica', 'terapia', 'entrevista' — apareceria " +
        "para o chefe. A coluna existe e nós a gravamos; o que não pode é ela atravessar " +
        "para cá. Se a decisão mudou, ela é POR ORGANIZAÇÃO e com aviso de quem vê, e este " +
        "teste muda junto — de propósito, para a decisão ser tomada por gente.",
    ).toEqual([]);
  });

  it("a sonda enxerga o `title` quando ele aparece — controle positivo", () => {
    // Sem este caso, um regex quebrado devolveria lista vazia para sempre e o
    // gate diria "nenhuma expõe" sem ter olhado. É o modo de falha que uma
    // guarda de ausência esconde melhor.
    const padrao = /\btitle\b/;
    expect(padrao.test("id, starts_at, ends_at, status")).toBe(false);
    expect(padrao.test("id, title, starts_at")).toBe(true);
  });
});
