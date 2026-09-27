/**
 * A PAUSA ANTES DE O FLUXO DE SILÊNCIO RECOMEÇAR PARA QUEM JÁ PASSOU POR ELE.
 *
 * ─── O defeito ─────────────────────────────────────────────────────────────
 *
 * Medido numa instalação real (25–26/09/2026), num fluxo de silêncio de 1 hora
 * com `cancel_on_reply`:
 *
 *   - a cliente respondeu "gracias" a uma mensagem do fluxo; a resposta cancelou
 *     a inscrição, o agente respondeu, e UMA HORA depois a varredura a inscreveu
 *     de novo, do primeiro passo — outra oferta, e assim a cada "gracias";
 *   - dois contatos entraram em laço: o passo de IA terminava sem enviar (numa
 *     das conversas, porque uma pessoa da equipe já a tinha assumido), a
 *     inscrição era cancelada, e a varredura seguinte a recriava — ~95 vezes,
 *     sem nunca chegar ao segundo passo.
 *
 * O cabeçalho de `silence-sweep.ts` já registrava a lacuna: "um contato que
 * COMPLETOU ou foi cancelado pode ser re-enrollado na varredura seguinte se
 * continuar silencioso — aceitável no MVP, sem cooldown".
 *
 * ─── A regra ───────────────────────────────────────────────────────────────
 *
 * `trigger_config.params.reentry_pause_minutes` (opcional; ausente ou 0 = sem
 * pausa, o comportamento de antes). Com pausa, um contato que JÁ TEVE uma
 * inscrição ENCERRADA neste fluxo só volta a entrar quando passar a pausa
 * inteira desde o MAIS RECENTE entre:
 *
 *   - o fim dessa inscrição (cobre o laço e o fluxo que termina sem guarda);
 *   - a última mensagem do contato (cobre quem respondeu e segue conversando:
 *     cada mensagem nova recomeça a contagem).
 *
 * Quem nunca passou pelo fluxo não é afetado: entra no limiar de sempre. A
 * cadência dentro do fluxo (as esperas entre os passos) também não muda — a
 * pausa só decide QUANDO o fluxo pode recomeçar do início.
 *
 * Por fluxo, e não por organização: é a política de reentrada DESTE fluxo. O
 * índice `idx_followup_enrollments_one_live` já impede dois fluxos vivos ao
 * mesmo tempo para o mesmo contato.
 */

/** Teto da pausa: 90 dias, o mesmo do gatilho "cliente voltou". */
export const MAX_PAUSA_DE_REENTRADA_MINUTES = 90 * 24 * 60;

export interface FatosDaReentrada {
  /** Quando terminou a inscrição encerrada mais recente deste fluxo para o contato (ms). */
  encerradaEm: number;
  /** Quando o contato escreveu por último (ms); `null` se não se sabe. */
  ultimaMensagemEm: number | null;
}

/**
 * Até quando (ms) o contato espera antes de o fluxo recomeçar. `null` = não há
 * pausa a respeitar (sem pausa configurada, ou o contato nunca encerrou uma
 * inscrição deste fluxo).
 */
export function pausaDeReentradaAte(fatos: FatosDaReentrada | undefined, pausaMinutos: number): number | null {
  if (!fatos || !(pausaMinutos > 0)) return null;
  const referencia = Math.max(fatos.encerradaEm, fatos.ultimaMensagemEm ?? fatos.encerradaEm);
  return referencia + pausaMinutos * 60_000;
}

/** O contato ainda está na pausa? Inclusivo no fim: exatamente na hora, já pode entrar. */
export function emPausaDeReentrada(fatos: FatosDaReentrada | undefined, pausaMinutos: number, agora: Date): boolean {
  const ate = pausaDeReentradaAte(fatos, pausaMinutos);
  return ate !== null && agora.getTime() < ate;
}
