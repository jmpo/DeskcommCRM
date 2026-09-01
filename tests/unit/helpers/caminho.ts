import path from "node:path";

/**
 * Caminho relativo à raiz, SEMPRE em barra normal — nunca a do sistema de
 * arquivos.
 *
 * Todo gate deste repo que varre o disco compara o que achou contra uma lista
 * DECLARADA: allowlist com motivo escrito, registro de telas, conjunto de
 * esperados. Essas listas são escritas — como todo caminho neste repo — com
 * `/`. No Windows, `path.relative` devolve `app\app\ai\page.tsx`, e aí o
 * gate erra nas DUAS pontas ao mesmo tempo: o arquivo JUSTIFICADO é acusado de
 * infrator, e a justificativa que o liberava é acusada de órfã. Nenhuma das
 * duas mensagens diz "seu separador de caminho está errado" — elas dizem que
 * há dívida nova e allowlist podre, que é ruído caro num gate cuja mensagem é
 * a única coisa que a próxima pessoa lê.
 *
 * No CI (Linux) passava, então o defeito só existia na máquina de quem
 * contribui do Windows — o pior lugar para ele estar.
 *
 * Vive aqui, num lugar só, pelo mesmo motivo que a varredura de
 * `varrer-codigo.ts` vive lá: quatro cópias desta linha é a garantia de que
 * uma delas vai divergir.
 */
export function relativoEmBarraNormal(raiz: string, absoluto: string): string {
  return path.relative(raiz, absoluto).split(path.sep).join("/");
}
