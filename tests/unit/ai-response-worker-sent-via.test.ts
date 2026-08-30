/**
 * O que este teste protege: **a resposta da IA tem que CABER no banco.**
 *
 * O worker monta a linha outbound em `persistAndDispatch` e a grava em
 * `public.messages`, que tem a constraint `messages_sent_via_check` limitando
 * `sent_via` a um vocabulário fechado. Um valor fora dele não é rejeitado pelo
 * TypeScript (`lib/database.types.ts` tipa a coluna como `string`) nem por
 * nenhum gate do CI — o insert só falha em runtime, contra o Postgres, com:
 *
 *     outbound_insert_failed: new row for relation "messages" violates
 *     check constraint "messages_sent_via_check"
 *
 * Foi exatamente o que aconteceu: a main gravava `sent_via: "bot"`, valor que
 * nunca esteve na constraint. Como o insert é o ÚLTIMO passo do pipeline, o
 * LLM já foi chamado e pago quando a linha estoura; o evento volta para
 * `event_log` e é retentado até morrer em `dead` (5 tentativas), queimando uma
 * invocação do provider por tentativa. Para o usuário, o bot simplesmente não
 * responde.
 *
 * Por que este arquivo é necessário mesmo com o `ai-response-worker-model-routing.test.ts`
 * verde: o stub daquele teste aceita QUALQUER insert. Ele exercita o caminho
 * inteiro (`sent_to_dispatch` só existe depois que `persistAndDispatch`
 * retorna) e ainda assim passava com o valor inválido — o mock não tinha a
 * constraint. Aqui o stub valida contra o vocabulário **lido do
 * `supabase/baseline.sql`**, que é o schema que o self-hoster realmente aplica.
 * Ler do schema em vez de repetir a lista no teste é o que impede o teste de
 * concordar com o worker e os dois estarem errados juntos.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Env do self-host padrão: só a chave da Anthropic (o que o install.sh exige).
// Sem chave de embedding o RAG é pulado, então a confiança é 0 — é isso que
// deixa o gatilho G3 controlável só pelo `confidence_threshold` do agente.
const envMock: Record<string, string> = {
  ANTHROPIC_API_KEY: "sk-ant-teste",
  AI_GATEWAY_API_KEY: "",
  AI_GATEWAY_BASE_URL: "",
  OPENROUTER_API_KEY: "",
  OPENROUTER_BASE_URL: "",
  OPENAI_API_KEY: "",
};
vi.mock("@/lib/env", () => ({
  get env() {
    return envMock;
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { processMessageReceived } from "@/workers/ai-response-worker";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EventRow } from "@/lib/event-log/dispatcher";

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const CONV_ID = "44444444-4444-4444-8444-444444444444";
const MSG_ID = "55555555-5555-4555-8555-555555555555";
const CONTACT_ID = "66666666-6666-4666-8666-666666666666";
const SESSION_ID = "77777777-7777-4777-8777-777777777777";
const AGENT_ID = "88888888-8888-4888-8888-888888888888";
const OUTBOUND_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

// Corpo neutro: qualquer gatilho de handoff (G1 "falar com humano", G4
// "advogado") desviaria o fluxo ANTES do LLM e o insert nunca aconteceria.
const INBOUND_BODY = "bom dia, qual o prazo de entrega?";

/**
 * Vocabulário de `sent_via` extraído do `supabase/baseline.sql` — o mesmo
 * arquivo que o `install.sh`/`update.sh` aplicam na VPS do cliente.
 */
function vocabularioDoSchema(): string[] {
  const baseline = readFileSync(
    path.resolve(process.cwd(), "supabase/baseline.sql"),
    "utf8",
  );
  const check = /CONSTRAINT "messages_sent_via_check" CHECK \(\("sent_via" = ANY \(ARRAY\[([^\]]+)\]/
    .exec(baseline);
  if (!check?.[1]) {
    throw new Error(
      "não achei messages_sent_via_check no supabase/baseline.sql — " +
        "se a constraint mudou de forma, conserte esta extração em vez de apagar o teste",
    );
  }
  return [...check[1].matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
}

const SENT_VIA_PERMITIDOS = vocabularioDoSchema();

interface LinhaInserida {
  table: string;
  row: Record<string, unknown>;
}

/**
 * Stub do admin client que, ao contrário do usado no teste de roteamento de
 * modelo, APLICA a constraint de `sent_via` em `messages` — devolvendo o mesmo
 * formato de erro do PostgREST (código 23514) que o worker recebe do banco.
 */
function makeAdminStub(confidenceThreshold: number) {
  const inserted: LinhaInserida[] = [];

  const from = (table: string) => {
    const single: Record<string, unknown> | null =
      table === "conversations"
        ? {
            id: CONV_ID,
            organization_id: ORG_ID,
            contact_id: CONTACT_ID,
            channel_session_id: SESSION_ID,
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
          ? { id: MSG_ID, body: INBOUND_BODY, direction: "inbound", organization_id: ORG_ID }
          : table === "ai_agents"
            ? {
                id: AGENT_ID,
                organization_id: ORG_ID,
                model: "anthropic/claude-sonnet-4-6",
                system_prompt: "Você é um atendente.",
                config: { confidence_threshold: confidenceThreshold },
                guardrails: {},
                active_kb_version_id: "99999999-9999-4999-8999-999999999999",
                is_active: true,
                is_default: true,
                // O banco tem `kind` NOT NULL DEFAULT 'rag_bot' e os dois ponteiros:
                // sem eles o dublê descreveria uma linha que não existe, e a régua
                // de `lib/ai/agents/no-ar.ts` — que falha FECHADA quando o select
                // não trouxe `kind` — recusaria o agente pelo motivo errado.
                kind: "rag_bot",
                published_version_id: null,
                archived_at: null,
              }
            : null; // ai_budgets sem linha = sem throttle; crm_leads sem lead

    // O dublê precisa DIZER em que mundo está (issue #129). O worker agora
    // pergunta se a org tem agente com versão PUBLICADA — se tem, quem responde
    // é o agent-engine e ele cede. Estes casos exercitam o caminho legado (sem
    // publicação), então a consulta discriminada devolve `null`. Sem isto o
    // Proxy devolveria a MESMA linha de agente para as duas perguntas, e o
    // worker cederia sempre — os testes ficariam verdes medindo o skip.
    let consultaDePublicado = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const terminais: any = {
      maybeSingle: () =>
        Promise.resolve({ data: consultaDePublicado ? null : single, error: null }),
      single: () => Promise.resolve({ data: single, error: null }),
      insert: (row: Record<string, unknown>) => {
        inserted.push({ table, row });

        // É AQUI que este teste difere do irmão: o banco de verdade recusa um
        // `sent_via` fora do vocabulário, então o stub recusa também.
        const sentVia = row["sent_via"];
        const violaCheck =
          table === "messages" &&
          typeof sentVia === "string" &&
          !SENT_VIA_PERMITIDOS.includes(sentVia);
        const erro = violaCheck
          ? {
              code: "23514",
              message:
                'new row for relation "messages" violates check constraint "messages_sent_via_check"',
            }
          : null;

        return {
          select: () => ({
            single: () =>
              Promise.resolve(
                erro ? { data: null, error: erro } : { data: { id: OUTBOUND_ID }, error: null },
              ),
          }),
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve({ data: null, error: erro }).then(resolve),
        };
      },
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({
          data:
            table === "messages"
              ? [
                  {
                    id: MSG_ID,
                    body: INBOUND_BODY,
                    direction: "inbound",
                    created_at: new Date().toISOString(),
                  },
                ]
              // A seleção de agente do worker legado é uma LISTA (ele filtra os
              // candidatos pela régua de `lib/ai/agents/no-ar.ts` em vez de cortar
              // com `.limit(1)` antes de saber quem serve). O dublê acompanha.
              : table === "ai_agents"
                ? (single ? [single] : [])
                : [],
          error: null,
        }).then(resolve),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = new Proxy(terminais, {
      get: (alvo, prop) =>
        prop in alvo
          ? alvo[prop as keyof typeof alvo]
          : (...args: unknown[]) => {
              if (prop === "not" && args[0] === "published_version_id") consultaDePublicado = true;
              return chain;
            },
    });
    return chain;
  };

  const rpc = () => Promise.resolve({ data: [], error: null });

  return { stub: { from, rpc }, inserted };
}

const eventRow = {
  organization_id: ORG_ID,
  entity_id: MSG_ID,
  payload: { message_id: MSG_ID, conversation_id: CONV_ID },
} as unknown as EventRow;

let fetchOriginal: typeof globalThis.fetch;

/** Instala o stub e devolve o registro de inserts para asserção. */
function prepararWorker(confidenceThreshold: number): LinhaInserida[] {
  const { stub, inserted } = makeAdminStub(confidenceThreshold);
  vi.mocked(createAdminClient).mockReturnValue(
    stub as unknown as ReturnType<typeof createAdminClient>,
  );
  return inserted;
}

function mensagemOutbound(inserted: LinhaInserida[]): Record<string, unknown> {
  const linhas = inserted.filter(
    (i) =>
      i.table === "messages" &&
      i.row["direction"] === "outbound" &&
      // O AVISO DE ESCALAÇÃO não é rascunho do bot: é texto de sistema que
      // `triggerHandoff` manda ao lead ao tirar a IA de campo, e ele nasce
      // marcado (`metadata.aviso_de_escalacao`). Sem este corte, o caso de
      // handoff G3 passa a ver DUAS linhas outbound e a guarda anti-vacuidade
      // abaixo reprova por um motivo que não é o deste arquivo — que é o
      // `sent_via` do RASCUNHO caber na constraint do banco.
      (i.row["metadata"] as Record<string, unknown> | null)?.["aviso_de_escalacao"] !== true,
  );
  // Anti-vacuidade: se o pipeline desviou antes do insert, não há o que
  // asseverar e o teste passaria à toa.
  expect(
    linhas.length,
    `nenhum insert outbound em messages — o pipeline não chegou a persistAndDispatch; ` +
      `inserts vistos: ${JSON.stringify(inserted.map((i) => i.table))}`,
  ).toBe(1);
  return linhas[0]!.row;
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        id: "msg_stub",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [{ type: "text", text: "Nosso prazo é de 3 dias úteis." }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 8 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

describe("ai-response-worker — a linha outbound cabe na constraint de sent_via", () => {
  it("o vocabulário veio mesmo do baseline (controle do instrumento)", () => {
    // Sem esta guarda, uma regex que parasse de casar devolveria lista vazia e
    // TODA asserção de pertinência abaixo passaria a ser trivialmente falsa —
    // ou, pior, um `includes` sobre lista vazia reprovaria por motivo errado.
    expect(SENT_VIA_PERMITIDOS.length).toBeGreaterThan(1);
    expect(SENT_VIA_PERMITIDOS).toContain("ai");
    expect(SENT_VIA_PERMITIDOS).not.toContain("bot");
  });

  it("caminho normal: persiste com sent_via aceito pelo banco e despacha", async () => {
    const inserted = prepararWorker(0); // threshold 0 ⇒ G3 não dispara
    const result = await processMessageReceived(eventRow);

    const row = mensagemOutbound(inserted);
    expect(
      SENT_VIA_PERMITIDOS,
      `sent_via=${JSON.stringify(row["sent_via"])} não está em messages_sent_via_check`,
    ).toContain(row["sent_via"]);

    expect(
      result.status,
      `reason: ${result.reason ?? "-"} | detail: ${result.detail ?? "(vazio)"}`,
    ).toBe("sent_to_dispatch");
    expect(result.outbound_message_id).toBe(OUTBOUND_ID);
  });

  it("caminho de handoff G3: o rascunho do bot também cabe na constraint", async () => {
    // O segundo call site de persistAndDispatch (skipDispatch: true). Sem RAG a
    // confiança é 0, então threshold 0.5 força o desvio por baixa confiança.
    const inserted = prepararWorker(0.5);
    const result = await processMessageReceived(eventRow);

    const row = mensagemOutbound(inserted);
    expect(
      SENT_VIA_PERMITIDOS,
      `sent_via=${JSON.stringify(row["sent_via"])} não está em messages_sent_via_check`,
    ).toContain(row["sent_via"]);

    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("handoff_g3_low_confidence");
  });

  it("o defeito, explicitado: sent_via fora do vocabulário derruba o envio", async () => {
    // Prova que a asserção acima tem dente — que o `sent_to_dispatch` do
    // primeiro caso vem de o valor ser válido, e não de o stub aceitar tudo.
    const { stub, inserted } = makeAdminStub(0);
    const comValorInvalido = {
      ...stub,
      from: (table: string) => {
        const chain = stub.from(table);
        if (table !== "messages") return chain;
        return new Proxy(chain, {
          get: (alvo, prop) =>
            prop === "insert"
              ? (row: Record<string, unknown>) =>
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (alvo as any).insert({ ...row, sent_via: "bot" })
              : // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (alvo as any)[prop],
        });
      },
    };
    vi.mocked(createAdminClient).mockReturnValue(
      comValorInvalido as unknown as ReturnType<typeof createAdminClient>,
    );

    const result = await processMessageReceived(eventRow);

    expect(mensagemOutbound(inserted)["sent_via"]).toBe("bot");
    // O worker transforma o erro do banco em throw; o handler do dispatcher
    // captura e devolve status "error", que o drain converte em retentativa.
    expect(result.status).toBe("error");
    expect(result.detail).toMatch(/outbound_insert_failed/);
    expect(result.detail).toMatch(/messages_sent_via_check/);
  });
});
