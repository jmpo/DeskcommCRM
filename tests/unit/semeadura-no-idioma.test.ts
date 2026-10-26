/**
 * Os nomes que os gatilhos semeiam, no idioma da empresa — nas DUAS direções, e
 * sem nunca derrubar quem chama (`lib/onboarding/semeadura-no-idioma.ts`).
 */
import { describe, expect, it } from "vitest";

import {
  ETAPAS_SEMEADAS,
  TIPOS_DE_AGENDAMENTO_SEMEADOS,
  localizarSemeadura,
} from "@/lib/onboarding/semeadura-no-idioma";

/** O que o gatilho `fn_seed_default_pipeline_for_org` grava, slug por slug (baseline). */
const DO_GATILHO: Record<string, string> = {
  carrinho_abandonado: "Carrinho abandonado",
  aguardando_pagamento: "Aguardando pagamento",
  pago: "Pago",
  em_separacao: "Em separação",
  enviado: "Enviado",
  entregue: "Entregue",
  pos_venda: "Pós-venda",
  cancelado: "Cancelado",
};

function banco(etapas: { slug: string; name: string }[], falha = false) {
  const linhas = etapas.map((e) => ({ ...e }));
  return {
    linhas,
    cliente: {
      from: (tabela: string) => {
        const f: Record<string, unknown> = {};
        let patch: Record<string, unknown> | null = null;
        const b = {
          select: () => b,
          update: (p: Record<string, unknown>) => {
            patch = p;
            return b;
          },
          eq: (c: string, v: unknown) => ((f[c] = v), b),
          in: (c: string, v: unknown) => ((f[`in:${c}`] = v), b),
          maybeSingle: async () =>
            falha
              ? { data: null, error: { message: "rede" } }
              : { data: { id: "funil" }, error: null },
          then: (ok: (r: unknown) => unknown) => {
            if (tabela !== "crm_stages" || !patch)
              return Promise.resolve({ data: [], error: null }).then(ok);
            const alvo = linhas.filter(
              (l) => l.slug === f.slug && (f["in:name"] as string[]).includes(l.name),
            );
            for (const l of alvo) Object.assign(l, patch);
            return Promise.resolve({ data: alvo.map(() => ({ id: "x" })), error: null }).then(ok);
          },
        };
        return b;
      },
    },
  };
}

describe("localizarSemeadura", () => {
  it("a tabela tem exatamente as oito etapas que o gatilho grava, com o mesmo português", () => {
    expect(
      Object.fromEntries(Object.entries(ETAPAS_SEMEADAS).map(([s, n]) => [s, n["pt-BR"]])),
    ).toEqual(DO_GATILHO);
    expect(Object.keys(TIPOS_DE_AGENDAMENTO_SEMEADOS)).toEqual([
      "consulta",
      "reuniao",
      "atendimento",
    ]);
  });

  it("⭐ espanhol: renomeia as semeadas e deixa em paz a que alguém já mudou", async () => {
    const { linhas, cliente } = banco([
      { slug: "pago", name: "Pago" },
      { slug: "entregue", name: "Entrega feita (renomeada pelo dono)" },
    ]);
    await localizarSemeadura(cliente as never, "org", "es");
    expect(linhas).toEqual([
      { slug: "pago", name: "Pagado" },
      { slug: "entregue", name: "Entrega feita (renomeada pelo dono)" },
    ]);
  });

  it("e volta: trocar o wizard de novo para português devolve os nomes de antes", async () => {
    const { linhas, cliente } = banco([{ slug: "pago", name: "Pagado" }]);
    await localizarSemeadura(cliente as never, "org", "pt-BR");
    expect(linhas[0]?.name).toBe("Pago");
  });

  it("falha de leitura não lança: o cadastro nunca morre por causa de um rótulo", async () => {
    const { cliente } = banco([], true);
    await expect(localizarSemeadura(cliente as never, "org", "es")).resolves.toEqual({
      etapas: 0,
      tipos: 0,
    });
  });
});
