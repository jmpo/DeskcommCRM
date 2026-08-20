/**
 * channel-health — o vigia que PERGUNTA se a conexão está de pé.
 *
 * ─── Por que perguntar, se o webhook já conta ──────────────────────────────
 *
 * Porque o webhook emudece exatamente quando mais falta. Ele avisa em segundos
 * enquanto o transporte está vivo; quando o transporte morre, o container cai ou
 * a assinatura do webhook se perde, não chega evento nenhum — e "nenhum evento"
 * é indistinguível de "tudo bem". A coluna segue dizendo `WORKING` para sempre.
 *
 * Foi assim que uma desconexão real passou horas despercebida numa instalação de
 * verdade: nada quebrou, nada alertou, e o dono só descobriu ao estranhar que
 * ninguém escrevia e ir olhar por conta própria.
 *
 * Este cron fecha esse buraco pelo único jeito que existe: fazendo a pergunta.
 * Silêncio deixa de ser resposta.
 *
 * ─── O que ele NÃO faz ─────────────────────────────────────────────────────
 *
 * Não reinicia sessão. Religar sozinho uma conexão que caiu por bloqueio da
 * plataforma é a receita para transformar uma suspensão temporária em definitiva
 * — e reconectar exige, com frequência, um humano com o celular na mão. O vigia
 * informa; a decisão é de quem lê.
 *
 * ─── E o watchdog do worker, que RELIGA? ───────────────────────────────────
 *
 * `lib/agent-engine/edge/crm/session-reconciler.ts` religa — e as duas regras
 * não se contradizem porque falam de estados diferentes. Ele retoma APENAS
 * `STOPPED`, que é a sessão que o transporte não iniciou (contêiner reiniciado,
 * com a credencial intacta no volume), e NUNCA `FAILED` nem `SCAN_QR_CODE`, que
 * são justamente os estados de sessão derrubada pela plataforma ou deslogada. É
 * sobre esses dois que o parágrafo acima fala, e sobre eles nada religa sozinho.
 *
 * Se alguém for afrouxar aquele filtro, é este parágrafo que precisa cair
 * primeiro — e a razão dele continua de pé.
 *
 * Auth: Bearer INTERNAL_CRON_SECRET|INTERNAL_SECRET (fail-closed), como os demais.
 *
 * NOTA DE DEPLOY: o agendamento vive no serviço `scheduler` do
 * `docker-compose.prod.yml` — não há `vercel.json` neste repo (self-host).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import {
  CHANNEL_SESSION_REF_COLUMNS,
  DEFAULT_CHANNEL_PROVIDER,
  getAdapter,
  resolveSessionRef,
  type ChannelProvider,
  type ChannelSessionRef,
} from "@/lib/channels";
import { julgarQueda, sincronizarSaudeDaConexao } from "@/lib/channels/health";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Teto por rodada. Cada sessão é uma chamada de rede ao transporte. */
const LIMITE = 50;

type LinhaDeSessao = ChannelSessionRef & {
  id: string;
  organization_id: string;
  status: string | null;
  display_name: string | null;
  phone_number: string | null;
  archived_at: string | null;
  /** Observações ruins SEGUIDAS — é onde o anti-pisco guarda a contagem. */
  consecutive_health_fails: number | null;
};

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const accepted = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (accepted.length === 0 || !provided || !accepted.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const admin = createAdminClient();

  // Arquivada não é vigiada: ela foi desligada de propósito, e avisar que uma
  // conexão aposentada está parada é exatamente o ruído que faz o operador
  // ignorar a Central.
  const { data, error } = await admin
    .from("channel_sessions")
    .select(
      `id, organization_id, status, display_name, phone_number, archived_at, consecutive_health_fails, ${CHANNEL_SESSION_REF_COLUMNS}`,
    )
    .is("archived_at", null)
    .limit(LIMITE);

  if (error) {
    logger.error("[channel-health] query falhou", { detail: error.message, requestId });
    return fail("internal_error", error.message, 500, { requestId });
  }

  const sessoes = (data ?? []) as LinhaDeSessao[];
  let verificadas = 0;
  const desfechos: Record<string, number> = {};

  for (const s of sessoes) {
    // Pergunta ao CANAL, não ao provider: quem tem sessão para consultar
    // implementa `checkHealth`; quem não tem simplesmente não o expõe, e o vigia
    // segue adiante sem nunca perguntar QUEM ele é — o invariante 1 da doutrina.
    const adapter = getAdapter((s.provider ?? DEFAULT_CHANNEL_PROVIDER) as ChannelProvider);
    const sessionRef = resolveSessionRef(s);
    if (!adapter.checkHealth || !sessionRef) continue;

    try {
      const saude = await adapter.checkHealth({ sessionRef });
      verificadas++;

      // ─── UMA pergunta que falha não é uma conexão caída ──────────────────
      //
      // Medido: a conexão oficial piscou por 5 minutos e as duas mensagens
      // mandadas nesse intervalo ficaram em `queued` para sempre. Não houve
      // queda — a lista de contas do provedor oscilou uma vez.
      //
      // Queda só vale depois de CONFIRMACOES_PARA_QUEDA observações seguidas.
      // Recuperação, não: uma observação boa zera na hora, porque demorar a
      // acreditar na volta segue barrando envio de um canal que já voltou.
      const julgamento = julgarQueda(saude, s.consecutive_health_fails ?? 0);
      await admin
        .from("channel_sessions")
        .update({ consecutive_health_fails: julgamento.contador })
        .eq("id", s.id)
        .eq("organization_id", s.organization_id);

      // Enquanto não confirma, o mundo segue como estava: nem status novo no
      // banco, nem aviso. É o pisco sendo absorvido.
      if (julgamento.contador > 0 && !julgamento.confirmada) {
        desfechos.aguardando_confirmacao = (desfechos.aguardando_confirmacao ?? 0) + 1;
        continue;
      }

      // O status novo vale para o banco, mas SÓ quando deu para perguntar:
      // gravar por cima com um erro de rede transitório trocaria informação boa
      // por ruído, e é o mesmo cuidado que a tela de conexões já toma.
      let statusFinal = s.status;
      if (saude.reachable && saude.status && saude.status !== s.status) {
        statusFinal = saude.status;
        const agora = new Date().toISOString();
        await admin
          .from("channel_sessions")
          .update({ status: saude.status, last_status_change_at: agora })
          .eq("id", s.id)
          .eq("organization_id", s.organization_id);
      }

      const apelido = s.display_name ?? s.phone_number ?? "sem nome";
      const desfecho = await sincronizarSaudeDaConexao(
        admin,
        { id: s.id, organization_id: s.organization_id, status: statusFinal },
        saude,
        apelido,
      );
      desfechos[desfecho] = (desfechos[desfecho] ?? 0) + 1;
    } catch (err) {
      // Uma sessão problemática não derruba o lote — as outras ainda precisam
      // ser vigiadas, e é justamente numa rodada assim que alguma pode ter caído.
      logger.warn("[channel-health] falhou numa sessão", {
        sessionId: s.id,
        detail: err instanceof Error ? err.message : "erro",
        requestId,
      });
    }
  }

  return ok({ sessoes: sessoes.length, verificadas, ...desfechos }, { requestId });
}

export const GET = handle;
export const POST = handle;
