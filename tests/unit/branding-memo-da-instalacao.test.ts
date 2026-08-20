/**
 * O MEMO DA MARCA DA INSTALAÇÃO É DO PROCESSO — NÃO DA INSTÂNCIA DO MÓDULO.
 *
 * ═══ O DEFEITO QUE ESTE ARQUIVO VIGIA ═══
 *
 * `invalidarMarcaDaInstalacao()` é o contrato entre quem GRAVA a marca e quem a
 * RENDERIZA: sem ela, a troca só apareceria quando o TTL de 30s expirasse. O
 * contrato estava quebrado para um dos dois escritores, e de um jeito invisível.
 *
 * MEDIDO no build de produção deste repo (Next 16.3, Turbopack):
 *
 *   .next/server/app/api/v1/marca/logo/route.js
 *     → require("chunks/[turbopack]_runtime.js")      → chunks/lib_0oox3fh._.js     (id 545718)
 *   .next/server/app/admin/(protected)/marca/page.js
 *     → require("chunks/ssr/[turbopack]_runtime.js")  → chunks/ssr/lib_14h72ih._.js (id 301182)
 *
 * Dois arquivos de runtime, cada um com o seu `const moduleCache =
 * Object.create(null)` e nenhum registro global: `lib/branding/instalacao.ts`
 * vive DUAS vezes no mesmo processo. Com o memo num `let` de módulo, a rota de
 * upload zerava uma cópia que nenhuma tela lê — e o sintoma era
 * `tests/e2e/marca-logo.spec.ts` (1) reprovando com "element(s) not found" na
 * prévia do logo, com 5s e depois com 15s de espera, DEPOIS de o toast "Logo
 * atualizado." já ter aparecido.
 *
 * ═══ POR QUE ESTE ARQUIVO USA MOCK, SE O VIZINHO DIZ QUE MOCK NÃO PROVA NADA ═══
 *
 * `branding-instalacao.test.ts` recusa mock de propósito: lá o que se testa é
 * REGRA (semear, recusar, resolver), e mock do transporte prova só que a query
 * foi montada. Aqui o objeto de teste é outro — é o CICLO DE VIDA do memo, que
 * só é observável pela contagem de idas ao banco e pelo que a leitura devolve
 * depois de alguém escrever. Sem uma fronteira de I/O observável, a propriedade
 * não existe para ser medida.
 *
 * ═══ POR QUE `vi.resetModules()` REPRODUZ O DEFEITO DE VERDADE ═══
 *
 * Ele dá exatamente o que o Turbopack dá: uma SEGUNDA instância do mesmo arquivo
 * no MESMO processo, com o estado de módulo zerado e a mesma `globalThis`. Um
 * teste que importasse o módulo uma vez só passaria verde com o defeito de pé —
 * é o caso confundido que acerta por sorte.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O estado do banco falso vive no escopo IÇADO, não no fábrica do mock: o
 * `vi.resetModules()` reexecuta a fábrica a cada importação, e um contador
 * declarado lá dentro zeraria justamente na hora em que estamos medindo.
 */
const banco = vi.hoisted(() => ({
  linha: null as Record<string, unknown> | null,
  leituras: 0,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            banco.leituras += 1;
            return { data: banco.linha, error: null };
          },
        }),
      }),
    }),
  }),
}));

/**
 * `seeded_from_env: false` não é detalhe: é o que faz `precisaSemear` devolver
 * "nao" e mantém este arquivo medindo o MEMO, e não a semeadura do `.env` (que
 * tem cobertura própria em `branding-instalacao.test.ts`).
 */
const SEM_LOGO = {
  app_name: "Revenda XPTO",
  logo_url: null,
  logo_path: null,
  accent_hex: null,
  show_powered_by: true,
  seeded_from_env: false,
  fallback_at: null,
  fallback_reason: null,
};

const CAMINHO_SUBIDO = "platform/6f1c2a90-7d3e-4a11-9b8c-0d2e4f6a8b10.png";
const COM_LOGO = { ...SEM_LOGO, logo_path: CAMINHO_SUBIDO };

/** Uma instância NOVA do módulo — o que o bundler cria para cada runtime. */
async function instancia() {
  vi.resetModules();
  return import("@/lib/branding/instalacao");
}

describe("o memo da marca da instalação atravessa instâncias do módulo", () => {
  beforeEach(async () => {
    banco.linha = SEM_LOGO;
    banco.leituras = 0;
    // Zera pela PORTA DO PRODUTO, não apagando a chave do `globalThis` na mão:
    // um teste que conhece o nome interno do memo continuaria "limpando" nada no
    // dia em que ele fosse renomeado, e a suíte ficaria verde sem isolamento.
    (await instancia()).invalidarMarcaDaInstalacao();
  });

  it("a invalidação feita pela instância da ROTA alcança a instância da TELA", async () => {
    const tela = await instancia();
    const rota = await instancia();
    expect(
      tela,
      "controle: sem duas instâncias distintas este teste não reproduz nada",
    ).not.toBe(rota);

    // 1. A tela renderizou uma vez — o memo guardou a linha SEM logo.
    expect((await tela.marcaDaInstalacao())?.logo_path).toBeNull();

    // 2. A rota gravou o arquivo e invalidou, que é o que ela faz hoje
    //    (`app/api/v1/marca/logo/route.ts`, dentro de `gravarCaminho`).
    banco.linha = COM_LOGO;
    rota.invalidarMarcaDaInstalacao();

    // 3. O render seguinte (o `router.refresh()` do campo de logo) TEM de ver o
    //    arquivo. É esta linha que fica vermelha com o memo preso ao módulo.
    expect((await tela.marcaDaInstalacao())?.logo_path).toBe(CAMINHO_SUBIDO);
  });

  it("e no sentido inverso — quem grava pela tela é visto por quem monta o e-mail", async () => {
    // Não é simetria decorativa: `lib/branding/saida.ts` (remetente e ícone do
    // e-mail) chama `marcaDaInstalacao()` e é compilada no runtime das ROTAS,
    // enquanto `updateBranding.ts` grava no runtime das TELAS. Este é o par
    // oposto do caso acima, e a mesma propriedade o cobre.
    const tela = await instancia();
    const rota = await instancia();

    expect((await rota.marcaDaInstalacao())?.logo_path).toBeNull();
    banco.linha = COM_LOGO;
    tela.invalidarMarcaDaInstalacao();
    expect((await rota.marcaDaInstalacao())?.logo_path).toBe(CAMINHO_SUBIDO);
  });

  it("duas instâncias, UMA ida ao banco — o memo é do processo também na leitura", async () => {
    const tela = await instancia();
    const rota = await instancia();
    await tela.marcaDaInstalacao();
    await rota.marcaDaInstalacao();
    expect(banco.leituras, "cada instância manteve o próprio cache").toBe(1);
  });

  it("CONTROLE: sem invalidação o memo continua servindo a linha velha", async () => {
    // Sem este caso, os três acima passariam verdes com o cache simplesmente
    // REMOVIDO — e aí a tela pagaria uma consulta por render sem ninguém notar.
    const tela = await instancia();
    expect((await tela.marcaDaInstalacao())?.logo_path).toBeNull();
    banco.linha = COM_LOGO;
    expect((await tela.marcaDaInstalacao())?.logo_path).toBeNull();
    expect(banco.leituras, "o memo deixou de ser memo").toBe(1);
  });
});
