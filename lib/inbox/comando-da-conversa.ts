/**
 * Quem manda nesta conversa — a pergunta com UMA resposta.
 *
 * ## O defeito que este arquivo existe para consertar
 *
 * "Quem está atendendo?" e "o automático está ligado?" eram respondidas por
 * SETE fatos espalhados: `conversations.status`, `assigned_to_user_id`,
 * `assignee_kind`, `bot_silenced_until`, `last_handoff_at/reason` e
 * `contacts.force_human`. Cada pedaço da tela juntava um subconjunto diferente —
 * o cabeçalho olhava dois (`bot_silenced_until || force_human`), a linha da lista
 * olhava um (`status === 'ai_handling'`, por COR), e o painel direito olhava
 * nenhum. Três leituras parciais do mesmo estado é como se produz uma tela em que
 * ninguém sabe quem manda.
 *
 * Aqui não nasce estado novo: a doutrina DIRC manda **C**alcular antes de
 * duplicar, e uma oitava coluna a sincronizar seria o anti-pattern nº 5. Isto é
 * uma função pura sobre a linha que a rota JÁ devolve.
 *
 * ## Por que estes gates e não outros
 *
 * O espelho é o do MOTOR, não o do desenhista. Quem cala o automático, medido no
 * código de produção:
 *
 *   1. `contacts.force_human`            → `isLeadInHandoff`, `before-send`, worker
 *   2. `conversations.bot_silenced_until`→ `isLeadInHandoff`, worker
 *   3. `conversations.assignee_kind='user'` → worker legado (`assigned_to_human`)
 *      e, desde a migration 0173, consequência de (2): assumir grava silêncio.
 *
 * Um motivo a MAIS na lista seria a tela afirmando sobre o motor uma coisa que o
 * motor não faz. Dois candidatos ficaram FORA de propósito:
 *
 *   * **janela de 24h** — nem todo canal a tem (é uma CAPACIDADE,
 *     `freeformOutsideWindow` em `lib/channels/capabilities.ts`), e quem responde
 *     por isso na tela é o `JanelaSelo`, que consulta a capacidade. Recalcular 24h
 *     aqui diria "o automático está calado porque a janela fechou" em toda conversa
 *     de canal sem janela com mais de um dia, ao lado de um selo dizendo o
 *     contrário. E perguntar de que provider é o canal, aqui, seria o que a
 *     doutrina de restrição de canal proíbe fora de `lib/channels/` — foi o
 *     `lint:channels` que pegou a primeira versão deste comentário.
 *   * **conversa encerrada** — já é o `status`, e o `STATUS_LABEL` do cabeçalho já
 *     a mostra. Ela entra como ESTADO DE COMANDO (`encerrada`), não como motivo.
 *
 * Informação com propósito (invariante 5): cada motivo aqui muda a ação de quem
 * lê. `resposta_humana_recente` existe justamente para dizer **não faça nada** —
 * é a janela deslizante de 5 min do envio manual, que se desfaz sozinha, e hoje a
 * tela oferece um botão de "devolver" para um estado que já vai voltar sozinho.
 */

/** As colunas de que esta função precisa — nada além. */
export interface FatosDoComando {
  status: string;
  /**
   * A ORG tem atendimento automático de pé?
   *
   * `undefined` significa "não sei" — leitura em andamento ou que falhou — e é
   * tratado como "não afirme nada", nunca como `false`: dizer "não há automático"
   * por causa de uma requisição que não voltou é a mesma mentira ao contrário.
   * Com `undefined` a função mantém o comportamento de assumir que há, que é o
   * certo para a instalação configurada.
   */
  automaticoDaOrg?: boolean;
  assigned_to_user_id: string | null;
  /** Nome do atendente, quando o servidor conseguiu resolvê-lo (pode ser null). */
  assigned_to_user_name?: string | null;
  assignee_kind?: string | null;
  /** ISO, ou o literal `"infinity"` que o Postgres devolve para o silêncio durável. */
  bot_silenced_until?: string | null;
  /** A trava do CONTATO — irrevogável pelo agente. */
  force_human?: boolean | null;
}

export type Comando =
  /** Uma pessoa está no comando. */
  | { quem: "humano"; userId: string; nome: string | null }
  /** O automático está atendendo. */
  | { quem: "automatico" }
  /**
   * Sem dono e sem trava, mas a org NÃO tem atendimento automático de pé — então
   * não há quem responda. É o estado de toda instalação que ainda não configurou
   * agente, e a versão anterior desta função o chamava de "automatico": a tela
   * afirmava que o robô estava cuidando de conversas que ninguém estava
   * respondendo — na primeira impressão, que é P0.
   */
  | { quem: "ninguem" }
  /** Ninguém: o automático saiu e nenhuma pessoa assumiu. É a fila. */
  | { quem: "aguardando" }
  /** Acabou. Nem pessoa nem automático têm o que fazer aqui. */
  | { quem: "encerrada" };

export type MotivoDoSilencio =
  /** Alguém assumiu. Ação: só devolver ao automático libera. */
  | "atendente_no_comando"
  /** `contacts.force_human` — vale para TODAS as conversas deste cliente. */
  | "contato_travado"
  /** Alguém pausou de propósito, ou o automático passou o caso para uma pessoa. */
  | "pausado"
  /** Janela deslizante do envio manual. Ação: NENHUMA — volta sozinho. */
  | "resposta_humana_recente";

export interface ComandoDaConversa {
  comando: Comando;
  /** O automático responderia a próxima mensagem do cliente? */
  automaticoAtivo: boolean;
  /**
   * Existe uma TRAVA vigente a devolver — silêncio na conversa ou `force_human`
   * no contato.
   *
   * Não é o mesmo que `!automaticoAtivo`, e a diferença decide um botão. Uma
   * conversa ENCERRADA tem `automaticoAtivo: false` sem ter trava nenhuma: se o
   * botão de devolver saísse de `!automaticoAtivo`, ele apareceria em TODA
   * conversa fechada, e clicá-lo reabriria uma conversa que ninguém pediu para
   * reabrir. E o contrário também importa — a conversa fechada que ficou com uma
   * trava pendurada é justamente onde a volta mais falta, porque "Liberar" só
   * existe para o dono e a rota recusa quem não é.
   */
  travaVigente: boolean;
  /** Por que ele está calado. `null` quando está ativo. */
  motivo: MotivoDoSilencio | null;
  /**
   * Quando o silêncio se desfaz sozinho — só existe para
   * `resposta_humana_recente`. Nos outros motivos alguém tem de agir, e é a
   * diferença entre "espere" e "faça algo".
   */
  silencioAte: Date | null;
}

/** O literal que o PostgREST devolve para `timestamptz 'infinity'`. */
const INFINITO = "infinity";

const STATUS_ENCERRADOS = new Set(["closed", "archived"]);

/**
 * O silêncio, lido do jeito que o Postgres o entrega.
 *
 * ## Um ramo só, e a razão é uma sabotagem que não pegou
 *
 * A primeira versão tinha DOIS caminhos: um `if (valor === INFINITO)` explícito e,
 * depois, um fallback para data ilegível. Apagar o primeiro deixou os 20 casos
 * VERDES — porque `new Date("infinity")` já é `Invalid Date` (medido), então o
 * fallback devolvia exatamente o mesmo resultado. Dois caminhos para uma saída é
 * um ramo que nenhum teste consegue distinguir: a guarda parecia existir e não
 * existia.
 *
 * Com um ramo só, a asserção de que `'infinity'` cala o automático volta a ter
 * dentes — trocá-la por "data ilegível = sem silêncio" reprova na hora.
 *
 * E a direção da falha é deliberada: valor que não sabemos ler é tratado como
 * CALADO. Dizer "o automático está ativo" em cima de um dado ilegível é a frase
 * tranquilizadora que a doutrina proíbe — falha fechada na ação, aberta na
 * informação. `INFINITO` fica nomeado porque é quem o leitor vem procurar.
 */
function silencioVigente(
  valor: string | null | undefined,
  agora: Date,
): { vigente: boolean; duravel: boolean; ate: Date | null } {
  if (valor === null || valor === undefined) return { vigente: false, duravel: false, ate: null };
  const ate = new Date(valor);
  if (valor === INFINITO || Number.isNaN(ate.getTime())) {
    return { vigente: true, duravel: true, ate: null };
  }
  return { vigente: ate.getTime() > agora.getTime(), duravel: false, ate };
}

export function comandoDaConversa(fatos: FatosDoComando, agora: Date = new Date()): ComandoDaConversa {
  const silencio = silencioVigente(fatos.bot_silenced_until, agora);
  const travado = fatos.force_human === true;
  const encerrada = STATUS_ENCERRADOS.has(fatos.status);

  const comando: Comando = fatos.assigned_to_user_id
    ? {
        quem: "humano",
        userId: fatos.assigned_to_user_id,
        nome: fatos.assigned_to_user_name ?? null,
      }
    : encerrada
      ? { quem: "encerrada" }
      : // Sem dono: quem manda depende do automático estar de pé. Calado e sem
        // dono é a conversa que o automático escalou e ninguém pegou — a fila.
        silencio.vigente || travado
        ? { quem: "aguardando" }
        : fatos.automaticoDaOrg === false
          ? { quem: "ninguem" }
          : { quem: "automatico" };

  /**
   * Encerrada COM dono continua nomeando quem atendeu.
   *
   * A versão anterior colapsava para `encerrada` e apagava o nome — justamente na
   * aba "Fechadas", que é onde a pergunta "quem atendeu isto?" é a única que
   * importa. O produto não solta o dono ao fechar de propósito ("quem atendeu é
   * histórico"), e a tela estava jogando esse histórico fora. Que a conversa
   * acabou já é dito pelo selo de status, ao lado.
   */
  const comandoFinal: Comando = comando;

  const automaticoAtivo = !encerrada && !travado && !silencio.vigente;

  const motivo: MotivoDoSilencio | null = automaticoAtivo
    ? null
    : encerrada
      ? null // Encerrada não é silêncio: é ausência de assunto. O estado já diz.
      : travado
        ? "contato_travado"
        : // Ordem importa: a trava do CONTATO é mais forte e mais ampla que a da
          // conversa, então ela nomeia o motivo mesmo havendo silêncio local —
          // senão a tela ofereceria "devolver ao automático" explicando o motivo
          // menor, e a pessoa clicaria esperando o efeito errado.
          silencio.duravel
          ? fatos.assigned_to_user_id
            ? "atendente_no_comando"
            : "pausado"
          : "resposta_humana_recente";

  return {
    comando: comandoFinal,
    automaticoAtivo,
    travaVigente: travado || silencio.vigente,
    motivo,
    silencioAte: motivo === "resposta_humana_recente" ? silencio.ate : null,
  };
}

/**
 * O que a tela ESCREVE para cada estado. Fica aqui, ao lado da regra, porque foi
 * ter duas listas em arquivos diferentes que fez a timeline e o banco divergirem
 * (ver o cabeçalho de `lib/leads/activity-vocabulary.ts`).
 *
 * A palavra do estado é **"automático"**, nunca "IA": ela já é contrato em quatro
 * arquivos (`ConversationHeader`, `BudgetCard`, `orcamento.ts`, `dicionario.ts`) e
 * está travada por `tests/unit/handoff-por-orcamento.test.ts`, cujo controle
 * NEGATIVO usa literalmente "Voltar para a IA" como a sabotagem que deve reprovar.
 */
export const ROTULO_DO_COMANDO: Record<Comando["quem"], string> = {
  humano: "Em atendimento",
  automatico: "Automático atendendo",
  ninguem: "Sem atendente",
  aguardando: "Aguardando atendente",
  encerrada: "Encerrada",
};

export const ROTULO_DO_MOTIVO: Record<MotivoDoSilencio, string> = {
  atendente_no_comando: "Automático pausado — alguém assumiu",
  contato_travado: "Automático pausado para este cliente",
  pausado: "Automático pausado",
  resposta_humana_recente: "Automático volta em instantes",
};
