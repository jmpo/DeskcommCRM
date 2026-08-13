/**
 * Passo "Configurar IA" do onboarding — o que acontece quando a publicação da
 * 1ª versão NÃO pode ser decidida.
 *
 * O defeito: `listSelectableChannels` lança em qualquer erro de banco (decisão
 * correta lá — seletor que devolve lista vazia por falha convida a parear de
 * novo um número que já está no ar), e a action a chamava sem `try`. O throw
 * furava o `CreateAgentResult` e o desfecho era o pior possível para quem acabou
 * de instalar: a linha em `ai_agents` JÁ existia, `patchOnboardingState`, audit
 * e `event_log` NÃO rodavam, a tela não dizia nada — e o segundo clique criava
 * OUTRO agente.
 *
 * Por isso os testes daqui dirigem a action REAL contra um banco de mentira que
 * GUARDA o que foi escrito: sem estado que sobrevive entre as chamadas, o
 * segundo clique não teria como duplicar nada e o teste passaria por vacuidade.
 * `listSelectableChannels` é a de verdade — é o throw dela que está sob teste.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Consulta {
  table: string;
  op: "select" | "insert" | "update";
  payload: Record<string, unknown> | null;
  filtros: Record<string, unknown>;
}
type ErroDb = { code?: string; message: string } | null;
interface Resposta {
  data: unknown;
  error: ErroDb;
}

const ORG = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";

const redirects: string[] = [];
let responder: (c: Consulta) => Resposta;

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    redirects.push(url);
    // O `redirect` do Next interrompe a execução lançando; um dublê que
    // simplesmente retornasse deixaria a action seguir por um caminho que em
    // produção não existe.
    const err = new Error(`NEXT_REDIRECT: ${url}`);
    (err as { digest?: string }).digest = `NEXT_REDIRECT;replace;${url}`;
    throw err;
  },
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth/server", () => ({
  mfaEmDivida: vi.fn(async () => false),
  loadAuthUser: vi.fn(async () => ({ id: USER, email: "dono@qa.local", full_name: "Dono" })),
  resolveActiveOrg: vi.fn(async () => ({ orgId: ORG, name: "QA", role: "admin" })),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => clienteFalso() }));

import { createDefaultAgent, type CreateAgentResult } from "@/app/actions/onboarding/createDefaultAgent";

/**
 * Construtor de consulta no formato do PostgREST: encadeável, thenable, e com
 * `single`/`maybeSingle`. Cada `from()` abre uma consulta nova — reaproveitar um
 * thenable já resolvido reenviaria a requisição (é por isso que o helper de
 * `archived_at` recebe duas closures, e não um builder mutável).
 */
function clienteFalso() {
  const abrir = (table: string) => {
    const c: Consulta = { table, op: "select", payload: null, filtros: {} };
    const resolver = () => Promise.resolve(responder(c));
    const b = {
      select: () => b,
      insert: (payload: Record<string, unknown>) => {
        c.op = "insert";
        c.payload = payload;
        return b;
      },
      update: (payload: Record<string, unknown>) => {
        c.op = "update";
        c.payload = payload;
        return b;
      },
      eq: (coluna: string, valor: unknown) => {
        c.filtros[coluna] = valor;
        return b;
      },
      is: (coluna: string, valor: unknown) => {
        c.filtros[coluna] = valor;
        return b;
      },
      order: () => b,
      limit: () => b,
      single: () => resolver(),
      maybeSingle: () => resolver(),
      then: (ok: (r: Resposta) => unknown, no?: (e: unknown) => unknown) => resolver().then(ok, no),
    };
    return b;
  };
  return { from: abrir } as never;
}

interface Estado {
  agentes: Record<string, unknown>[];
  versoes: Record<string, unknown>[];
  eventos: Record<string, unknown>[];
  onboardingState: Record<string, unknown>;
}

interface Mundo {
  /** O que a consulta de canais responde — é aqui que mora o defeito. */
  canais?: Resposta;
  /** Erro na gravação da versão (o `return` mudo de antes). */
  erroVersao?: ErroDb;
  agentes?: Record<string, unknown>[];
  versoes?: Record<string, unknown>[];
}

const CANAL = {
  id: "canal-1",
  display_name: "Vendas",
  status: "WORKING",
  phone_number: "5511999999999",
  waha_session_name: "org_2222_aaa",
};

function montarBanco(mundo: Mundo = {}): Estado {
  const estado: Estado = {
    agentes: mundo.agentes ?? [],
    versoes: mundo.versoes ?? [],
    eventos: [],
    onboardingState: {},
  };
  const canais = mundo.canais ?? { data: [CANAL], error: null };

  responder = (c) => {
    if (c.table === "channel_sessions") return canais;
    if (c.table === "ai_models") return { data: { model_id: "claude-sonnet-9" }, error: null };

    if (c.table === "ai_agents") {
      if (c.op === "insert") {
        const linha = { id: `agente-${estado.agentes.length + 1}`, published_version_id: null, ...c.payload };
        estado.agentes.push(linha);
        return { data: { id: linha.id, published_version_id: null }, error: null };
      }
      // `is_default` no filtro = a busca pelo agente padrão da org (reaproveitar).
      const alvo =
        c.filtros.is_default === true
          ? estado.agentes.find((a) => a.is_default === true && a.organization_id === c.filtros.organization_id)
          : estado.agentes.find((a) => a.id === c.filtros.id);
      if (!alvo) return { data: null, error: null };
      if (c.op === "update") Object.assign(alvo, c.payload);
      return { data: { id: alvo.id, published_version_id: alvo.published_version_id ?? null }, error: null };
    }

    if (c.table === "ai_agent_versions") {
      if (c.op === "insert") {
        if (mundo.erroVersao) return { data: null, error: mundo.erroVersao };
        const colide = estado.versoes.some(
          (v) => v.agent_id === c.payload?.agent_id && v.version_number === c.payload?.version_number,
        );
        // `ai_agent_versions_unique_number UNIQUE (agent_id, version_number)`.
        if (colide) {
          return {
            data: null,
            error: {
              code: "23505",
              message: 'duplicate key value violates unique constraint "ai_agent_versions_unique_number"',
            },
          };
        }
        const linha = { id: `versao-${estado.versoes.length + 1}`, ...c.payload };
        estado.versoes.push(linha);
        return { data: { id: linha.id }, error: null };
      }
      const achada = estado.versoes.find(
        (v) => v.agent_id === c.filtros.agent_id && v.version_number === c.filtros.version_number,
      );
      return { data: achada ? { id: achada.id } : null, error: null };
    }

    if (c.table === "organizations") {
      if (c.op === "update") {
        estado.onboardingState = (c.payload?.onboarding_state as Record<string, unknown>) ?? {};
        return { data: null, error: null };
      }
      return { data: { onboarding_state: estado.onboardingState, onboarded_at: null }, error: null };
    }

    if (c.table === "event_log") {
      estado.eventos.push(c.payload ?? {});
      return { data: null, error: null };
    }

    throw new Error(`tabela não dublada no teste: ${c.table}`);
  };

  return estado;
}

function formulario(nome = "Atendente IA"): FormData {
  const fd = new FormData();
  fd.set("name", nome);
  fd.set("prompt_template", "ecommerce_friendly");
  return fd;
}

/** A action redireciona LANÇANDO; quem chama precisa distinguir isso de defeito. */
async function clicar(nome?: string): Promise<CreateAgentResult | "redirecionou"> {
  try {
    return await createDefaultAgent(formulario(nome));
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("NEXT_REDIRECT")) return "redirecionou";
    throw err;
  }
}

const FALHA_AO_LISTAR: Resposta = {
  data: null,
  error: { code: "42501", message: "permission denied for table channel_sessions" },
};

beforeEach(() => {
  redirects.length = 0;
});

describe("onboarding: publicação impossível não pode terminar em silêncio", () => {
  it("erro ao listar canais vira motivo na resposta — não estoura por cima do contrato", async () => {
    const estado = montarBanco({ canais: FALHA_AO_LISTAR });

    const res = await clicar();

    expect(res).not.toBe("redirecionou");
    const r = res as CreateAgentResult;
    expect(r.ok).toBe(true);
    expect(r.ok && r.publish_error).toMatch(/permission denied for table channel_sessions/);
    // Nada publicado: publicar sem saber o canal seria chute.
    expect(estado.versoes).toHaveLength(0);
    expect(estado.agentes[0]?.published_version_id ?? null).toBeNull();
    // ...e o wizard NÃO avança calado: a tela é a única pista que a pessoa tem.
    expect(redirects).toEqual([]);
  });

  it("o passo fica gravado mesmo sem publicar — estado, evento e agente existem", async () => {
    const estado = montarBanco({ canais: FALHA_AO_LISTAR });

    await clicar();

    const ai = (estado.onboardingState.ai ?? {}) as { agent_id?: string };
    expect(ai.agent_id).toBe(estado.agentes[0]?.id);
    expect(estado.eventos).toHaveLength(1);
    expect(estado.eventos[0]?.payload).toMatchObject({ source: "onboarding", published: false });
  });

  it("segundo clique NÃO cria um segundo agente — o dano real da falha", async () => {
    const estado = montarBanco({ canais: FALHA_AO_LISTAR });

    const primeiro = (await clicar("Atendente IA")) as CreateAgentResult;
    const segundo = (await clicar("Atendente IA")) as CreateAgentResult;

    expect(estado.agentes).toHaveLength(1);
    expect(primeiro.ok && primeiro.agent_id).toBe(segundo.ok && segundo.agent_id);
    // E o único agente continua sendo o padrão da org (o índice único permite um).
    expect(estado.agentes.filter((a) => a.is_default === true)).toHaveLength(1);
  });

  it("repetir com o nome trocado edita o mesmo agente, em vez de multiplicar", async () => {
    const estado = montarBanco({ canais: FALHA_AO_LISTAR });

    await clicar("Atendente IA");
    await clicar("Sofia do Suporte");

    expect(estado.agentes).toHaveLength(1);
    expect(estado.agentes[0]?.name).toBe("Sofia do Suporte");
  });

  it("com canal disponível: publica e segue o wizard (o caminho que não pode ter quebrado)", async () => {
    const estado = montarBanco();

    const res = await clicar();

    expect(res).toBe("redirecionou");
    expect(redirects).toEqual(["/onboarding/invite-team"]);
    expect(estado.versoes).toHaveLength(1);
    expect(estado.versoes[0]).toMatchObject({ channel_session_id: "canal-1", status: "published" });
    expect(estado.agentes[0]?.published_version_id).toBe("versao-1");
  });

  it("sem canal nenhum é rascunho CONHECIDO: segue o wizard e não alarma", async () => {
    const estado = montarBanco({ canais: { data: [], error: null } });

    const res = await clicar();

    // Quem pulou o WhatsApp não tem número — tratar isso como erro seria mentir
    // sobre um caminho normal. É o `failed` do teste anterior que é diferente.
    expect(res).toBe("redirecionou");
    expect(estado.versoes).toHaveLength(0);
    expect(estado.eventos[0]?.payload).toMatchObject({ published: false });
  });

  it("versão já gravada por uma passagem anterior: repontar, não bater em duplicate key", async () => {
    const estado = montarBanco({
      agentes: [{ id: "agente-1", organization_id: ORG, is_default: true, published_version_id: null }],
      versoes: [{ id: "versao-1", agent_id: "agente-1", version_number: 1 }],
    });

    const res = await clicar();

    expect(res).toBe("redirecionou");
    expect(estado.versoes).toHaveLength(1);
    expect(estado.agentes[0]?.published_version_id).toBe("versao-1");
  });

  it("falha ao gravar a versão também chega à tela (era um return mudo)", async () => {
    montarBanco({ erroVersao: { code: "42501", message: "permission denied for table ai_agent_versions" } });

    const res = (await clicar()) as CreateAgentResult;

    expect(res.ok && res.publish_error).toMatch(/permission denied for table ai_agent_versions/);
    expect(redirects).toEqual([]);
  });
});
