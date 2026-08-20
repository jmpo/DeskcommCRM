/**
 * O CAMINHO LEGADO TAMBÉM PARA DE GASTAR SEM TETO.
 *
 * ## O defeito medido
 *
 * `workers/ai-response-worker.ts` é o pipeline pré-engine: ele responde a
 * organização que tem agente ativo mas NÃO publicou versão nenhuma — isto é, a
 * instalação nova, a da primeira impressão. Ele é vivo, ao contrário do que o
 * desenho da onda 7 concluiu: a cadeia `docker/scheduler/entrypoint.sh` →
 * `app/api/v1/cron/event-log-drain` → `lib/event-log/register-handlers.ts` →
 * `workers/ai-response-worker.handler.ts` é contínua.
 *
 * O guard de orçamento dele lia `ai_budgets.is_throttled` / `is_disabled` —
 * flags cujo ÚNICO escritor era um cron que nunca teve agendador e que esta
 * onda apagou. Guard decorativo: este caminho gastava sem teto nenhum enquanto a
 * tela do cliente prometia um.
 *
 * ## O que este arquivo prova, e por que assim
 *
 * Contra o worker REAL (admin client, gateway e SDK dublês), pelo call site — a
 * decisão não é reimplementada aqui, ela vem de `decidirOrcamento`, a mesma
 * função pura que o engine executa. O que se mede é a LIGAÇÃO: que o guard lê o
 * estado certo, executa o veredito em vez de reinventá-lo, deixa rastro na
 * Central e — o que mais importa num produto self-host — que erra para o lado
 * que NÃO estrangula.
 *
 * O caso que carrega o arquivo é o da CONDIÇÃO 6: com o gasto acima do teto e
 * nenhum aviso no mês, a resposta ainda SAI e o aviso é aberto. Sem ele, o
 * primeiro sintoma que o cliente veria da proteção que acabou de ligar seria o
 * WhatsApp mudo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/ai/gateway", () => ({
  DEFAULT_BOT_MODEL: "anthropic/claude-sonnet-4-6",
  gatewayConfig: () => ({ apiKey: "dublê" }),
  gatewayHeaders: () => ({}),
  isAiGatewayConfigured: () => true,
  isEmbeddingProviderConfigured: () => false,
  // Resolvido via `resolverModeloDoPonto`; qualquer valor não-nulo serve, porque
  // quem consome é o `generateText` dublê logo abaixo.
  resolveLanguageModel: () => "modelo-dublê",
}));
vi.mock("@/lib/ai/budget/check", () => ({ getBudgetStatus: vi.fn() }));
// O SDK nunca é alcançado de verdade: se o guard deixar passar, esta sentinela é
// que prova a passagem — e nenhum byte sai para provedor nenhum.
vi.mock("ai", () => ({
  generateText: vi.fn(async () => {
    throw new Error("SENTINELA: o pipeline passou do guard de orçamento");
  }),
}));

import { processMessageReceived } from "@/workers/ai-response-worker";
import { getBudgetStatus, type BudgetStatus } from "@/lib/ai/budget/check";
import { createAdminClient } from "@/lib/supabase/admin";
import { LIMIAR_PADRAO_PCT } from "@/lib/agent-engine/edge/llm/orcamento";
import type { EventRow } from "@/lib/event-log/dispatcher";

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const CONV_ID = "44444444-4444-4444-8444-444444444444";
const MSG_ID = "55555555-5555-4555-8555-555555555555";
const CONTACT_ID = "66666666-6666-4666-8666-666666666666";
const AGENT_ID = "88888888-8888-4888-8888-888888888888";

const ONTEM = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const AMANHA = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

/** Corpo neutro: qualquer gatilho de handoff desviaria antes do guard. */
const INBOUND_BODY = "bom dia, qual o prazo de entrega?";

/** Casa `G1_REGEX` (`lib/ai/handoff/regex.ts`): pedido explícito de humano. */
const INBOUND_PEDINDO_HUMANO = "quero falar com um atendente";

/** O estado que satisfaz TODAS as condições do bloqueio — o controle positivo. */
const ARMADO_E_ESTOURADO: BudgetStatus = {
  organization_id: ORG_ID,
  monthly_limit_cents: 1000,
  current_month_consumed_cents: 1500,
  pct: 150,
  alarm_threshold_pct: LIMIAR_PADRAO_PCT,
  enforcement_mode: "bloquear",
  enforcement_effective_at: ONTEM,
  enforcement_env: "on",
  blocked_now: false,
  gasto_incompleto: false,
  current_period_start: "2026-08-01",
  last_alarm_sent_at: null,
  updated_at: new Date().toISOString(),
};

interface Operacao {
  table: string;
  tipo: "insert" | "update";
  row: Record<string, unknown>;
}

/**
 * Stub do admin client suficiente para o pipeline CHEGAR ao guard de orçamento —
 * conversa livre, mensagem inbound, agente ativo com KB, e nenhuma versão
 * publicada (senão o worker cede ao engine e o guard nunca roda).
 *
 * `avisosNoMes` / `itensAbertos` são as duas contagens que o guard faz em
 * `agent_inbox_items`; elas se distinguem pelo filtro, não pela ordem.
 */
function makeAdminStub(
  contagens: { avisosNoMes: number; itensAbertos: number },
  corpoInbound: string = INBOUND_BODY,
) {
  const operacoes: Operacao[] = [];
  const tabelasConsultadas: string[] = [];

  const from = (table: string) => {
    tabelasConsultadas.push(table);
    const single: Record<string, unknown> | null =
      table === "conversations"
        ? {
            id: CONV_ID,
            organization_id: ORG_ID,
            contact_id: CONTACT_ID,
            channel_session_id: "77777777-7777-4777-8777-777777777777",
            last_inbound_at: new Date().toISOString(),
            bot_silenced_until: null,
            last_handoff_at: null,
            assignee_kind: "ai",
            contacts: {
              id: CONTACT_ID,
              display_name: null, // sem PII em teste (LGPD)
              locale: "pt-BR",
              is_blocked: false,
              force_human: false,
            },
          }
        : table === "messages"
          ? { id: MSG_ID, body: corpoInbound, direction: "inbound", organization_id: ORG_ID }
          : table === "ai_agents"
            ? {
                id: AGENT_ID,
                organization_id: ORG_ID,
                model: "anthropic/claude-sonnet-4-6",
                system_prompt: "Você é um atendente.",
                config: { confidence_threshold: 0 },
                guardrails: {},
                active_kb_version_id: "99999999-9999-4999-8999-999999999999",
                is_active: true,
                is_default: true,
              }
            : null;

    let consultaDePublicado = false;
    let filtraJanelaDoMes = false;
    let filtraAberto = false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const terminais: any = {
      maybeSingle: () =>
        Promise.resolve({ data: consultaDePublicado ? null : single, error: null }),
      single: () => Promise.resolve({ data: single, error: null }),
      insert: (row: Record<string, unknown>) => {
        operacoes.push({ table, tipo: "insert", row });
        return {
          select: () => ({
            single: () =>
              Promise.resolve({ data: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, error: null }),
          }),
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve({ data: null, error: null }).then(resolve),
        };
      },
      update: (row: Record<string, unknown>) => {
        operacoes.push({ table, tipo: "update", row });
        return chain;
      },
      then: (resolve: (v: unknown) => unknown) => {
        const count =
          table !== "agent_inbox_items"
            ? undefined
            : filtraAberto
              ? contagens.itensAbertos
              : filtraJanelaDoMes
                ? contagens.avisosNoMes
                : 0;
        return Promise.resolve({
          data:
            table === "messages"
              ? [
                  {
                    id: MSG_ID,
                    body: corpoInbound,
                    direction: "inbound",
                    created_at: new Date().toISOString(),
                  },
                ]
              : [],
          count,
          error: null,
        }).then(resolve);
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = new Proxy(terminais, {
      get: (alvo, prop) =>
        prop in alvo
          ? alvo[prop as keyof typeof alvo]
          : (...args: unknown[]) => {
              if (prop === "not" && args[0] === "published_version_id") consultaDePublicado = true;
              if (prop === "gte" && args[0] === "created_at") filtraJanelaDoMes = true;
              if (prop === "eq" && args[0] === "status" && args[1] === "open") filtraAberto = true;
              return chain;
            },
    });
    return chain;
  };

  const rpc = () => Promise.resolve({ data: [], error: null });
  return { stub: { from, rpc }, operacoes, tabelasConsultadas };
}

const eventRow = {
  organization_id: ORG_ID,
  entity_id: MSG_ID,
  payload: { message_id: MSG_ID, conversation_id: CONV_ID },
} as unknown as EventRow;

function montar(
  orcamento: Partial<BudgetStatus> | "erro",
  contagens: { avisosNoMes: number; itensAbertos: number } = { avisosNoMes: 0, itensAbertos: 0 },
  corpoInbound: string = INBOUND_BODY,
) {
  const { stub, operacoes, tabelasConsultadas } = makeAdminStub(contagens, corpoInbound);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(createAdminClient).mockReturnValue(stub as any);
  if (orcamento === "erro") {
    vi.mocked(getBudgetStatus).mockRejectedValue(new Error("PostgREST fora do ar"));
  } else {
    vi.mocked(getBudgetStatus).mockResolvedValue({ ...ARMADO_E_ESTOURADO, ...orcamento });
  }
  return { operacoes, tabelasConsultadas };
}

const itensDeOrcamento = (operacoes: Operacao[]) =>
  operacoes.filter((o) => o.table === "agent_inbox_items");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("o teto de gasto no caminho legado", () => {
  it("armado, estourado e já avisado no mês → a resposta é RECUSADA", async () => {
    const { operacoes } = montar({}, { avisosNoMes: 1, itensAbertos: 0 });

    const result = await processMessageReceived(eventRow);

    expect(result).toEqual({ status: "skipped", reason: "budget_exceeded" });
    // E o cliente descobre POR QUÊ: sem o item, a IA para e nada na tela explica.
    const item = itensDeOrcamento(operacoes).find((o) => o.row.kind === "budget_exceeded");
    expect(item, "IA parada sem nada na Central explicando").toBeDefined();
    expect(item?.row.severity).toBe("critical");
    expect(item?.row.organization_id).toBe(ORG_ID);
    // `ref_kind`/`ref_id` são o que permite FECHAR o item quando o mês virar.
    expect(item?.row.ref_kind).toBe("ai_budget");
    expect(item?.row.ref_id).toBe(ORG_ID);
  });

  it("CONDIÇÃO 6 — estourado mas sem aviso no mês: avisa e a resposta SAI", async () => {
    const { operacoes } = montar({}, { avisosNoMes: 0, itensAbertos: 0 });

    const result = await processMessageReceived(eventRow);

    // A sentinela do dublê do SDK: o pipeline chegou ao modelo, logo passou.
    expect(result.status).not.toBe("skipped");
    expect(String(result.detail)).toContain("SENTINELA");

    const aviso = itensDeOrcamento(operacoes).find((o) => o.row.kind === "budget_warning");
    expect(aviso, "cruzou o teto sem abrir o aviso — o bloqueio nunca poderia disparar").toBeDefined();
    expect(aviso?.row.severity, "aviso não é parada: 'critical' aqui gasta o alarme à toa").toBe(
      "warn",
    );
    expect(itensDeOrcamento(operacoes).some((o) => o.row.kind === "budget_exceeded")).toBe(false);
  });

  it("modo 'off' não consulta nem a Central — 100% das organizações no dia 1", async () => {
    const { operacoes, tabelasConsultadas } = montar({ enforcement_mode: "off" });

    const result = await processMessageReceived(eventRow);

    expect(result.status).not.toBe("skipped");
    expect(itensDeOrcamento(operacoes)).toEqual([]);
    expect(
      tabelasConsultadas.filter((t) => t === "agent_inbox_items"),
      "o atalho do modo desligado deixou de ser atalho",
    ).toEqual([]);
  });

  it("carência que ainda não venceu não bloqueia — no máximo avisa", async () => {
    const { operacoes } = montar(
      { enforcement_effective_at: AMANHA },
      { avisosNoMes: 1, itensAbertos: 0 },
    );

    const result = await processMessageReceived(eventRow);

    expect(result.status).not.toBe("skipped");
    expect(itensDeOrcamento(operacoes).some((o) => o.row.kind === "budget_exceeded")).toBe(false);
  });

  it("modo 'avisar' nunca para a IA, por mais que o gasto passe", async () => {
    const { operacoes } = montar(
      { enforcement_mode: "avisar", current_month_consumed_cents: 99_999 },
      { avisosNoMes: 1, itensAbertos: 0 },
    );

    const result = await processMessageReceived(eventRow);

    expect(result.status).not.toBe("skipped");
    expect(itensDeOrcamento(operacoes).some((o) => o.row.kind === "budget_exceeded")).toBe(false);
  });

  it("teto 0 é 'sem limite', nunca 'bloqueia tudo'", async () => {
    // A inversão que o produto tinha: `spent < 0` é falso já com gasto zero, e
    // quem recusou o orçamento de propósito levava o corte mais duro.
    const { operacoes } = montar(
      { monthly_limit_cents: 0, current_month_consumed_cents: 0 },
      { avisosNoMes: 1, itensAbertos: 0 },
    );

    const result = await processMessageReceived(eventRow);

    expect(result.status).not.toBe("skipped");
    expect(itensDeOrcamento(operacoes)).toEqual([]);
  });

  it("a chave de emergência da instalação rebaixa o bloqueio a aviso", async () => {
    const { operacoes } = montar({ enforcement_env: "avisar" }, { avisosNoMes: 1, itensAbertos: 0 });

    const result = await processMessageReceived(eventRow);

    expect(result.status).not.toBe("skipped");
    expect(itensDeOrcamento(operacoes).some((o) => o.row.kind === "budget_exceeded")).toBe(false);
  });

  it("erro na leitura do orçamento SEGUE sem teto — falha aberta, nunca fechada", async () => {
    // Errar frouxo custa dinheiro de provedor e é visível na tela de Uso; errar
    // duro mata o WhatsApp de um negócio numa VPS onde não há para quem ligar.
    const { operacoes } = montar("erro");

    const result = await processMessageReceived(eventRow);

    expect(result.status).not.toBe("skipped");
    expect(itensDeOrcamento(operacoes)).toEqual([]);
  });

  it("LAÇO DE RETORNO: gasto de volta abaixo do limiar retrata os itens abertos", async () => {
    // Sem isto o aviso atravessaria a virada do mês ABERTO, e a dedupe de "já
    // existe item aberto" impediria o aviso do mês novo — travando o bloqueio
    // para sempre num estado que ninguém consegue destravar pela tela.
    const { operacoes } = montar(
      { current_month_consumed_cents: 0 },
      { avisosNoMes: 1, itensAbertos: 1 },
    );

    const result = await processMessageReceived(eventRow);

    expect(result.status).not.toBe("skipped");
    const retrato = itensDeOrcamento(operacoes).find((o) => o.tipo === "update");
    expect(retrato, "alerta crítico aceso para sempre depois que a causa passou").toBeDefined();
    expect(retrato?.row.status).toBe("resolved");
  });

  it("dedupe: com item já aberto, nenhum novo é inserido", async () => {
    const { operacoes } = montar({}, { avisosNoMes: 1, itensAbertos: 1 });

    await processMessageReceived(eventRow);

    expect(itensDeOrcamento(operacoes).filter((o) => o.tipo === "insert")).toEqual([]);
  });
});

describe("a ORDEM do veto — o teto de gasto não cala a triagem determinística", () => {
  it("um lead que PEDE um humano é atendido mesmo com o teto estourado", async () => {
    // O veto morava dentro de `buildContext`, e `processMessageReceived` faz
    // `return` no primeiro skip: com o teto armado, G1 ("quero falar com um
    // atendente"), G4 legal e G4 stage nunca rodavam. Um pedido explícito de
    // humano virava SILÊNCIO. Pedido de humano e menção legal são
    // determinísticos e custam ZERO token — um teto de GASTO não tem o que
    // dizer sobre eles.
    const { operacoes } = montar(
      {},
      { avisosNoMes: 1, itensAbertos: 0 },
      INBOUND_PEDINDO_HUMANO,
    );

    const result = await processMessageReceived(eventRow);

    expect(
      result,
      "o teto de gasto engoliu um pedido explícito de atendimento humano",
    ).toEqual({ status: "skipped", reason: "handoff_g1_requested_human" });
    // E o teto nem chegou a ser consultado: o desvio veio antes.
    expect(vi.mocked(getBudgetStatus)).not.toHaveBeenCalled();
    expect(itensDeOrcamento(operacoes)).toEqual([]);
  });

  it("bloqueio devolve a conversa à FILA HUMANA, como o engine faz", async () => {
    // Os dois caminhos do produto param pelo mesmo veredito; dar respostas
    // opostas ao lead seria a assimetria pior possível. Além disso, o texto do
    // item `budget_exceeded` que este mesmo caminho abre PROMETE fila humana —
    // sem o handoff, o próprio alerta mentiria.
    const { operacoes } = montar({}, { avisosNoMes: 1, itensAbertos: 0 });

    const result = await processMessageReceived(eventRow);

    expect(result.reason).toBe("budget_exceeded");
    const passagem = operacoes.find(
      (o) => o.table === "conversations" && o.tipo === "update" && o.row.status === "pending",
    );
    expect(
      passagem,
      "IA parada por gasto e a conversa continua marcada como atendida pela IA — ninguém responde",
    ).toBeDefined();
    expect(passagem?.row.bot_silenced_until).toBe("infinity");
    expect(
      passagem?.row.last_handoff_reason,
      "razão diferente da que o engine grava faria quem filtra achar metade das conversas",
    ).toBe("orcamento_de_ia");
  });
});
