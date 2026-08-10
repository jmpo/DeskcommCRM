/**
 * O PAINEL ALCANÇA A PILHA ANTIGA — o furo do "botão que não controla nada".
 *
 * Três pontos do registro (`sentiment_classify`, `bot_respond` e o ensaio de
 * agente) resolviam modelo por `lib/ai/gateway.ts`, que não conhecia
 * `ai_purpose_bindings`. A tela os OFERECIA, aceitava a escolha e dizia
 * "salvo" — e nenhuma chamada a respeitava.
 *
 * É pior que a ausência: um ponto que a tela não mostrasse deixaria o operador
 * procurando; um que ela mostra e ignora faz ele concluir que configurou, e
 * seguir depurando o lugar errado. E era invisível para
 * `pontos-de-ia-completude.test.ts`, porque aquele teste casa a LISTA com o
 * código, não a EXECUÇÃO com a configuração.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const bindings = vi.hoisted(() => ({ linha: null as Record<string, unknown> | null }));
const credenciais = vi.hoisted(() => ({ linha: null as Record<string, unknown> | null }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => {
      const alvo = tabela === "ai_purpose_bindings" ? bindings : credenciais;
      const chain = {
        select: () => chain,
        eq: () => chain,
        not: () => chain,
        maybeSingle: async () => ({ data: alvo.linha }),
      };
      return chain;
    },
  }),
}));

vi.mock("@/lib/crypto/aes_gcm", () => ({
  decryptKey: () => "chave-decifrada-da-organizacao",
  byteaToBuffer: (v: unknown) => v,
}));

vi.mock("@/lib/ai/gateway", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    // O padrão devolve um objeto reconhecível, para os testes distinguirem
    // "caiu no padrão" de "usou o binding" sem depender do SDK.
    resolveLanguageModel: (m: string) => ({ __padrao: true, modelId: m }),
  };
});

const { resolverModeloDoPonto } = await import("@/lib/ai/gateway-binding");

const ORG = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  bindings.linha = null;
  credenciais.linha = null;
});

describe("sem binding, nada muda", () => {
  it("cai no padrão e diz que caiu", async () => {
    // A recíproca de tudo abaixo: sem ela, um resolvedor que sempre ignorasse o
    // binding passaria em metade deste arquivo.
    const r = await resolverModeloDoPonto("sentiment_classify", ORG, "anthropic/claude-haiku-4-5");
    expect(r?.origem).toBe("padrao");
    expect(r?.modelId).toBe("anthropic/claude-haiku-4-5");
  });
});

describe("com binding, o painel manda", () => {
  it("usa o modelo e o provedor escolhidos na tela", async () => {
    bindings.linha = {
      provider: "openrouter",
      credential_id: "cred-1",
      model_id: "meta-llama/llama-3.3-70b-instruct",
      base_url: null,
    };
    credenciais.linha = { api_key_encrypted: "x", api_key_iv: "y", api_key_tag: "z" };

    const r = await resolverModeloDoPonto("sentiment_classify", ORG, "anthropic/claude-haiku-4-5");
    expect(r?.origem).toBe("binding");
    expect(r?.modelId).toBe("meta-llama/llama-3.3-70b-instruct");
    // E NÃO é o objeto do padrão — se fosse, o teste acima passaria igual e
    // este aqui estaria medindo só o rótulo.
    expect((r?.model as { __padrao?: boolean }).__padrao).toBeUndefined();
  });

  it("o modelo do binding é o que vai para o log de custo", async () => {
    // `modelId` alimenta a linha de ai_invocations. Reportar a constante padrão
    // faria a conta do mês atribuir o gasto ao modelo errado.
    bindings.linha = {
      provider: "openai",
      credential_id: "cred-1",
      model_id: "gpt-5-mini",
      base_url: null,
    };
    credenciais.linha = { api_key_encrypted: "x", api_key_iv: "y", api_key_tag: "z" };
    const r = await resolverModeloDoPonto("bot_respond", ORG, "anthropic/claude-sonnet-5");
    expect(r?.modelId).toBe("gpt-5-mini");
  });
});

describe("o binding quebrado NÃO derruba o atendimento", () => {
  it("binding sem credencial utilizável cai no padrão", async () => {
    // Credencial revogada depois de configurada. Derrubar aqui deixaria o
    // cliente sem resposta por causa de uma tela.
    bindings.linha = {
      provider: "openai",
      credential_id: "cred-que-sumiu",
      model_id: "gpt-5-mini",
      base_url: null,
    };
    credenciais.linha = null;
    const r = await resolverModeloDoPonto("sentiment_classify", ORG, "anthropic/claude-haiku-4-5");
    expect(r?.origem).toBe("padrao");
  });

  it("provider desconhecido cai no padrão, não em outro provedor", async () => {
    // Fallback silencioso para um provedor VIZINHO mandaria a chave de um para
    // o endpoint de outro — a forma exata do defeito do PR #151.
    bindings.linha = {
      provider: "provedor-que-nao-existe",
      credential_id: "cred-1",
      model_id: "x/y",
      base_url: null,
    };
    credenciais.linha = { api_key_encrypted: "x", api_key_iv: "y", api_key_tag: "z" };
    const r = await resolverModeloDoPonto("sentiment_classify", ORG, "anthropic/claude-haiku-4-5");
    expect(r?.origem).toBe("padrao");
    expect(r?.modelId).toBe("anthropic/claude-haiku-4-5");
  });

  it("binding sem credencial NENHUMA (null) usa a chave da instalação", async () => {
    // `credential_id` nulo é escolha legítima na tela: "usar a chave que veio
    // na instalação". Não pode ser tratado como binding quebrado.
    bindings.linha = {
      provider: "anthropic",
      credential_id: null,
      model_id: "claude-haiku-4-5",
      base_url: null,
    };
    const r = await resolverModeloDoPonto("sentiment_classify", ORG, "anthropic/claude-haiku-4-5");
    expect(r?.origem).toBe("padrao");
  });
});

describe("cada ponto lê o SEU binding", () => {
  it("a consulta é escopada por organização e por ponto", async () => {
    // Sem os dois filtros, o binding de um ponto vazaria para todos os outros —
    // e, pior, o de uma organização para outra.
    const chamadas: string[] = [];
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: (t: string) => {
          chamadas.push(t);
          const chain = {
            select: () => chain,
            eq: (col: string, val: unknown) => {
              chamadas.push(`${col}=${String(val)}`);
              return chain;
            },
            not: () => chain,
            maybeSingle: async () => ({ data: null }),
          };
          return chain;
        },
      }),
    }));
    vi.resetModules();
    const mod = await import("@/lib/ai/gateway-binding");
    await mod.resolverModeloDoPonto("jailbreak_detect", ORG, "anthropic/claude-haiku-4-5");
    expect(chamadas).toContain("ai_purpose_bindings");
    expect(chamadas).toContain(`organization_id=${ORG}`);
    expect(chamadas).toContain("purpose=jailbreak_detect");
  });
});
