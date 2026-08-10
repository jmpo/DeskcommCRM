/**
 * QUEM GANHA QUANDO QUATRO LUGARES OPINAM SOBRE O MESMO PONTO.
 *
 * A escolha de modelo de um ponto pode vir de quatro origens, e antes desta
 * frente elas conviviam sem ordem declarada — o que produzia o pior desfecho
 * possível: o operador mudava a configuração numa tela e o comportamento não
 * mudava, porque outra origem estava vencendo em silêncio.
 *
 * A ordem, do mais forte ao mais fraco:
 *
 *  1. **Agente publicado** — só para os pontos que SÃO o agente conversando
 *     (`agent_turn`, `operator_turn`). A escolha ali já tem tela própria, e
 *     duas telas mandando na mesma coisa é como se cria a configuração que
 *     mente. O painel mostra esses dois como leitura, com link para o agente.
 *  2. **Binding do ponto** — a escolha explícita feita no painel de provedores.
 *     É a superfície nova e é ela que o operador enxerga.
 *  3. **Variável de ambiente** — os sete knobs herdados (`COMPACTION_MODEL`,
 *     `STAGE_CLASSIFIER_MODEL`, …). Continuam valendo para quem já os usa, mas
 *     perdem para uma escolha feita na tela: quem clicou depois quis mais.
 *  4. **Padrão da organização** — `organizations.settings.llm`, o que sempre
 *     valeu quando ninguém disse nada.
 *
 * A decisão devolve a ORIGEM junto com o valor. Isso não é enfeite: é o que
 * permite a tela responder "este ponto está usando X **porque**…" e o log
 * registrar a razão da escolha. Um resolvedor que devolvesse só o modelo
 * deixaria o operador na mesma dúvida de antes.
 *
 * Função pura, sem banco — mesmo motivo de `lib/routing/decide.ts` e
 * `lib/agent-engine/agent/aux-model-args.ts` existirem fora do worker: a regra
 * de precedência é a parte que erra, e ela precisa ser exercitável por teste
 * unitário. O I/O fica em quem chama.
 */
import { PONTO_POR_ID, type PontoDeIa } from "./registro";

/** De onde a escolha efetiva veio — vai para a tela e para o log. */
export type OrigemDaEscolha =
  | "agente_publicado"
  | "binding"
  | "variavel_de_ambiente"
  | "padrao_da_organizacao";

export const EXPLICACAO_DA_ORIGEM: Record<OrigemDaEscolha, string> = {
  agente_publicado: "Definido na versão publicada do agente.",
  binding: "Escolhido por você no painel de provedores.",
  variavel_de_ambiente: "Definido em variável de ambiente na instalação.",
  padrao_da_organizacao: "Usando o padrão da organização.",
};

/** Uma linha de `ai_purpose_bindings`, já filtrada por organização. */
export interface LinhaDeBinding {
  purpose: string;
  provider: string;
  credential_id: string | null;
  model_id: string;
  base_url: string | null;
  is_enabled: boolean;
}

/** O que o agente publicado impõe aos pontos que são o próprio agente. */
export interface AgentePublicado {
  provider: string;
  credentialId: string | null;
  model: string | undefined;
}

/** O padrão da organização (`organizations.settings.llm`). */
export interface PadraoDaOrganizacao {
  provider: string;
  defaultModel: string | null;
}

export interface EntradaDaDecisao {
  pontoId: string;
  binding: LinhaDeBinding | null;
  agentePublicado: AgentePublicado | null;
  /** O knob de ambiente daquele ponto, quando existe. */
  modeloDeAmbiente: string | undefined;
  padraoDaOrganizacao: PadraoDaOrganizacao;
}

export interface DecisaoDeBinding {
  provider: string;
  modelId: string | null;
  credentialId: string | null;
  baseUrl: string | null;
  origem: OrigemDaEscolha;
  /**
   * Incoerências que NÃO impedem a chamada, mas que alguém precisa ver. A
   * validação dura acontece na escrita (a API recusa binding incompatível); na
   * leitura, avisar é melhor que falhar — falhar fechado na ação, aberto na
   * informação. Sem isto, um ponto configurado errado antes de a validação
   * existir voltaria a ser uma falha muda.
   */
  avisos: string[];
}

/**
 * Os pontos cuja escolha pertence à versão publicada do agente, não ao painel.
 *
 * São os dois em que o modelo É a personalidade do agente: mudá-lo por fora
 * mudaria como o agente fala com o cliente sem passar pelo fluxo de publicação
 * (que é onde mora a revisão e o histórico de versão).
 */
export const PONTOS_DO_AGENTE_PUBLICADO: ReadonlySet<string> = new Set([
  "agent_turn",
  "operator_turn",
]);

/**
 * Modelo e credencial vêm sempre do MESMO lugar.
 *
 * Esta é a regra que o PR #151 pagou caro para aprender (ver
 * `lib/agent-engine/agent/aux-model-args.ts`): emprestar só a string do modelo
 * e deixar provider/credencial no padrão da org mandava `gpt-5-mini` para o
 * endpoint da Anthropic e matava o turno inteiro. Cada ramo abaixo devolve os
 * três campos juntos, ou nenhum.
 */
export function decidirBinding(entrada: EntradaDaDecisao): DecisaoDeBinding {
  const ponto = PONTO_POR_ID.get(entrada.pontoId);
  const avisos: string[] = [];

  // 1 · O agente publicado manda nos pontos que são o próprio agente.
  if (PONTOS_DO_AGENTE_PUBLICADO.has(entrada.pontoId) && entrada.agentePublicado !== null) {
    if (entrada.binding !== null && entrada.binding.is_enabled) {
      avisos.push(
        "Este ponto usa o modelo definido na versão publicada do agente; a escolha do painel não se aplica.",
      );
    }
    const agente = entrada.agentePublicado;
    return {
      provider: agente.provider,
      modelId: agente.model ?? entrada.padraoDaOrganizacao.defaultModel,
      credentialId: agente.credentialId,
      baseUrl: null,
      origem: "agente_publicado",
      avisos,
    };
  }

  // 2 · A escolha explícita do painel.
  if (entrada.binding !== null && entrada.binding.is_enabled) {
    if (entrada.modeloDeAmbiente !== undefined) {
      avisos.push(
        `A variável de ambiente deste ponto está definida como "${entrada.modeloDeAmbiente}", mas a escolha do painel tem prioridade.`,
      );
    }
    avisos.push(...avisosDeCapacidade(ponto, entrada.binding.model_id));
    return {
      provider: entrada.binding.provider,
      modelId: entrada.binding.model_id,
      credentialId: entrada.binding.credential_id,
      baseUrl: entrada.binding.base_url,
      origem: "binding",
      avisos,
    };
  }

  // 3 · O knob de ambiente. Herda provider/credencial do padrão da org, que é
  // exatamente o que esse knob sempre pressupôs — ele nasceu quando só havia
  // um provider por instalação.
  if (entrada.modeloDeAmbiente !== undefined) {
    return {
      provider: entrada.padraoDaOrganizacao.provider,
      modelId: entrada.modeloDeAmbiente,
      credentialId: null,
      baseUrl: null,
      origem: "variavel_de_ambiente",
      avisos,
    };
  }

  // 4 · O padrão da organização.
  return {
    provider: entrada.padraoDaOrganizacao.provider,
    modelId: entrada.padraoDaOrganizacao.defaultModel,
    credentialId: null,
    baseUrl: null,
    origem: "padrao_da_organizacao",
    avisos,
  };
}

/**
 * Avisos sobre capacidade que a leitura consegue dar sem consultar o catálogo.
 *
 * A checagem completa (o modelo suporta ferramentas? enxerga imagem?) exige o
 * catálogo e acontece na ESCRITA, onde dá para recusar. Aqui cobrimos o caso
 * que não precisa de catálogo nenhum: ponto de embedding com modelo que não é
 * de embedding — um erro de digitação que, sem aviso, degrada a busca sem
 * derrubar nada.
 */
function avisosDeCapacidade(ponto: PontoDeIa | undefined, modelId: string): string[] {
  if (ponto === undefined) return [];
  if (ponto.exige.embeddingDims === undefined) return [];
  if (/embed/i.test(modelId)) return [];
  return [
    `Este ponto precisa de um modelo de embedding, e "${modelId}" não parece ser um. A busca no seu material pode parar de encontrar o conteúdo certo.`,
  ];
}
