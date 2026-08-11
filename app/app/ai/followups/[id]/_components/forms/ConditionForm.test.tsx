/**
 * O formulário de condição remontava a config com `{ combinator, checks }` e mais
 * nada, então qualquer campo fora dessas duas chaves era descartado na primeira
 * edição do nó. Com o modo de ramificação vivendo justamente ali, o efeito
 * visível seria o pior possível: o usuário liga "uma saída por regra", mexe em
 * qualquer outro campo, e as bolinhas somem sozinhas.
 *
 * Estes testes guardam COMPORTAMENTO (o que desce no onChange), não o texto do
 * arquivo — trocar a implementação sem perder a propriedade continua verde.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it } from "vitest";

import { ConditionForm } from "./ConditionForm";
import type { ConfigOf } from "./shared";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

/** `delay: null` — sem isso o Radix Select estoura o teto do vitest sob carga. */
const usuario = () => userEvent.setup({ delay: null });

const POR_REGRA: ConfigOf<"condition"> = {
  combinator: "and",
  branching: "per_check",
  checks: [
    { id: "regra-1", label: "Cliente VIP", field: "tag", op: "contains", value: "vip" },
    { id: "regra-2", field: "steps_taken", op: "gte", value: 3 },
  ],
};

function renderizar(config: ConfigOf<"condition">, ramosLigados: string[] = []) {
  const gravados: ConfigOf<"condition">[] = [];
  render(<ConditionForm config={config} onChange={(c) => gravados.push(c)} ramosLigados={ramosLigados} />);
  return gravados;
}

describe("ConditionForm — o modo sobrevive a uma edição qualquer", () => {
  it("editar o valor de uma regra NÃO apaga o modo uma-saída-por-regra", async () => {
    const user = usuario();
    const gravados = renderizar(POR_REGRA);

    await user.type(screen.getAllByLabelText("Valor")[0]!, "x");

    expect(gravados.length).toBeGreaterThan(0);
    expect(gravados.at(-1)!.branching).toBe("per_check");
  });

  it("editar mantém os ids das regras — é o que segura a aresta no lugar", async () => {
    const user = usuario();
    const gravados = renderizar(POR_REGRA);

    await user.type(screen.getByLabelText("Nome da saída 1"), "!");

    expect(gravados.at(-1)!.checks.map((c) => c.id)).toEqual(["regra-1", "regra-2"]);
  });

  it("apagar o nome da saída remove o campo em vez de gravar vazio e reprovar", async () => {
    const user = usuario();
    const gravados = renderizar(POR_REGRA);

    await user.clear(screen.getByLabelText("Nome da saída 1"));

    expect(gravados.at(-1)!.checks[0]!.label).toBeUndefined();
    expect(gravados.at(-1)!.checks[0]!.id).toBe("regra-1");
  });

  it("um nó de fluxo antigo não ganha a chave nova só por ser editado", async () => {
    const user = usuario();
    const v1: ConfigOf<"condition"> = {
      combinator: "and",
      checks: [{ field: "tag", op: "contains", value: "vip" }],
    };
    const gravados = renderizar(v1);

    await user.type(screen.getByLabelText("Valor"), "x");

    expect(gravados.at(-1)).not.toHaveProperty("branching");
  });
});

describe("ConditionForm — trocar de modo avisa antes", () => {
  it("com ligação que vai ficar órfã, pergunta e diz QUANTAS antes de aplicar", async () => {
    const user = usuario();
    // As duas regras estão ligadas; no modo combinado esses ramos deixam de existir.
    const gravados = renderizar(POR_REGRA, ["regra-1", "regra-2"]);

    await user.click(screen.getByRole("combobox", { name: "Como as regras decidem o caminho" }));
    await user.click(await screen.findByRole("option", { name: /Avaliar as regras juntas/ }));

    const aviso = screen.getByTestId("cond-troca-aviso");
    expect(aviso).toHaveTextContent("2 ligações sem saída");
    // E, principalmente: NADA foi gravado ainda.
    expect(gravados).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Trocar mesmo assim" }));
    expect(gravados.at(-1)).not.toHaveProperty("branching");
  });

  it("cancelar deixa tudo como estava", async () => {
    const user = usuario();
    const gravados = renderizar(POR_REGRA, ["regra-1"]);

    await user.click(screen.getByRole("combobox", { name: "Como as regras decidem o caminho" }));
    await user.click(await screen.findByRole("option", { name: /Avaliar as regras juntas/ }));
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByTestId("cond-troca-aviso")).toBeNull();
    expect(gravados).toEqual([]);
  });

  it("sem nenhuma ligação órfã, troca direto e já dá id estável para cada regra", async () => {
    const user = usuario();
    const v1: ConfigOf<"condition"> = {
      combinator: "and",
      checks: [
        { field: "tag", op: "contains", value: "vip" },
        { field: "steps_taken", op: "gte", value: 3 },
      ],
    };
    const gravados = renderizar(v1, []);

    await user.click(screen.getByRole("combobox", { name: "Como as regras decidem o caminho" }));
    await user.click(await screen.findByRole("option", { name: "Uma saída por regra" }));

    expect(screen.queryByTestId("cond-troca-aviso")).toBeNull();
    const ultimo = gravados.at(-1)!;
    expect(ultimo.branching).toBe("per_check");
    const ids = ultimo.checks.map((c) => c.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
  });
});
