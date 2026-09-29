/**
 * Recorte 1 do #636 — o recorte existe e o caminho legado continua de pé.
 *
 * ─── O que este arquivo vigia ───────────────────────────────────────────────
 *
 * 1. GREP. `buildOpening`, checkpoint e `rolling_summary` saíram de
 *    `inbound-turn.ts` para `./abertura/`, mas o arquivo do turno REEXPORTA —
 *    é por `inbound-turn` que os testes e os irmãos (follow-up, resposta de
 *    caso) buscam esses símbolos. Tirar o reexport deixa isto vermelho.
 * 2. SEM CÓPIA. O símbolo que `inbound-turn` exporta É o mesmo objeto do
 *    módulo novo (`toBe`, referência). Duas definições iguais passariam em
 *    asserção de conteúdo e mudariam comportamento em silêncio — é exatamente o
 *    que a issue proíbe ("extração sem mudança de comportamento").
 * 3. FRONTEIRA. `followup-turn.ts` e `case-reply-turn.ts` não falam de
 *    "mensagem atual" (a abertura do inbound e o veto do falso-vazio são do
 *    inbound) — aceite da issue, medido aqui na fonte.
 *
 * ─── O que ele NÃO prova ────────────────────────────────────────────────────
 *
 * Ele vigia endereço e identidade de símbolo, não texto de modelo: nada aqui
 * diz que o prompt está certo ou que o modelo obedece. O texto em si continua
 * sendo vigiado pelos testes que já existem (checkpoint-declara-o-referencial,
 * mensagem-atual-prioritaria, declaracao-do-turno e os demais) — por isso este
 * arquivo não os repete.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import * as aberturaCheckpoint from "@/lib/agent-engine/agent/abertura/checkpoint";
import * as aberturaRitual from "@/lib/agent-engine/agent/abertura/ritual";
import * as turno from "@/lib/agent-engine/agent/inbound-turn";

const DIR = join(process.cwd(), "lib", "agent-engine", "agent");
const ler = (nome: string): string => readFileSync(join(DIR, nome), "utf8");

const SIMBOLOS_DO_RECORTE = [
  "buildOpeningMessage",
  "ritualBlocks",
  "CHECKPOINT_INSTRUCTION",
  "checkpointContentSchema",
  "parseCheckpointText",
] as const;

describe("o grep dos testes continua achando o recorte 1 em inbound-turn", () => {
  it("o arquivo do turno cita cada símbolo que ele reexporta", () => {
    const fonte = ler("inbound-turn.ts");
    for (const simbolo of SIMBOLOS_DO_RECORTE) {
      expect(fonte, `inbound-turn.ts não cita ${simbolo} — o grep dos testes quebra`).toContain(
        simbolo,
      );
    }
  });

  it("o reexport é o MESMO objeto do módulo novo — não existe cópia divergente", () => {
    expect(turno.buildOpeningMessage).toBe(aberturaRitual.buildOpeningMessage);
    expect(turno.ritualBlocks).toBe(aberturaRitual.ritualBlocks);
    expect(turno.CHECKPOINT_INSTRUCTION).toBe(aberturaCheckpoint.CHECKPOINT_INSTRUCTION);
    expect(turno.parseCheckpointText).toBe(aberturaCheckpoint.parseCheckpointText);
    expect(turno.checkpointContentSchema).toBe(aberturaCheckpoint.checkpointContentSchema);
  });

  it("os tipos do recorte continuam exportados por inbound-turn", () => {
    // Asserção de TIPO: `case-reply-turn`, `followup-turn` e `preview` importam
    // `LeadCheckpointRow` de `inbound-turn`; `CheckpointContent` é exportado
    // desde antes. Se um dos dois deixar de ser reexportado, isto não compila —
    // quem cobra é o `pnpm typecheck`, não o runtime.
    const anterior: turno.LeadCheckpointRow | null = null;
    const conteudo: turno.CheckpointContent | null = null;
    expect(anterior).toBeNull();
    expect(conteudo).toBeNull();
  });

  it("o módulo novo não importa de volta do inbound-turn — sem ciclo", () => {
    // Só o IMPORT conta: os cabeçalhos citam `inbound-turn.ts` em prosa, e
    // prosa não cria ciclo.
    const voltaParaOTurno = /from ["'][^"']*inbound-turn["']/;
    expect(ler(join("abertura", "checkpoint.ts"))).not.toMatch(voltaParaOTurno);
    expect(ler(join("abertura", "ritual.ts"))).not.toMatch(voltaParaOTurno);
  });
});

describe("a abertura continua montando o que ela montava", () => {
  const contexto = { contact: { name: "Cliente", email: null }, messages: [] } as never;

  it("o ritual volta com checkpoint, resumo acumulado e estado do funil", () => {
    const t = turno.ritualBlocks(null, null, contexto, "sem notas", false).join("\n");
    expect(t).toContain("Checkpoint anterior");
    expect(t).toContain("Resumo acumulado da conversa");
    expect(t).toContain("Estado do funil");
  });

  it("sem texto na mensagem atual, a abertura não promete fonte prioritária", () => {
    const abertura = turno.buildOpeningMessage(null, null, contexto, "sem notas");
    expect(abertura).toContain("Novo turno de atendimento");
    expect(abertura).toContain("## Mensagem atual do cliente");
    expect(abertura).toContain("Não há texto utilizável");
    expect(abertura).not.toContain("## Mensagem atual do cliente — fonte prioritária");
  });

  it("com texto, a abertura declara a fonte prioritária e traz o texto", () => {
    const abertura = turno.buildOpeningMessage(
      null,
      null,
      contexto,
      "sem notas",
      false,
      [],
      "",
      "Quero agendar com a Drª Mara.",
    );
    expect(abertura).toContain("## Mensagem atual do cliente — fonte prioritária");
    expect(abertura).toContain("Quero agendar com a Drª Mara.");
  });
});

describe("fronteira — follow-up e resposta de caso não falam de “inbound atual”", () => {
  it.each(["followup-turn.ts", "case-reply-turn.ts"])(
    "%s não chama a abertura de inbound nem o símbolo de mensagem atual",
    (arquivo) => {
      const fonte = ler(arquivo);
      // A abertura é do run INBOUND: quem monta o ritual no follow-up é o
      // próprio `ritualBlocks`, chamado com o bloco temporal dele.
      expect(fonte, `${arquivo} chama buildOpeningMessage`).not.toContain("buildOpeningMessage");
      // Os símbolos da mensagem que acordou o turno: texto pinado pelo job e o
      // veto de falso-vazio que vive no único caminho que fala no canal.
      expect(fonte, `${arquivo} cita símbolo de mensagem atual`).not.toMatch(
        /currentInboundText|claimsCurrentInboundIsEmpty|mensagemAtual/,
      );
    },
  );
});
