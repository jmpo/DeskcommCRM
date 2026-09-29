import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { UpdatePanel } from "./UpdatePanel";
import type { SystemVersion } from "@/hooks/system/useSystemVersion";

/**
 * O botão "Atualizar agora" morava DEPOIS do "O que muda" — com várias versões
 * acumuladas (o changelog "cumprida", medido pelo dono numa instalação
 * atrasada), quem só queria clicar precisava rolar a tela inteira antes de
 * achar o botão. Ele subiu para antes do changelog; os avisos que pesam na
 * decisão (`off_release`, `requires_attention` e o de histórico incompleto)
 * continuam antes DELE.
 */

const dadosVersao = vi.hoisted(() => ({ atual: null as SystemVersion | null }));

vi.mock("@/hooks/system/useSystemVersion", () => ({
  useSystemVersion: () => ({ data: dadosVersao.atual, isError: false }),
}));
vi.mock("@/lib/api/client", () => ({ apiClient: { post: vi.fn(), get: vi.fn() } }));

function renderTela(dados: SystemVersion) {
  dadosVersao.atual = dados;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <UpdatePanel />
    </QueryClientProvider>,
  );
}

const CHANGELOG_LONGO: SystemVersion = {
  current_version: "1.0.0",
  is_owner: true,
  latest_version: "1.5.0",
  update_available: true,
  agent_online: true,
  notes: {
    requires_attention: [],
    complete: true,
    sections: Array.from({ length: 8 }, (_, i) => ({
      version: `1.${5 - i}.0`,
      body: `Corpo bem longo da versão 1.${5 - i}.0. `.repeat(20),
    })),
  },
  run: null,
};

describe("tela de atualização — o botão não fica atrás do changelog", () => {
  it("'Atualizar agora' aparece ANTES de 'O que muda', mesmo com changelog extenso", () => {
    renderTela(CHANGELOG_LONGO);

    const botao = screen.getByRole("button", { name: "Atualizar agora" });
    const changelog = screen.getByText("O que muda");

    expect(
      Boolean(
        botao.compareDocumentPosition(changelog) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
  });

  it("o aviso 'Requer atenção' continua ANTES do botão — ele pesa na decisão de clicar", () => {
    renderTela({
      ...CHANGELOG_LONGO,
      notes: {
        ...CHANGELOG_LONGO.notes!,
        requires_attention: [{ version: "1.4.0", texto: "Rode o comando de migração antes." }],
      },
    });

    const aviso = screen.getByText("Requer atenção", { exact: false });
    const botao = screen.getByRole("button", { name: "Atualizar agora" });

    expect(
      Boolean(aviso.compareDocumentPosition(botao) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
  });

  it("o aviso de histórico incompleto continua ANTES do botão — com ele, o 'Requer atenção' pode estar faltando itens", () => {
    renderTela({
      ...CHANGELOG_LONGO,
      notes: { ...CHANGELOG_LONGO.notes!, complete: false },
    });

    const aviso = screen.getByText("Este histórico começa na versão", { exact: false });
    const botao = screen.getByRole("button", { name: "Atualizar agora" });

    expect(
      Boolean(aviso.compareDocumentPosition(botao) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
  });
});

/**
 * O #1040: a rodada de atualização sabe que houve disputa de banco, e a tela
 * CONTA isso — em português de gente — e diz onde está o detalhe. Até aqui o
 * aviso morria só no `.update.log`, no disco da VPS, e quem apertou o botão
 * via "sucesso" sem saber que a base estava ocupada.
 */
function rodada(overrides: Partial<NonNullable<SystemVersion["run"]>> = {}): SystemVersion {
  return {
    current_version: "1.0.0",
    is_owner: true,
    latest_version: "1.1.0",
    update_available: false,
    agent_online: true,
    just_updated: true,
    notes: null,
    run: {
      id: "55555555-5555-4555-8555-555555555555",
      status: "success",
      last_step: "app",
      from_version: "1.0.0",
      to_version: "1.1.0",
      log_tail: "",
      rodada_do_banco: { disputa: true, retentativas: 1, passada: 2 },
      ...overrides,
    },
  };
}

describe("tela de atualização — a rodada conta a disputa do banco", () => {
  it("terminou com disputa: a tela mostra o resumo em português de gente", () => {
    renderTela(rodada());

    // Não é log cru nem código: é frase. Os números vêm do estado persistido.
    expect(
      screen.getByText(
        /O banco estava em disputa com o sistema no ar: foram duas passadas e uma retentativa/,
      ),
    ).toBeInTheDocument();
  });

  it("e diz ONDE está o detalhe — o .update.log, que até aqui era o único lugar que sabia", () => {
    renderTela(rodada());

    const ponteiro = screen.getByText(/\.update\.log/);
    expect(ponteiro.textContent).toContain("na pasta do projeto no servidor");
  });

  it("o resumo e o ponteiro vêm JUNTOS — apontar o log sem contar o resumo seria jogar o problema pra trás da tela", () => {
    renderTela(rodada());

    const resumo = screen.getByText(/duas passadas/);
    const ponteiro = screen.getByText(/\.update\.log/);
    expect(
      Boolean(resumo.compareDocumentPosition(ponteiro) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
  });

  it("rodada medida SEM disputa: conta que foi de uma vez e não aponta log nenhum", () => {
    // O controle do issue: aviso sem motivo vira ruído, e quem para de ler o
    // ruído para de ler o aviso. Endereço de log é linha só quando há o que ler.
    renderTela(
      rodada({ rodada_do_banco: { disputa: false, retentativas: 0, passada: 1 } }),
    );

    expect(screen.getByText(/atualizou de uma vez, na primeira passada/)).toBeInTheDocument();
    expect(screen.queryByText(/\.update\.log/)).not.toBeInTheDocument();
  });

  it("ninguém mediu a rodada: a tela fica calada — nem resumo, nem ponteiro", () => {
    renderTela(rodada({ rodada_do_banco: null }));

    expect(screen.queryByText(/disputa com o sistema/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\.update\.log/)).not.toBeInTheDocument();
  });

  it("no desfecho em que o servidor voltou atrás também: quem clicou tem o direito de saber", () => {
    renderTela({
      ...rodada({
        status: "failed_rolled_back",
        rodada_do_banco: { disputa: true, retentativas: 2, passada: 3 },
      }),
      just_updated: false,
      update_available: true,
    });

    expect(screen.getByText(/foram 3 passadas e 2 retentativas/)).toBeInTheDocument();
    expect(screen.getByText(/\.update\.log/)).toBeInTheDocument();
  });
});
