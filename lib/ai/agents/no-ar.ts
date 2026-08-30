/**
 * "Este agente está no ar?" — a pergunta com UMA resposta.
 *
 * ## O defeito que este arquivo existe para consertar
 *
 * A pergunta tinha TRÊS respostas, e as três discordavam sobre o mesmo agente:
 *
 *   1. `AgentStatusBadge.deriveAgentStatus` — o que a TELA escreve: arquivado,
 *      senão `published_version_id`, e `is_active` só para o `rag_bot` legado.
 *   2. `lib/agent-engine/agent/agent-config.ts` — o que o ENGINE executa:
 *      `join ai_agent_versions on v.id = a.published_version_id` + não
 *      arquivado + `v.status = 'published'`.
 *   3. `workers/ai-response-worker.ts` — o que o worker LEGADO executa:
 *      `.eq("is_active", true)`, e nada mais. Sem `archived_at`, sem
 *      `published_version_id`, sem `kind`.
 *
 * (1) e (2) concordam. (3) discorda dos dois — e é o que respondia ao cliente
 * sempre que a organização ficava sem nenhum agente publicado, porque a trava
 * que o segura (`skip("engine_owns_reply")`) é ORG-WIDE.
 *
 * Medido na VPS de produção em 2026-08-28: pausar o único `mcp_agent` publicado
 * desarma essa trava e devolve o atendimento ao worker legado — que continua
 * enxergando o agente recém-pausado, porque `pauseAgentAction` só desligava
 * `is_active` quando `kind !== "mcp_agent"`. O dono pausa, a tela escreve
 * **Rascunho**, e o agente responde no WhatsApp com o `system_prompt` do
 * CADASTRO (não o da versão), sem ferramentas, funis nem guardrails.
 *
 * ## Por que uma função pura, e não mais um filtro no SQL
 *
 * Um quarto `.eq()` espalhado seria a quarta régua. A doutrina DIRC manda
 * **C**alcular antes de duplicar, e aqui não nasce estado novo: é uma função
 * sobre colunas que as consultas JÁ trazem. Quem chama filtra no SQL o que é
 * barato e estreito (`organization_id`, `archived_at`) e decide aqui.
 *
 * ## Por que "no ar" tem DOIS estados e não um
 *
 * `rag_bot` ativo e nunca publicado responde — é o caminho que o worker legado
 * existe para servir, e a instalação que nunca publicou versão nenhuma depende
 * dele. Ele é `no_ar_legado`: está no ar, por outro motor e com outra config.
 *
 * Colapsar os dois num booleano só perderia justamente a distinção que o worker
 * precisa fazer (`elegivelParaWorkerLegado`), e foi tentador colapsar: a TELA
 * trata os dois como "Publicado", porque para quem olha a lista a pergunta é
 * "este agente responde?" e a resposta é sim nos dois casos. São perguntas
 * diferentes sobre o mesmo estado, e por isso `agenteAtende` e
 * `elegivelParaWorkerLegado` são funções separadas em vez de uma com um
 * parâmetro.
 */

/**
 * As colunas de que a régua precisa — nada além.
 *
 * `undefined` é aceito de propósito e significa **"o SELECT não pediu esta
 * coluna"**, não "false". Um chamador que esquece `kind` no `.select()` é o
 * modo de falha mais provável deste arquivo, e ele tem que ser seguro: ver o
 * ramo do legado em `estadoDoAgente`.
 */
export interface FatosDoAgente {
  kind?: string | null;
  is_active?: boolean | null;
  published_version_id?: string | null;
  archived_at?: string | null;
}

export type EstadoDoAgente =
  /** Arquivado. Não atende por caminho nenhum. */
  | "arquivado"
  /** Tem versão publicada: o agent-engine é o dono da resposta. */
  | "no_ar"
  /**
   * `rag_bot` legado, ativo, sem versão publicada: quem o atende é
   * `workers/ai-response-worker.ts`, com a config da própria linha de
   * `ai_agents`. Está no ar — por outro motor.
   */
  | "no_ar_legado"
  /** Existe e não responde: nem versão publicada, nem `is_active` legado. */
  | "parado";

export function estadoDoAgente(a: FatosDoAgente): EstadoDoAgente {
  if (a.archived_at != null) return "arquivado";
  // `!= null` cobre o `undefined` do select incompleto do mesmo jeito que o
  // `null` do banco: sem ponteiro conhecido, não se afirma que está no ar.
  if (a.published_version_id != null) return "no_ar";
  // Sem versão publicada, só o legado tem para onde ir — e a porta é ESTREITA:
  // exige `kind === "rag_bot"` explícito, em vez de "qualquer coisa que não
  // seja mcp_agent".
  //
  // A diferença aparece quando o `.select()` de quem chama esquece a coluna:
  // `kind` chega `undefined`, e a versão larga concluiria "legado" — mandando o
  // worker responder ao cliente por um agente sobre o qual não se sabe nada.
  // Falha fechada na AÇÃO: sem saber o kind, o agente não atende.
  //
  // O CHECK do banco (`ai_agents_kind_check`) só admite 'rag_bot' e
  // 'mcp_agent', e o default da coluna é 'rag_bot' NOT NULL — então nenhuma
  // linha real é perdida por este aperto; o que ele pega é o select incompleto.
  if (a.kind !== "rag_bot") return "parado";
  return a.is_active === true ? "no_ar_legado" : "parado";
}

/**
 * O agente responde a mensagem de cliente por ALGUM motor?
 *
 * Inclui o legado de propósito: a pergunta é "o cliente recebe resposta deste
 * agente?", e para quem nunca publicou a resposta é sim.
 */
export function agenteAtende(a: FatosDoAgente): boolean {
  const estado = estadoDoAgente(a);
  return estado === "no_ar" || estado === "no_ar_legado";
}

/**
 * Este agente é elegível para o worker LEGADO responder por ele?
 *
 * É a régua que faltava em `workers/ai-response-worker.ts`. `no_ar` fica de
 * fora porque, quando existe versão publicada, o dono da resposta é o
 * agent-engine e o worker já cede por `engine_owns_reply` — deixá-lo aqui
 * abriria a porta para os dois responderem a mesma mensagem, que é o defeito
 * que a issue #129 fechou.
 */
export function elegivelParaWorkerLegado(a: FatosDoAgente): boolean {
  return estadoDoAgente(a) === "no_ar_legado";
}
