import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * UMA ESCRITA DO AGENTE SÓ MIRA UM NEGÓCIO DO CONTATO DA CONVERSA.
 *
 * Medido em produção (2026-09-15): o assistente ouviu "sim, já tenho os
 * textos" e chamou `crm_update_lead` com um `lead_id` que não existe em lugar
 * nenhum. O escopo recusou e a resposta do cliente se perdeu.
 *
 * O caso que faz dano calado é o outro: o id REAL de outro cliente, no mesmo
 * funil. O escopo aprova (o funil é do agente) e o dado vai para a ficha
 * errada. É o caso "de outro cliente" abaixo — sem ele, um conserto que só
 * tratasse o id inexistente passaria verde.
 *
 * A asserção é sobre a CADEIA: monta a ferramenta como o turno monta
 * (`pickToolsFromMcp`) e lê o que chegou ao handler — ou a recusa que voltou.
 */

vi.mock("@/app/api/v1/leads/_handler", async (original) => ({
  ...(await original<typeof import("@/app/api/v1/leads/_handler")>()),
  updateLeadHandler: vi.fn(),
  getLeadHandler: vi.fn(),
}));
vi.mock("@/lib/mcp/audit", () => ({ auditMcpToolCall: vi.fn().mockResolvedValue(undefined) }));

const { updateLeadHandler, getLeadHandler } = await import("@/app/api/v1/leads/_handler");
const { auditMcpToolCall } = await import("@/lib/mcp/audit");
const { pickToolsFromMcp } = await import("@/lib/ai/runtime/tools");

const ORG = "11111111-1111-4111-8111-111111111111";
const CONTATO = "22222222-2222-4222-8222-222222222222";
const DA_CONVERSA = "33333333-3333-4333-8333-333333333333";
const OUTRO_DA_CONVERSA = "55555555-5555-4555-8555-555555555555";
const INVENTADO = "74a0238a-667e-4ee8-8106-86d1cb337fd4";
const DE_OUTRO_CLIENTE = "66666666-6666-4666-8666-666666666666";
const FUNIL = "44444444-4444-4444-8444-444444444444";

type Negocio = { id: string; status: string };

/**
 * `crm_leads` responde por CONTATO (a conferência) e por ID (o escopo). O
 * negócio de outro cliente existe no banco e está no funil do agente — é isso
 * que faz o escopo aprová-lo quando ninguém confere de quem ele é.
 */
function banco(doContato: Negocio[], opts: { erro?: boolean } = {}) {
  const existentes = [...doContato.map((n) => n.id), DE_OUTRO_CLIENTE];
  return {
    from() {
      const filtros: Record<string, unknown> = {};
      const q = {
        select: () => q,
        eq: (coluna: string, valor: unknown) => {
          filtros[coluna] = valor;
          return q;
        },
        maybeSingle: async () => ({
          data: existentes.includes(filtros.id as string) ? { pipeline_id: FUNIL } : null,
          error: null,
        }),
        then: (ok: (r: unknown) => unknown) =>
          // Responde só à consulta filtrada por ESTE contato E esta organização:
          // sem os dois filtros, a conferência leria os negócios de outro cliente.
          ok(
            opts.erro
              ? { data: null, error: { message: "timeout" } }
              : { data: filtros.contact_id === CONTATO && filtros.organization_id === ORG ? doContato : [], error: null },
          ),
      };
      return q;
    },
  };
}

// `null` e não `undefined` para dizer "sem conversa": `undefined` ATIVA o valor
// padrão do parâmetro, e o caso do Operador mediria o contrário do que diz.
async function escrever(supabase: unknown, leadId: string, contato: string | null = CONTATO) {
  const contatoDoTurno = contato ?? undefined;
  const ator = { type: "ai_agent", id: "ag-1", role: "ai_operator" };
  const tools = pickToolsFromMcp({
    toolIds: ["crm_update_lead"],
    auth: { organizationId: ORG, role: "ai_operator", scopes: ["mcp:read", "mcp:write"], actor: ator, apiTokenId: "tok-1" },
    ctx: { organizationId: ORG, role: "ai_operator", actor: ator, apiTokenId: "tok-1", requestId: "req-1", supabase },
    supabase,
    pipelineIds: [FUNIL],
    handoffToolEnabled: false,
    handoffSignal: { triggered: false },
    ...(contatoDoTurno ? { contatoDoTurno } : {}),
  } as never);
  return tools.crm_update_lead!.execute!(
    { lead_id: leadId, value_cents: 12_500_000 },
    { toolCallId: "c1", messages: [] } as never,
  );
}

const chegou = () => vi.mocked(updateLeadHandler).mock.calls.at(-1)?.[2];
const motivoAuditado = () => vi.mocked(auditMcpToolCall).mock.calls.at(-1)?.[0]?.errorMessage;

beforeEach(() => {
  vi.mocked(updateLeadHandler).mockReset().mockResolvedValue({ id: DA_CONVERSA } as never);
  vi.mocked(auditMcpToolCall).mockClear();
});

describe("a escrita do agente mira o negócio do contato da conversa", () => {
  it("o caso medido: id INVENTADO vira o negócio aberto da conversa", async () => {
    await escrever(banco([{ id: DA_CONVERSA, status: "open" }]), INVENTADO);
    expect(chegou()).toBe(DA_CONVERSA);
  });

  it("id real de OUTRO cliente não chega ao handler: vira o negócio da conversa", async () => {
    await escrever(banco([{ id: DA_CONVERSA, status: "open" }]), DE_OUTRO_CLIENTE);
    expect(chegou()).toBe(DA_CONVERSA);
  });

  it("negócio fechado DESTE contato passa como veio", async () => {
    await escrever(banco([{ id: DA_CONVERSA, status: "won" }]), DA_CONVERSA);
    expect(chegou()).toBe(DA_CONVERSA);
  });

  it("com dois negócios abertos e um id de fora deles, recusa — não escolhe por palpite", async () => {
    const r = await escrever(
      banco([{ id: DA_CONVERSA, status: "open" }, { id: OUTRO_DA_CONVERSA, status: "open" }]),
      DE_OUTRO_CLIENTE,
    );
    expect(updateLeadHandler).not.toHaveBeenCalled();
    expect(r).toMatchObject({ permitido: false, motivo: "negocio_ambiguo" });
    expect(motivoAuditado()).toBe("negocio_da_conversa:negocio_ambiguo");
  });

  it("com dois abertos, um id que é de um deles segue como veio", async () => {
    await escrever(
      banco([{ id: DA_CONVERSA, status: "open" }, { id: OUTRO_DA_CONVERSA, status: "open" }]),
      OUTRO_DA_CONVERSA,
    );
    expect(chegou()).toBe(OUTRO_DA_CONVERSA);
  });

  it("contato sem negócio aberto: recusa, sem gravar em lugar nenhum", async () => {
    const r = await escrever(banco([]), DE_OUTRO_CLIENTE);
    expect(updateLeadHandler).not.toHaveBeenCalled();
    expect(r).toMatchObject({ permitido: false, motivo: "sem_negocio" });
  });

  it("falha de leitura recusa como indisponível, nunca como veredito", async () => {
    const r = await escrever(banco([{ id: DA_CONVERSA, status: "open" }], { erro: true }), DE_OUTRO_CLIENTE);
    expect(updateLeadHandler).not.toHaveBeenCalled();
    expect(r).toMatchObject({ permitido: false, motivo: "indisponivel" });
  });

  it("LEITURA com id de outro cliente segue como veio: a conferência é só de escrita", async () => {
    vi.mocked(getLeadHandler).mockReset().mockRejectedValue(new Error("not_found"));
    const ator = { type: "ai_agent", id: "ag-1", role: "ai_operator" };
    const supabase = banco([{ id: DA_CONVERSA, status: "open" }]);
    const tools = pickToolsFromMcp({
      toolIds: ["crm_get_lead"],
      auth: { organizationId: ORG, role: "ai_operator", scopes: ["mcp:read", "mcp:write"], actor: ator, apiTokenId: "tok-1" },
      ctx: { organizationId: ORG, role: "ai_operator", actor: ator, apiTokenId: "tok-1", requestId: "req-1", supabase },
      supabase,
      pipelineIds: [FUNIL],
      handoffToolEnabled: false,
      handoffSignal: { triggered: false },
      contatoDoTurno: CONTATO,
    } as never);
    await tools.crm_get_lead!.execute!({ lead_id: DE_OUTRO_CLIENTE }, { toolCallId: "c1", messages: [] } as never);
    expect(vi.mocked(getLeadHandler).mock.calls.at(-1)?.[2]).toBe(DE_OUTRO_CLIENTE);
  });

  it("sem contato do turno (Operador, rota, automação), o id segue como veio", async () => {
    await escrever(banco([{ id: DA_CONVERSA, status: "open" }]), DE_OUTRO_CLIENTE, null);
    expect(chegou()).toBe(DE_OUTRO_CLIENTE);
  });
});
