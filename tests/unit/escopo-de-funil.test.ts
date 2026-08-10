import { describe, expect, it } from "vitest";

import { allTools } from "@/lib/mcp/tools";
import { TOOL_CATALOG } from "@/lib/mcp/tools/catalog";
import {
  ALVO_DE_FUNIL,
  podeChamarFerramenta,
  podeOperarNoFunil,
  recusaParaOModelo,
} from "@/lib/leads/escopo-de-funil";

/**
 * O AGENTE SÓ MEXE NOS FUNIS MARCADOS (spec 17 passo 3).
 *
 * Medido na produção: uma organização com 4 funis e 5 agentes de negócios
 * diferentes — um SDR, dois suportes e uma atendente de clínica. Qualquer um
 * alcançava qualquer funil.
 *
 * Este arquivo tem dois grupos, e o segundo é o que sobrevive ao tempo:
 *
 *  1. a DECISÃO — vazio é nenhum, marcado é só o marcado, e as recusas são
 *     distinguíveis entre si;
 *  2. a VACUIDADE — nenhuma ferramenta de escrita escapa da tabela. Sem isso,
 *     a próxima escrita nasce fora do gate e o escopo morre em silêncio.
 */

const FUNIL_A = "aaaaaaaa-0000-4000-8000-000000000001";
const FUNIL_B = "bbbbbbbb-0000-4000-8000-000000000002";

/** Resolve o funil sem tocar banco — a decisão é pura, o transporte é do chamador. */
const resolveFixo = (p: string | null) => async () => p;

describe("a decisão", () => {
  it("escopo VAZIO recusa — e o motivo é 'ninguém configurou', não 'não é seu'", () => {
    // Os dois negam a ação, e é aí que a semelhança acaba. Colapsá-los faria o
    // agente recém-criado receber uma explicação que não ajuda ninguém a
    // resolver o problema real, que é marcar um funil.
    const v = podeOperarNoFunil([], FUNIL_A);
    expect(v.permitido).toBe(false);
    if (v.permitido) return;
    expect(v.motivo).toBe("escopo_vazio");
  });

  it("nulo e indefinido também são vazio — o clone sem a coluna nasce fechado", () => {
    // `pipelineIds: r.pipeline_ids ?? []` no runtime cobre o clone que ainda não
    // aplicou a migration. A direção segura é agir de menos.
    expect(podeOperarNoFunil(null, FUNIL_A).permitido).toBe(false);
    expect(podeOperarNoFunil(undefined, FUNIL_A).permitido).toBe(false);
  });

  it("funil marcado passa; funil de fora é recusado COM o id", () => {
    expect(podeOperarNoFunil([FUNIL_A], FUNIL_A).permitido).toBe(true);
    const v = podeOperarNoFunil([FUNIL_A], FUNIL_B);
    expect(v.permitido).toBe(false);
    if (v.permitido) return;
    expect(v.motivo).toBe("funil_fora_do_escopo");
    // O id vai junto para o aviso na Central poder dizer QUAL funil.
    expect(v).toHaveProperty("pipelineId", FUNIL_B);
  });

  it("marcar VÁRIOS funis funciona — a org tem mais de um time", () => {
    expect(podeOperarNoFunil([FUNIL_A, FUNIL_B], FUNIL_B).permitido).toBe(true);
  });
});

describe("a chamada de ferramenta", () => {
  const base = { escopo: [FUNIL_A], ehEscrita: true, resolvePipelineDoLead: resolveFixo(FUNIL_B) };

  it("LEITURA não é escopada — e a consequência está declarada", async () => {
    // Decisão da spec 17 §5: escopo é de ESCRITA. A superfície de descoberta
    // continua aberta (o modelo vê os funis e os negócios da organização), e
    // filtrar leitura é trabalho de outro dia, atrás de medição.
    const v = await podeChamarFerramenta({
      ...base,
      ferramenta: "crm_list_leads",
      argumentos: {},
      ehEscrita: false,
    });
    expect(v.permitido).toBe(true);
  });

  it("`crm_create_lead` usa o funil que veio NO ARGUMENTO", async () => {
    const dentro = await podeChamarFerramenta({
      ...base,
      ferramenta: "crm_create_lead",
      argumentos: { pipeline_id: FUNIL_A },
    });
    expect(dentro.permitido).toBe(true);

    const fora = await podeChamarFerramenta({
      ...base,
      ferramenta: "crm_create_lead",
      argumentos: { pipeline_id: FUNIL_B },
    });
    expect(fora.permitido, "criar card no funil de outro time").toBe(false);
  });

  it("`crm_move_lead_stage` resolve o funil PELO LEAD", async () => {
    const v = await podeChamarFerramenta({
      ...base,
      ferramenta: "crm_move_lead_stage",
      argumentos: { lead_id: "1eadaaaa-0000-4000-8000-000000000001" },
      resolvePipelineDoLead: resolveFixo(FUNIL_B),
    });
    expect(v.permitido).toBe(false);
    if (v.permitido) return;
    expect(v.motivo).toBe("funil_fora_do_escopo");
  });

  it("`crm_close_demand` é escopado — encerrar é a escrita de MAIOR dano", async () => {
    // Não aparece na frase "mover card", e é a que tira o negócio do radar e
    // das cobranças. Um escopo que a esquecesse protegeria o menos importante.
    const v = await podeChamarFerramenta({
      ...base,
      ferramenta: "crm_close_demand",
      argumentos: { lead_id: "1eadaaaa-0000-4000-8000-000000000002" },
      resolvePipelineDoLead: resolveFixo(FUNIL_B),
    });
    expect(v.permitido).toBe(false);
  });

  it("`crm_manage_tags` só é escopado quando o alvo É um lead", async () => {
    const conversa = await podeChamarFerramenta({
      ...base,
      ferramenta: "crm_manage_tags",
      argumentos: { target_kind: "conversation", target_id: "x" },
    });
    expect(conversa.permitido, "taguear conversa não tem funil").toBe(true);

    const lead = await podeChamarFerramenta({
      ...base,
      ferramenta: "crm_manage_tags",
      argumentos: { target_kind: "lead", target_id: "1eadaaaa-0000-4000-8000-000000000003" },
      resolvePipelineDoLead: resolveFixo(FUNIL_B),
    });
    expect(lead.permitido, "marcar o card do outro time é escrita no funil dele").toBe(false);
  });

  it("enviar mensagem NÃO é escopado por funil — conversar não é mexer em card", async () => {
    const v = await podeChamarFerramenta({
      ...base,
      ferramenta: "crm_send_whatsapp_message",
      argumentos: {},
    });
    expect(v.permitido).toBe(true);
  });

  it("ERRO ao resolver o funil vira `indisponivel`, NUNCA 'fora do escopo'", async () => {
    // Traduzir falha de infraestrutura em recusa de permissão ensinaria ao
    // modelo que o card não é dele — e ele pararia de tentar para sempre por
    // causa de um erro passageiro. `indisponivel` convida a re-tentar.
    const v = await podeChamarFerramenta({
      ...base,
      ferramenta: "crm_move_lead_stage",
      argumentos: { lead_id: "1eadaaaa-0000-4000-8000-000000000004" },
      resolvePipelineDoLead: async () => {
        throw new Error("timeout no banco");
      },
    });
    expect(v.permitido).toBe(false);
    if (v.permitido) return;
    expect(v.motivo).toBe("indisponivel");
  });

  it("lead que não existe também é `indisponivel` — quem responde 404 é o handler", async () => {
    const v = await podeChamarFerramenta({
      ...base,
      ferramenta: "crm_move_lead_stage",
      argumentos: { lead_id: "1eadaaaa-0000-4000-8000-000000000005" },
      resolvePipelineDoLead: resolveFixo(null),
    });
    expect(v.permitido).toBe(false);
    if (v.permitido) return;
    expect(v.motivo).toBe("indisponivel");
  });

  it("escrita NÃO CLASSIFICADA é recusada — vacuidade", async () => {
    // O contrário (liberar o desconhecido) faria toda ferramenta nova nascer
    // fora do gate, que é exatamente como um escopo morre em silêncio.
    const v = await podeChamarFerramenta({
      ...base,
      ferramenta: "crm_ferramenta_que_alguem_criou_ontem",
      argumentos: {},
    });
    expect(v.permitido).toBe(false);
    if (v.permitido) return;
    expect(v.motivo).toBe("ferramenta_nao_classificada");
  });
});

describe("o que o modelo lê", () => {
  it("as duas recusas dizem coisas DIFERENTES", () => {
    const vazio = recusaParaOModelo(podeOperarNoFunil([], FUNIL_A));
    const fora = recusaParaOModelo(podeOperarNoFunil([FUNIL_A], FUNIL_B));
    expect(vazio).not.toBe(fora);
    // Acidente de configuração: aponta para quem resolve.
    expect(vazio).toMatch(/configuração|cuida do sistema/i);
    // Restrição deliberada: a configuração está certa e funcionou.
    expect(fora).toMatch(/não é da sua alçada|não alterar/i);
  });

  it("nenhuma recusa vaza nome de coluna ou de tabela", () => {
    // O texto vai para o modelo, e o modelo às vezes o repete ao cliente — a
    // doença que a spec 16 mediu em 30% dos turnos.
    for (const v of [
      podeOperarNoFunil([], FUNIL_A),
      podeOperarNoFunil([FUNIL_A], FUNIL_B),
      { permitido: false as const, motivo: "indisponivel" as const },
    ]) {
      const txt = recusaParaOModelo(v) ?? "";
      expect(txt).not.toMatch(/pipeline_id|crm_leads|uuid|escopo_vazio|null/i);
    }
  });

  it("permitido não gera texto nenhum", () => {
    expect(recusaParaOModelo({ permitido: true })).toBeNull();
  });
});

describe("VACUIDADE — nenhuma escrita escapa da tabela", () => {
  it("toda ferramenta de escrita do catálogo está classificada", () => {
    // Este caso é o que mantém `ALVO_DE_FUNIL` viva. Sem ele, a tabela vira uma
    // lista que envelhece — e a ferramenta de escrita nº 22 nasce fora do gate
    // sem nada vermelhar.
    const escritas = TOOL_CATALOG.filter((t) => t.category === "write").map((t) => t.name);
    const semClassificacao = escritas.filter((n) => ALVO_DE_FUNIL[n] === undefined).sort();

    expect(
      semClassificacao,
      `\nEstas escritas não dizem onde está o funil delas — classifique em ALVO_DE_FUNIL:\n${semClassificacao.join("\n")}\n`,
    ).toEqual([]);
  });

  it("o catálogo TEM escritas — controle positivo do caso acima", () => {
    // Zero achados só vale se houve o que procurar. Se `TOOL_CATALOG` mudasse de
    // forma, o caso anterior varreria uma lista vazia e ficaria verde para
    // sempre.
    const escritas = TOOL_CATALOG.filter((t) => t.category === "write");
    expect(escritas.length, "esperava ferramentas de escrita no catálogo").toBeGreaterThan(10);
  });

  it("a tabela não classifica ferramenta que não existe mais", () => {
    // O outro lado do envelhecimento: entrada órfã dá a impressão de cobertura
    // que não existe.
    const nomes = new Set(allTools.map((t) => t.name));
    const orfas = Object.keys(ALVO_DE_FUNIL).filter((n) => !nomes.has(n));
    expect(orfas, `entradas de ALVO_DE_FUNIL sem ferramenta correspondente: ${orfas.join(", ")}`).toEqual(
      [],
    );
  });
});
