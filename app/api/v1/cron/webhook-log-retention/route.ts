/**
 * GET /api/v1/cron/webhook-log-retention
 *
 * Poda o arquivo do corpo cru dos webhooks (`webhook_events_log`). Um lote por
 * chamada, idempotente: linha já esvaziada não é escolhida de novo.
 *
 * Por que ele existe, em uma linha: numa instalação real o arquivo era 86% do
 * banco (468 MB de 545 MB) e crescia ~23 MB/dia sem teto, contra os 500 MB do
 * plano gratuito do Supabase — onde a maioria dos clones vive. O racional
 * inteiro está em `lib/channels/retencao-do-arquivo.ts`.
 *
 * Auth: `Authorization: Bearer <INTERNAL_CRON_SECRET>` (fecha quando falta o
 * segredo). Mesma forma de `app/api/v1/cron/storage-redaction/route.ts`.
 *
 * ─── A falha da captação, no MESMO canal das podas irmãs (issue #1721) ──────
 *
 * `podarHistoricoDeCaptacao` passou a PROPAGAR o erro do DELETE — a mesma
 * decisão que a 10ª poda do `data-retention` tomou no #1719, e pelo mesmo
 * motivo. Sem esta volta, a falha da captação virava `{ apagadas: 0 }`, que
 * na resposta do cron é a MESMA linha de "não havia nada vencido".
 *
 * O que ela não pode é derrubar a parte da rodada que JÁ FOI FEITA: o arquivo
 * forense roda antes, no mesmo tique, e cada lote fecha a própria transação.
 * Então a captação entra num `try` PRÓPRIO, a falha é reportada pelos três
 * canais que as irmãs já usam (`logger.error`, a linha `retention.sweep_run`
 * com `falhou: true`, e Sentry) e a rodada responde 500 — como respondem o
 * `data-retention` e o `media-retention` quando uma das suas podas falha. O
 * que o arquivo forense conseguiu vai em `details`, para que o dia da falha
 * não vire um dia sem informação.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { LOTE_PADRAO, podarArquivoDeWebhooks } from "@/lib/channels/retencao-do-arquivo";
import { podarHistoricoDeCaptacao } from "@/lib/webhooks/retencao-da-captacao";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { autorizaCron } from "@/lib/auth/cron-auth";

export const dynamic = "force-dynamic";

const LOTE_MAXIMO = 5_000;

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  // O lote é ajustável pela URL para o PRIMEIRO dia, que é o caso incomum: uma
  // instalação que nunca podou chega aqui com dezenas de milhares de linhas
  // atrasadas, e o operador quer alcançar o estado estável sem esperar dias.
  // O teto existe porque um lote gigante segura a tabela em que TODO webhook
  // escreve — a poda derrubando a entrada de mensagem seria o oposto do ponto.
  const url = new URL(req.url);
  const pedido = Number.parseInt(url.searchParams.get("lote") ?? "", 10);
  const lote =
    Number.isFinite(pedido) && pedido > 0 ? Math.min(pedido, LOTE_MAXIMO) : LOTE_PADRAO;

  const admin = createAdminClient();

  const resultado = await podarArquivoDeWebhooks(admin, {
    diasComCorpo: env.WEBHOOK_LOG_BODY_RETENTION_DAYS,
    diasParaApagar: env.WEBHOOK_LOG_ROW_RETENTION_DAYS,
    lote,
  });

  // O HISTÓRICO de captação (`webhook_lead_captures`) roda no MESMO tique, e
  // não num cron novo: são duas tabelas do mesmo assunto, e uma rota a mais
  // seria mais uma linha no `entrypoint.sh` do scheduler para alguém esquecer
  // de agendar — o defeito que já custou meses ao risk-watcher e ao
  // routing-worker. Horizonte próprio (muito mais longo), porque lá a linha é
  // despejo de depuração e aqui ela é o produto.
  //
  // Try PRÓPRIO, e o motivo é o mesmo da cascata de LGPD no `data-retention`:
  // quem falha aqui falha aqui, e a falha é DITA. Sem esta volta a exceção
  // derruba o `ok()` da rodada e leva junto o relatório do arquivo forense —
  // que é a parte do trabalho que JÁ estava feita, porque cada lote fecha a
  // própria transação.
  //
  // A forma do reporte é a de `reportAuditFailure` (`lib/audit/index.ts`):
  // log estruturado, uma linha na trilha com `falhou: true` e o Sentry por
  // import DINÂMICO com `.catch` no fim — numa instalação com `SENTRY_DSN=off`
  // essa import pode nem carregar, e ela não pode virar a segunda falha da
  // rodada. A ordem dos três é do log para fora: o log é o que existe sempre,
  // a trilha e o Sentry são o que sobrevive ao contêiner.
  let captacao: Awaited<ReturnType<typeof podarHistoricoDeCaptacao>>;
  try {
    captacao = await podarHistoricoDeCaptacao(admin, {
      // A STRING crua, e não um número já coagido: quem interpreta é
      // `lib/retencao/politica.ts`, que sabe resolver lixo para o lado seguro E
      // devolver a frase de aviso. Coagir antes jogaria o aviso fora.
      diasBrutos: env.LEAD_CAPTURE_RETENTION_DAYS,
      lote,
    });
  } catch (err) {
    const detalhe = err instanceof Error ? err.message : String(err);
    logger.error("[webhook-log-retention] a poda da captação falhou", {
      error: detalhe,
      request_id: requestId,
    });
    void audit({
      action: "retention.sweep_run",
      organizationId: null,
      bypassedRls: true,
      metadata: {
        origem: "webhook-log-retention",
        poda: "webhook_lead_captures",
        falhou: true,
        erro: detalhe.slice(0, 300),
      },
      requestId,
    });
    void import("@sentry/nextjs")
      .then((Sentry) => {
        Sentry.captureException(err instanceof Error ? err : new Error(detalhe), {
          level: "error",
          tags: { subsystem: "retencao", poda: "webhook_lead_captures" },
          extra: { request_id: requestId },
        });
      })
      .catch(() => {
        /* sem Sentry configurado: o logger.error e a linha de trilha bastam */
      });
    // 500, como `data-retention` e `media-retention` respondem quando uma
    // poda falha: o `curl -fsS` do scheduler passa a ver a falha, e não um 200
    // de "tudo certo". O que o arquivo forense conseguiu vem em `details` — a
    // rodada falhou, e mesmo assim isto é verdade.
    return fail("internal_error", "webhook_lead_captures_retention_failed", 500, {
      requestId,
      details: { erro: detalhe.slice(0, 300), arquivo_forense: resultado },
    });
  }

  return ok({ ...resultado, captacao }, { requestId });
}
