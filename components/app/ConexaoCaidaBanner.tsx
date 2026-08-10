/**
 * A conexão caiu — e você vê isso na tela em que já está.
 *
 * ─── Por que uma faixa, se o aviso já vai para a Central ───────────────────
 *
 * Porque a Central é uma tela que se ABRE, e ninguém a abre por acaso. A falha
 * que originou este componente não foi a falta do aviso — foi a falta de alguém
 * para lê-lo: a sessão caiu, o estado foi gravado, e a descoberta aconteceu
 * horas depois, quando o dono estranhou o silêncio e foi olhar por conta própria.
 * Um aviso guardado onde ninguém passa repete exatamente esse defeito.
 *
 * Esta faixa aparece em TODA tela de /app — inclusive no inbox, onde a pessoa
 * está justamente quando as mensagens deveriam estar chegando. É o lugar onde a
 * ausência delas é sentida.
 *
 * ─── Por que não é e-mail ──────────────────────────────────────────────────
 *
 * Seria melhor: chega mesmo com o navegador fechado. Mas `RESEND_API_KEY` é
 * opcional e está VAZIA numa instalação real — e um aviso que depende de env
 * opcional é um aviso que não existe justamente em quem instalou sozinho e não
 * configurou nada. A faixa funciona em toda instalação, sem configurar nada.
 * O e-mail é um acréscimo possível depois; a faixa é o que não pode faltar.
 */
import Link from "next/link";

import type { ConexaoCaida } from "@/lib/channels/health";

/**
 * `precisaEscanear` muda o texto do botão, não só a cor: reconectar por QR é uma
 * ação concreta ("Escanear"), enquanto um canal em FAILED exige olhar o que
 * aconteceu antes de agir. Mandar "Escanear" para quem precisa investigar faria
 * a pessoa perder tempo numa tela que não resolve o problema dela.
 */
export function ConexaoCaidaBanner({ caidas }: { caidas: ConexaoCaida[] }) {
  if (caidas.length === 0) return null;

  const uma = caidas.length === 1 ? caidas[0] : null;
  const precisaEscanear = caidas.some((c) => c.status === "SCAN_QR_CODE");

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 border-b border-red-300 bg-red-100/95 px-4 py-2 text-sm text-red-950 backdrop-blur dark:border-red-800/60 dark:bg-red-950/70 dark:text-red-50"
    >
      <div className="flex items-center gap-2">
        <span aria-hidden>🔌</span>
        <span>
          {uma ? (
            <>
              WhatsApp <strong className="font-semibold">{uma.apelido}</strong> está
              desconectado
            </>
          ) : (
            <>
              <strong className="font-semibold">{caidas.length} conexões</strong> de WhatsApp
              estão desconectadas
            </>
          )}
          {" — nenhuma mensagem entra nem sai."}
        </span>
      </div>
      <Link
        href="/app/connections"
        className="rounded-md border border-red-400 bg-white/70 px-3 py-1 font-medium text-red-950 hover:bg-white dark:border-red-700 dark:bg-red-900/40 dark:text-red-50 dark:hover:bg-red-900/70"
      >
        {precisaEscanear ? "Escanear o QR" : "Ver conexões"}
      </Link>
    </div>
  );
}
