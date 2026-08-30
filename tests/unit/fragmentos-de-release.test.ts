import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { calcularBump, FragmentoInvalido, parseFragmento } from "@/lib/release/fragmento";

/**
 * O gate do fragmento — e o que ele deliberadamente NÃO faz.
 *
 * Ele valida a FORMA de todo fragmento em `.changes/`, e não cobra a PRESENÇA
 * de um. Cobrar presença dentro de um check obrigatório quebraria três coisas
 * que este repo tem de verdade: os PRs do Dependabot (`.github/dependabot.yml`,
 * dois ecossistemas), os PRs de fork de quem contribui de fora, e — o mais
 * absurdo — o próprio PR de release, que por construção CONSOME os fragmentos e
 * deixa `.changes/` vazio. O gate existiria para produzir esse PR e o reprovaria.
 *
 * A presença é cobrada onde não trava robô: no item do Definition of Done
 * (`CLAUDE.md`) e na régua de `docs/doctrine/versionamento.md`.
 *
 * O que ESTE gate impede é o defeito que a revisão humana não pega: um
 * fragmento malformado chega ao `CHANGELOG.md`, que é TELA — e o dono da VPS lê
 * um aviso decapitado, ou não lê o aviso nenhum.
 */
const DIR = path.join(process.cwd(), ".changes");

function arquivos(): string[] {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR).filter((f) => f.endsWith(".md")).sort();
}

/** kebab-case: o nome vira parte do diff, e maiúscula/espaço quebram em outro SO. */
const NOME_VALIDO = /^[a-z0-9][a-z0-9-]*\.md$/;

describe("os fragmentos de .changes/ estão em forma de chegar à tela", () => {
  it("o diretório existe — sem ele o corte de release não tem de onde ler", () => {
    expect(fs.existsSync(DIR), ".changes/ sumiu: veja docs/doctrine/versionamento.md").toBe(true);
  });

  it.each(arquivos())("%s é legível, válido e nomeado em kebab-case", (arquivo) => {
    expect(arquivo, `nome fora do padrão kebab-case: ${arquivo}`).toMatch(NOME_VALIDO);
    const texto = fs.readFileSync(path.join(DIR, arquivo), "utf8");
    expect(() => parseFragmento(arquivo, texto)).not.toThrow();
  });

  it("o conjunto produz um número, ou não há release a cortar", () => {
    const impactos = arquivos().map((a) => parseFragmento(a, fs.readFileSync(path.join(DIR, a), "utf8")).impacto);
    if (impactos.length === 0) {
      expect(() => calcularBump(impactos)).toThrow(FragmentoInvalido);
      return;
    }
    expect(["patch", "minor", "major"]).toContain(calcularBump(impactos));
  });

  // Caso SINTÉTICO: não depende de `.changes/` ter conteúdo. Sem ele, com o
  // diretório vazio esta suíte ficaria verde sem exercitar validação nenhuma —
  // um gate que só reprova quando alguém já acertou não é gate.
  it("um fragmento malformado É recusado (a validação está viva, com o diretório vazio ou não)", () => {
    expect(() => parseFragmento("ruim.md", "sem frontmatter nenhum")).toThrow(FragmentoInvalido);
    expect(() =>
      parseFragmento("ruim.md", "---\nimpacto: minor\nsecao: corrigido\ntitulo: x\n---\n\ncorpo"),
    ).toThrow(FragmentoInvalido);
  });
});
