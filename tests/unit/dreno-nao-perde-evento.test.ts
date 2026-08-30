/**
 * O DRENO NÃO PERDE EVENTO — nem por travar, nem por calar.
 *
 * Dois defeitos que se encontraram na prova de tela desta frente, e que juntos
 * apagam o material que a pessoa acabou de cadastrar:
 *
 * **1. Evento preso em `processing` não voltava.** `drainEventLog` marca a
 * linha `processing` ANTES de chamar o handler, e nada no produto a devolvia.
 * Handler que não retorna — processo derrubado, OOM, ida a serviço externo sem
 * timeout — deixava o evento preso para SEMPRE. `job_queue` tem reaper desde
 * sempre; o `event_log` não tinha. Medido: `status=processing`, `attempts=0`,
 * `consumed_by` vazio, e o material nunca preparado.
 *
 * **2. `skipped` descartava o motivo.** Ele conta como sucesso, e deve mesmo —
 * o handler decidiu que não era caso dele. Mas o `detail` era jogado fora por
 * construção, e com ele a única evidência de por que um evento não fez nada:
 * quem investigasse "cadastrei e não aconteceu nada" achava uma linha `done`
 * sem uma palavra de explicação.
 *
 * O dublê do Supabase é mínimo de propósito: o que se mede é o SQL que o dreno
 * pede, não o comportamento do PostgREST.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ env: {} }));

const handlers = vi.fn();
const dispatch = vi.fn();
vi.mock("@/lib/event-log/dispatcher", () => ({
  getRegisteredHandlers: () => handlers(),
  dispatchEvent: (row: unknown) => dispatch(row),
}));

import { drainEventLog } from "@/lib/event-log/drain";

interface Chamada {
  tabela: string;
  op: string;
  payload?: Record<string, unknown>;
  filtros: Array<[string, string, unknown]>;
}

/**
 * Dublê que REGISTRA o que foi pedido. Devolve linhas só para o `select` do
 * dreno; os `update` devolvem o que o código precisa para seguir.
 */
function dublarAdmin(linhas: Array<Record<string, unknown>>) {
  const chamadas: Chamada[] = [];

  function cadeia(tabela: string) {
    const registro: Chamada = { tabela, op: "select", filtros: [] };
    let ehUpdateDeReclamacao = false;
    let ehClaim = false;

    const self: Record<string, unknown> = {
      select: () => {
        // `.select()` depois de `.update()` é o retorno do update, não uma
        // consulta nova: não sobrescreve a operação registrada.
        if (registro.op === "select") chamadas.push(registro);
        return self;
      },
      update: (payload: Record<string, unknown>) => {
        registro.op = "update";
        registro.payload = payload;
        chamadas.push(registro);
        ehUpdateDeReclamacao = payload.status === "pending" && payload.updated_at !== undefined;
        ehClaim = payload.status === "processing";
        return self;
      },
      eq: (c: string, v: unknown) => {
        registro.filtros.push(["eq", c, v]);
        return self;
      },
      lt: (c: string, v: unknown) => {
        registro.filtros.push(["lt", c, v]);
        return self;
      },
      or: (v: unknown) => {
        registro.filtros.push(["or", "", v]);
        return self;
      },
      in: (c: string, v: unknown) => {
        registro.filtros.push(["in", c, v]);
        return self;
      },
      order: () => self,
      limit: () => self,
      then: (resolve: (r: unknown) => void) => {
        if (registro.op === "update") {
          // Reclamação de órfão devolve lista vazia; claim devolve a linha.
          resolve({ data: ehClaim ? [{ id: "e1" }] : ehUpdateDeReclamacao ? [] : [{ id: "e1" }] });
          return;
        }
        resolve({ data: linhas, error: null });
      },
    };
    return self;
  }

  return { admin: { from: (t: string) => cadeia(t) }, chamadas };
}

const LINHA = {
  id: "e1",
  organization_id: "org-1",
  event_type: "knowledge_source.updated",
  entity_kind: "ai_knowledge_source",
  entity_id: "ks-1",
  payload: {},
  metadata: {},
  consumed_by: [],
  attempts: 0,
  created_at: new Date().toISOString(),
};

beforeEach(() => {
  handlers.mockReset();
  dispatch.mockReset();
  handlers.mockReturnValue([{ key: "k", events: ["knowledge_source.updated"] }]);
});

describe("drainEventLog — evento preso volta para a fila", () => {
  it("devolve `processing` velho para `pending` ANTES de selecionar", async () => {
    dispatch.mockResolvedValue([{ consumer_key: "k", status: "ok" }]);
    const { admin, chamadas } = dublarAdmin([]);

    await drainEventLog(admin as never);

    const reclamacao = chamadas.find(
      (c) =>
        c.op === "update" &&
        c.payload?.status === "pending" &&
        c.filtros.some(([tipo, col, val]) => tipo === "eq" && col === "status" && val === "processing"),
    );
    expect(reclamacao, "nada devolve evento preso em processing").toBeDefined();
    // A janela existe: sem ela, a reclamação pegaria o evento que ESTÁ sendo
    // processado agora e dois workers agiriam sobre o mesmo evento.
    expect(
      reclamacao!.filtros.some(([tipo, col]) => tipo === "lt" && col === "updated_at"),
      "reclamou sem janela de tempo — trocaria evento parado por efeito em dobro",
    ).toBe(true);
  });

  it("a reclamação acontece ANTES da seleção, senão o evento devolvido só rodaria no próximo tique", async () => {
    dispatch.mockResolvedValue([{ consumer_key: "k", status: "ok" }]);
    const { admin, chamadas } = dublarAdmin([]);

    await drainEventLog(admin as never);

    const iReclama = chamadas.findIndex((c) => c.op === "update" && c.payload?.status === "pending");
    const iSeleciona = chamadas.findIndex((c) => c.op === "select");
    expect(iReclama).toBeGreaterThanOrEqual(0);
    expect(iSeleciona).toBeGreaterThan(iReclama);
  });
});

describe("drainEventLog — o motivo de um `skipped` sobrevive à linha", () => {
  it("grava o detail do skip em last_error, sem mudar o desfecho", async () => {
    dispatch.mockResolvedValue([
      { consumer_key: "rag-indexer.v1", status: "skipped", detail: "conversas_tem_pipeline_proprio" },
    ]);
    const { admin, chamadas } = dublarAdmin([LINHA]);

    const resumo = await drainEventLog(admin as never);

    expect(resumo.done, "skipped continua contando como concluído").toBe(1);
    const final = chamadas.filter((c) => c.op === "update" && c.payload?.status === "done").pop();
    expect(final, "o evento não foi concluído").toBeDefined();
    expect(String(final!.payload?.last_error)).toContain("conversas_tem_pipeline_proprio");
  });

  it("skip SEM detail não inventa last_error (controle)", async () => {
    // Sem este controle, o caso acima passaria com o dreno escrevendo qualquer
    // coisa em `last_error` — inclusive `undefined` virando texto.
    dispatch.mockResolvedValue([{ consumer_key: "k", status: "skipped" }]);
    const { admin, chamadas } = dublarAdmin([LINHA]);

    await drainEventLog(admin as never);

    const final = chamadas.filter((c) => c.op === "update" && c.payload?.status === "done").pop();
    expect(final!.payload).not.toHaveProperty("last_error");
  });
});
