import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * MODELO APROVADO PERTENCE A UMA CONTA, NÃO A UMA TELA.
 *
 * ─── O defeito, medido em produção (23/09/2026) ──────────────────────────────
 *
 * O dono reconectou a MESMA linha de conexão apontando para outra conta do
 * provedor (número dos EUA → número do Paraguai). A aba "Modelos do parceiro"
 * seguiu listando os 9 modelos aprovados da conta ANTERIOR:
 *
 *   name                      waba_id (conta)      channel_session_id
 *   barberpro_prueba_gratis   6a3572a15f7d17…      8a8064c0…   ← sessão ATUAL
 *   bienvenida_alta           6a3572a15f7d17…      8a8064c0…
 *   …                         (mais 7)
 *
 * A listagem filtra por `channel_session_id`, e esse não mudou — quem mudou foi
 * a CONTA. Nada no produto apagava os modelos da conta velha: o `sync` só fazia
 * `upsert` (nunca tira), e desconectar não os tocava.
 *
 * Por que não é cosmético: enviar um modelo da conta errada é recusa garantida
 * da plataforma, com a tela dizendo "APPROVED" ao lado. O operador descobre
 * pelo envio que não sai.
 *
 * Este arquivo lê o FONTE porque as três guardas são de caminhos diferentes
 * (conectar, sincronizar, tela) e o que se afirma é que cada um tem a sua —
 * a prova de comportamento de cada caminho vive nos testes daquele caminho.
 */
const CONECTAR = readFileSync("lib/channels/connect.ts", "utf8");
const SINCRONIZAR = readFileSync("app/api/v1/channels/partner/templates/route.ts", "utf8");
const TELA = readFileSync("components/connections/TemplatesParceiroClient.tsx", "utf8");

/** Comentário fora: o que se cobra é código, e comentário cita nomes de coluna. */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("os modelos seguem o número, não a linha da conexão", () => {
  it("reconectar em OUTRA conta apaga os modelos da anterior", () => {
    const fonte = semComentarios(CONECTAR);
    expect(fonte, "connect.ts não apaga modelos de outra conta").toContain("meta_templates");
    // `neq` é a alma da guarda: apagar por `channel_session_id` sozinho levaria
    // junto os modelos da conta NOVA numa reconexão com a mesma conta.
    expect(fonte).toMatch(/\.neq\(\s*["']waba_id["']/);
  });

  it("reconectar na MESMA conta não apaga nada — trocar só a chave é caso comum", () => {
    // A garantia é do `neq`: com `waba_id = accountId` a condição não casa
    // nenhuma linha. Se alguém trocar por `eq` ou tirar o filtro, o caso acima
    // segue verde e ESTE é o que reprova.
    const fonte = semComentarios(CONECTAR);
    const trecho = fonte.slice(fonte.indexOf("meta_templates"), fonte.indexOf("meta_templates") + 400);
    expect(trecho, "a limpeza deixou de ser restrita à conta anterior").not.toMatch(
      /\.eq\(\s*["']waba_id["']/,
    );
  });

  it("sincronizar ESPELHA: o que não é desta conta sai", () => {
    const fonte = semComentarios(SINCRONIZAR);
    expect(fonte, "o sync só acrescenta, nunca tira").toMatch(/\.delete\(\)/);
    expect(fonte).toMatch(/\.neq\(\s*["']waba_id["']/);
  });

  it("a tela NOMEIA o número — 'este número' sem dizer qual foi o que escondeu o defeito", () => {
    expect(TELA).toContain("numero-dos-modelos");
    expect(TELA).toContain("/api/v1/channels/partner");
  });
});
