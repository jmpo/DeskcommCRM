/**
 * Vocabulário e transições de uma atualização disparada pela UI.
 *
 * Os valores de RunStatus e RunStep são os MESMOS do CHECK em
 * `system_update_runs` (migration 0089). O invariante
 * `tests/invariants/vocabulario-banco-x-typescript.test.ts` compara os dois —
 * mudar um lado sem o outro fica vermelho.
 */

export type RunStatus = "dispatched" | "success" | "failed" | "failed_rolled_back";
export type RunStep = "backup" | "codigo" | "banco";

/**
 * Depois disso sem notícia, a UI trata o run como desfecho desconhecido.
 * 15 min é folgado: uma atualização real leva ~2 min, e o agente ainda tenta
 * reportar por ~2 min após o reinício do app.
 */
export const RUN_STALE_AFTER_MS = 15 * 60 * 1000;

const TERMINAL: readonly RunStatus[] = ["success", "failed", "failed_rolled_back"];

/**
 * Só existe uma transição legítima: de `dispatched` para um desfecho. Um run
 * que já terminou é imutável — se o agente reportar duas vezes (retry após o
 * reinício do app), a segunda é recusada em vez de reescrever a história.
 */
export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return from === "dispatched" && TERMINAL.includes(to);
}

/**
 * `unknown` é DERIVADO na leitura, nunca gravado: um agente morto não consegue
 * anunciar a própria morte.
 */
export function isRunStale(dispatchedAt: string, now: Date): boolean {
  const started = Date.parse(dispatchedAt);
  if (Number.isNaN(started)) return true;
  return now.getTime() - started > RUN_STALE_AFTER_MS;
}

/**
 * O rollback deste run já foi superado por uma troca de app que não passou por
 * aqui?
 *
 * ## As duas situações, que o tempo sozinho NÃO separa
 *
 * **(a) Logo depois do rollback.** O agente do host roda `git describe` DEPOIS
 * do checkout, então ele reporta a versão NOVA — a que acabou de quebrar. Essa
 * batida chega segundos depois de o run terminar, e é a mentira que o run
 * existe para desfazer. Aqui o run tem de vencer.
 *
 * **(b) Oito dias e vários deploys depois.** O app trocou de versão por
 * caminhos que não criam run (`docker compose up -d`, deploy por CI,
 * `update.sh` no terminal). O run virou notícia velha e seguia nomeando a
 * versão no ar — medido em produção: o rodapé anunciou por oito dias uma versão
 * de 28 de agosto. Aqui o host tem de vencer.
 *
 * Nos DOIS o host reporta depois do run. A primeira versão desta função
 * comparava só as datas, e por isso consertava (b) quebrando (a) — pego pela
 * `tests/e2e/system-update.spec.ts`, que percorre exatamente o cenário (a).
 *
 * ## O que separa: a versão reportada, não o relógio
 *
 * Em (a) o host reporta `run.to_version` — a que o checkout instalou e que o
 * contêiner recusou. Em (b) ele reporta o que um outro caminho subiu, que é
 * outra coisa. Então o run só é superado quando o host reporta uma versão que
 * **o run não descreve** — nem a que tentou instalar, nem a que restaurou.
 *
 * O caso que fica de fora é reinstalar À MÃO exatamente a versão que falhou e
 * dessa vez funcionar: ali o rodapé segue nomeando a anterior. Falha
 * conservadora e de propósito — ela empurra para atualizar, enquanto o erro
 * oposto seria anunciar como no ar justamente a versão que quebrou.
 *
 * Falso sempre que falta uma das datas — ausência de prova não é prova de
 * deploy, e o run continua sendo a informação mais específica sobre o que subiu.
 */
export function rollbackFoiSuperado(
  versionUpdatedAt: string | null | undefined,
  runFinishedAt: string | null | undefined,
  versaoReportadaPeloHost?: string | null | undefined,
  run?: { from_version?: string | null; to_version?: string | null } | null,
): boolean {
  if (!versionUpdatedAt || !runFinishedAt) return false;
  const gravado = Date.parse(versionUpdatedAt);
  const terminou = Date.parse(runFinishedAt);
  if (Number.isNaN(gravado) || Number.isNaN(terminou)) return false;
  if (gravado <= terminou) return false;

  // Sem saber o que o host reportou, fica valendo o run: é o degrau
  // conservador, e é o comportamento de antes desta função existir.
  if (!versaoReportadaPeloHost) return false;
  const descritasPeloRun = [run?.to_version, run?.from_version].filter(Boolean);
  return !descritasPeloRun.includes(versaoReportadaPeloHost);
}
