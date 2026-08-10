/**
 * A janela de 24 horas, do lado de QUEM ATENDE.
 *
 * ─── O que faltava ─────────────────────────────────────────────────────────
 *
 * A regra existe e é dura: nos canais com hetero-restrição (a API oficial, e
 * portanto também o parceiro que a intermedia), texto livre só sai enquanto o
 * cliente escreveu nas últimas 24 horas. Fora disso, apenas modelo aprovado —
 * a plataforma recusa com 131047.
 *
 * `windowRemainingMs` calcula isso desde sempre. Só que o ÚNICO consumidor era
 * o guardrail do agente de IA: o humano não via nada. Ele abria a conversa, não
 * tinha como saber que restavam vinte minutos, escrevia depois e recebia um
 * `failed` com um número de cinco dígitos.
 *
 * ─── Por que a tela não pergunta QUAL canal é ──────────────────────────────
 *
 * O invariante 1 da doutrina proíbe nomear provider fora de `lib/channels/` —
 * e é por isso que este arquivo existe aqui e não no componente. A tela recebe
 * um estado já decidido e não sabe (nem precisa saber) de quem é a regra.
 *
 * ─── Por que o estado é derivado a cada leitura ────────────────────────────
 *
 * Mesma razão pela qual não existe coluna de expiração (ver
 * `guardrails/messaging-window.ts`): a janela é uma CONTA sobre
 * `last_inbound_at`, e guardá-la criaria uma segunda verdade que envelhece
 * sozinha — parecendo autoritativa justamente quando já está errada.
 */
import { capabilitiesOf } from "./capabilities";
import { WINDOW_MS, windowRemainingMs } from "@/lib/agent-engine/guardrails/messaging-window";
import type { ChannelProvider } from "./types";

export type EstadoDaJanela =
  /** Canal sem restrição de janela: não há relógio a mostrar. */
  | { tipo: "sem_restricao" }
  /** Dá para escrever livremente; `restanteMs` é quanto falta para fechar. */
  | { tipo: "aberta"; restanteMs: number }
  /** Fechada: só modelo aprovado sai daqui. */
  | { tipo: "fechada" };

/**
 * O estado da janela desta conversa, agora.
 *
 * `provider` nulo devolve `sem_restricao` — conversa sem sessão resolvida não
 * tem regra conhecida, e inventar "fechada" faria a tela travar um envio que
 * talvez saísse sem problema.
 */
export function estadoDaJanela(
  provider: string | null | undefined,
  lastInboundAt: string | null,
  agora: Date,
): EstadoDaJanela {
  if (!provider) return { tipo: "sem_restricao" };

  const caps = capabilitiesOf(provider as ChannelProvider);
  // `freeformOutsideWindow: true` = o canal aceita texto livre a qualquer hora.
  // Mostrar um relógio nele seria inventar uma urgência que não existe.
  if (caps.freeformOutsideWindow) return { tipo: "sem_restricao" };

  const restanteMs = windowRemainingMs(agora, lastInboundAt ? new Date(lastInboundAt) : null);
  return restanteMs > 0 ? { tipo: "aberta", restanteMs } : { tipo: "fechada" };
}

/**
 * "23h 40m", "40m", "3m".
 *
 * Sem segundos: um número que muda sozinho na tela puxa o olho para o relógio
 * em vez da conversa, e a decisão que ele apoia ("escrevo agora ou mando
 * modelo?") não muda por causa de trinta segundos.
 *
 * Abaixo de um minuto vira "menos de 1m" e não "0m", que se lê como fechada —
 * e ainda dá para escrever.
 */
export function formatarRestante(ms: number): string {
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 1) return "menos de 1m";
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Está perto de fechar? Muda a cor do selo, não o texto.
 *
 * Duas horas porque é o horizonte em que ainda dá para AGIR — perguntar algo,
 * fechar um combinado — sem precisar de modelo. Alertar às vinte horas
 * restantes seria ruído; alertar aos cinco minutos chegaria tarde.
 */
export const LIMIAR_URGENTE_MS = 2 * 60 * 60 * 1000;

export { WINDOW_MS };
