/**
 * Cadastro de fonte de conhecimento pela tela (issue #265).
 *
 * Dois defeitos moravam aqui, e o segundo escondia o primeiro:
 *
 *  1. O diálogo mandava `tipo === "policy" ? "policy" : "faq"`. Quem clicava em
 *     "Configurar Catálogo" criava uma fonte `faq`; com uma FAQ já ativa, o
 *     índice `ai_knowledge_sources_unique_per_agent` (agent_id, source_type)
 *     WHERE is_active recusava o INSERT e a tela devolvia um 500 genérico.
 *  2. O diálogo nunca deveria ter sido oferecido a "Catálogo" e "Conversas
 *     opt-in": a rota só ingere texto colado de `faq` e `policy` — os outros
 *     dois são preenchidos por pipeline. Era controle decorativo, e mentir o
 *     tipo no envio foi o remendo que produziu (1).
 *
 * O que este arquivo vigia é COMPORTAMENTO de tela: o tipo que a pessoa
 * escolheu é o tipo que chega na API, e o cartão só oferece cadastro onde há
 * cadastro. Um teste sobre a constante `TYPE_META` passaria com o diálogo
 * remontado por engano no cartão errado.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const toastErro = vi.fn();
const toastOk = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (m: string) => toastOk(m), error: (m: string) => toastErro(m) },
}));

import { NovaFonteDialog } from "@/components/ai/NovaFonteDialog";
import { KnowledgeSourceCard } from "@/components/ai/KnowledgeSourceCard";

const AGENT_ID = "11111111-1111-4111-8111-111111111111";

const CONTEUDO = [
  "## Pergunta: Qual o prazo de entrega?",
  "## Resposta: De 2 a 3 dias úteis.",
].join("\n");

/** Substitui o `fetch` global e devolve o spy, para ler o corpo enviado. */
function dublarFetch() {
  const spy = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ data: { id: "ks-1", items_count: 1 } }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

/** Corpo JSON da primeira chamada ao fetch. */
function corpoEnviado(spy: ReturnType<typeof dublarFetch>): Record<string, unknown> {
  const init = spy.mock.calls[0]?.[1];
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

beforeEach(() => {
  toastErro.mockReset();
  toastOk.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("NovaFonteDialog — o tipo escolhido é o tipo enviado", () => {
  for (const tipo of ["faq", "policy"] as const) {
    it(`tipo "${tipo}" chega na API como "${tipo}"`, async () => {
      const spy = dublarFetch();
      render(
        <NovaFonteDialog
          agentId={AGENT_ID}
          tipo={tipo}
          rotulo="Fonte"
          aberto
          onFechar={() => {}}
          onCriada={() => {}}
        />,
      );

      fireEvent.change(screen.getByLabelText("Conteúdo"), { target: { value: CONTEUDO } });
      fireEvent.click(screen.getByRole("button", { name: "Criar fonte" }));

      await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
      expect(spy.mock.calls[0]?.[0]).toBe("/api/v1/ai/knowledge/sources");
      expect(corpoEnviado(spy)).toMatchObject({ source_type: tipo, agent_id: AGENT_ID });
    });
  }

  it("erro da API vira a mensagem do servidor, não um texto fixo", async () => {
    const spy = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            error: {
              code: "knowledge_source_type_in_use",
              message: "Já existe uma fonte de FAQ ativa para este agente.",
            },
          }),
          { status: 409, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", spy);

    render(
      <NovaFonteDialog
        agentId={AGENT_ID}
        tipo="faq"
        rotulo="FAQ"
        aberto
        onFechar={() => {}}
        onCriada={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("Conteúdo"), { target: { value: CONTEUDO } });
    fireEvent.click(screen.getByRole("button", { name: "Criar fonte" }));

    await waitFor(() => expect(toastErro).toHaveBeenCalledTimes(1));
    expect(toastErro.mock.calls[0]?.[0]).toContain("Já existe uma fonte de FAQ ativa");
    expect(toastOk).not.toHaveBeenCalled();
  });
});

describe("KnowledgeSourceCard — só oferece cadastro onde existe cadastro", () => {
  for (const tipo of ["faq", "policy"] as const) {
    it(`"${tipo}" vazio oferece o botão, e o botão abre o formulário`, () => {
      render(<KnowledgeSourceCard type={tipo} source={null} agentId={AGENT_ID} />);

      const botao = screen.getByRole("button", { name: /^Configurar / });
      fireEvent.click(botao);
      expect(screen.getByLabelText("Conteúdo")).toBeInTheDocument();
    });
  }

  for (const tipo of ["conversations", "catalog"] as const) {
    it(`"${tipo}" não oferece cadastro à mão e explica como se preenche`, () => {
      render(<KnowledgeSourceCard type={tipo} source={null} agentId={AGENT_ID} />);

      expect(screen.queryByRole("button", { name: /^Configurar / })).toBeNull();
      // Tirar o botão sem dizer nada deixaria um cartão vazio sem saída: a
      // explicação é o que sobra no lugar do controle que não existia.
      expect(screen.queryByText("Nenhuma fonte configurada.")).toBeNull();
      const explicacao =
        tipo === "catalog" ? /sincronização com o e-commerce/i : /anonimizadas e indexadas/i;
      expect(screen.getByText(explicacao)).toBeInTheDocument();
    });
  }

  it("sem agentId nenhum botão é oferecido — ele não teria formulário para abrir", () => {
    render(<KnowledgeSourceCard type="faq" source={null} />);
    expect(screen.queryByRole("button", { name: /^Configurar / })).toBeNull();
  });
});
