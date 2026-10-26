/**
 * QUEM PULA O TELEFONE GANHA O AGENTE EM RASCUNHO — E ELE ENTRA NO AR QUANDO O
 * PRIMEIRO NÚMERO CHEGA.
 *
 * ─── O defeito, medido em produção (QA de 26/10/2026) ──────────────────────
 *
 * `publishFirstVersion` parava em `no_channel` ANTES de criar versão: o agente
 * ficava "Sem versão", o passo "Ver ele atender" dizia que não havia o que
 * ensaiar, "Onde ele organiza" não sugeria nada — e conectar o número depois,
 * em Conexões, não ligava o agente. O cliente escrevia e ninguém respondia.
 *
 * O dublê GUARDA o que foi escrito: a segunda chamada (o número chegou) tem de
 * achar o rascunho da primeira, apontar o canal NELE e publicar — sem criar
 * outra versão.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ canais: vi.fn(), publicar: vi.fn() }));
vi.mock("@/lib/channels/selectable", () => ({ listSelectableChannels: m.canais }));
vi.mock("@/lib/ai/agents/publish", () => ({ publishAgentVersion: m.publicar }));
vi.mock("@/lib/ai/runtime/agent", () => ({ chaveDePlataforma: () => "sk-da-instalacao" }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

import { publishFirstVersion } from "@/lib/ai/agents/first-publication";
import { ativarAgenteDoOnboarding } from "@/lib/ai/agents/ativar-agente-do-onboarding";

const ORG = "org-1";
type Linha = Record<string, unknown> & { id: string };

function banco(
  opcoes: { locale?: string; versoes?: Linha[]; agente?: Partial<Linha> | null } = {},
) {
  const versoes: Linha[] = structuredClone(opcoes.versoes ?? []);
  const agente: Linha | null =
    opcoes.agente === null
      ? null
      : {
          id: "agente-1",
          published_version_id: null,
          system_prompt: "Atiendes...",
          archived_at: null,
          ...opcoes.agente,
        };
  const eventos: Record<string, unknown>[] = [];
  // A função do banco (`fn_publish_ai_agent_version`), nas duas recusas que
  // importam aqui: procedência pedida e diferente da gravada, e versão sem canal.
  m.publicar.mockImplementation(
    async (_admin: unknown, p: { versionId: string; expectedProvenance?: string }) => {
      const v = versoes.find((x) => x.id === p.versionId);
      if (p.expectedProvenance && v?.provisioning_origin !== p.expectedProvenance) {
        return {
          ok: false,
          code: "existing_version_requires_review",
          message: "existing_version_requires_review",
        };
      }
      if (!v?.channel_session_id) {
        return {
          ok: false,
          code: "channel_session_not_found",
          message: "channel_session_not_found",
        };
      }
      return { ok: true };
    },
  );
  const admin = {
    from(tabela: string) {
      const f: Record<string, unknown> = {};
      let inserido: Record<string, unknown> | undefined;
      let patch: Record<string, unknown> | undefined;
      const res = () => {
        if (tabela === "organizations")
          return {
            data: {
              settings: { llm: { provider: "anthropic" } },
              locale: opcoes.locale ?? "pt-BR",
            },
            error: null,
          };
        if (tabela === "ai_models")
          return {
            data: [{ model_id: "claude-x", supports_tools: true, is_default_for_provider: true }],
            error: null,
          };
        if (tabela === "crm_pipelines") return { data: { id: "funil-1" }, error: null };
        if (tabela === "ai_provider_credentials") return { data: null, error: null };
        if (tabela === "event_log") {
          eventos.push(inserido ?? {});
          return { data: null, error: null };
        }
        if (tabela === "ai_agents") return { data: agente ? { ...agente } : null, error: null };
        if (tabela === "ai_agent_versions") {
          if (inserido) {
            if (versoes.some((v) => v.version_number === inserido!.version_number))
              return { data: null, error: { code: "23505", message: "duplicate" } };
            const linha = { ...inserido, id: `versao-${versoes.length + 1}` } as Linha;
            versoes.push(linha);
            return { data: { id: linha.id }, error: null };
          }
          if (patch) {
            const alvo = versoes.find(
              (v) =>
                v.id === f.id &&
                v.status === f.status &&
                v.channel_session_id === null &&
                (f.provisioning_origin === undefined ||
                  v.provisioning_origin === f.provisioning_origin),
            );
            if (alvo) {
              Object.assign(alvo, patch);
              // `trg_agent_provisioning_origin`: UPDATE que muda conteúdo da
              // versão (o canal inclusive) ZERA a procedência. O dublê imita o
              // banco — foi o que o e2e mediu e o dublê antigo escondia.
              alvo.provisioning_origin = null;
            }
            return { data: alvo ? [{ id: alvo.id }] : [], error: null };
          }
          return { data: structuredClone(versoes), error: null };
        }
        throw new Error(`tabela inesperada ${tabela}`);
      };
      const b = {
        select: () => b,
        eq: (c: string, v: unknown) => ((f[c] = v), b),
        is: (c: string, v: unknown) => ((f[c] = v), b),
        not: () => b,
        limit: () => b,
        order: () => b,
        insert: (v: Record<string, unknown>) => ((inserido = v), b),
        update: (v: Record<string, unknown>) => ((patch = v), b),
        single: async () => res(),
        maybeSingle: async () => res(),
        then: <T>(ok: (r: ReturnType<typeof res>) => T) => Promise.resolve(res()).then(ok),
      };
      return b;
    },
  };
  return { admin, versoes, agente, eventos };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.publicar.mockImplementation(async () => ({ ok: true }));
});

describe("publishFirstVersion — sem número", () => {
  it("⭐ cria o RASCUNHO (canal nulo) em vez de parar sem versão", async () => {
    m.canais.mockResolvedValue([]);
    const db = banco();
    const r = await publishFirstVersion(
      db.admin as never,
      ORG,
      { id: "agente-1", published_version_id: null },
      "PROMPT",
      "u-1",
    );
    expect(r).toEqual({ published: false, reason: "no_channel", versionId: "versao-1" });
    expect(db.versoes).toHaveLength(1);
    expect(db.versoes[0]).toMatchObject({
      channel_session_id: null,
      status: "draft",
      provisioning_origin: "onboarding",
    });
    // Nada é publicado sem número.
    expect(m.publicar).not.toHaveBeenCalled();
  });

  it("⭐ empresa em espanhol: o rascunho já nasce com as palavras de passagem em espanhol", async () => {
    m.canais.mockResolvedValue([]);
    const db = banco({ locale: "es" });
    await publishFirstVersion(
      db.admin as never,
      ORG,
      { id: "agente-1", published_version_id: null },
      "PROMPT",
      "u-1",
    );
    expect(db.versoes[0]?.handoff_keywords).toContain("hablar con una persona");
  });

  it("empresa em português: as palavras de passagem ficam no default da coluna (como sempre)", async () => {
    m.canais.mockResolvedValue([]);
    const db = banco({ locale: "pt-BR" });
    await publishFirstVersion(
      db.admin as never,
      ORG,
      { id: "agente-1", published_version_id: null },
      "PROMPT",
      "u-1",
    );
    expect(db.versoes[0]).not.toHaveProperty("handoff_keywords");
  });

  it("⭐ o número chegou: aponta o canal NO MESMO rascunho e publica — sem segunda versão", async () => {
    m.canais.mockResolvedValue([]);
    const db = banco();
    await publishFirstVersion(
      db.admin as never,
      ORG,
      { id: "agente-1", published_version_id: null },
      "PROMPT",
      "u-1",
    );

    m.canais.mockResolvedValue([{ id: "canal-novo", status: "WORKING" }]);
    const r = await publishFirstVersion(
      db.admin as never,
      ORG,
      { id: "agente-1", published_version_id: null },
      "PROMPT",
      "u-1",
    );
    expect(r).toEqual({ published: true });
    expect(db.versoes).toHaveLength(1);
    expect(db.versoes[0]?.channel_session_id).toBe("canal-novo");
    // A procedência foi conferida no UPDATE (e o gatilho a zerou): pedi-la de
    // novo na publicação recusaria a própria versão.
    expect(m.publicar).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ versionId: "versao-1", expectedProvenance: undefined }),
    );
  });

  it("número que ainda não está no ar: NÃO aponta (apontar zeraria a procedência sem publicar)", async () => {
    m.canais.mockResolvedValue([]);
    const db = banco();
    await publishFirstVersion(
      db.admin as never,
      ORG,
      { id: "agente-1", published_version_id: null },
      "PROMPT",
      "u-1",
    );
    m.canais.mockResolvedValue([{ id: "canal-qr", status: "SCAN_QR_CODE" }]);
    const r = await publishFirstVersion(
      db.admin as never,
      ORG,
      { id: "agente-1", published_version_id: null },
      "PROMPT",
      "u-1",
    );
    expect(r).toMatchObject({
      published: false,
      reason: "failed",
      message: "channel_session_offline",
    });
    expect(db.versoes[0]).toMatchObject({
      channel_session_id: null,
      provisioning_origin: "onboarding",
    });
    expect(m.publicar).not.toHaveBeenCalled();
  });

  it("rascunho que alguém editou (procedência zerada): não aponta nem publica", async () => {
    m.canais.mockResolvedValue([{ id: "canal-novo", status: "WORKING" }]);
    const db = banco({
      versoes: [
        {
          id: "versao-1",
          version_number: 1,
          provisioning_origin: null,
          status: "draft",
          channel_session_id: null,
        },
      ],
    });
    const r = await publishFirstVersion(
      db.admin as never,
      ORG,
      { id: "agente-1", published_version_id: null },
      "PROMPT",
      "u-1",
    );
    expect(r.published).toBe(false);
    expect(db.versoes[0]?.channel_session_id).toBeNull();
    expect(m.publicar).not.toHaveBeenCalled();
  });

  it("canal escolhido por alguém no editor NUNCA é trocado", async () => {
    m.canais.mockResolvedValue([{ id: "canal-novo", status: "WORKING" }]);
    const db = banco({
      versoes: [
        {
          id: "versao-1",
          version_number: 1,
          provisioning_origin: "onboarding",
          status: "draft",
          channel_session_id: "canal-escolhido",
        },
      ],
    });
    await publishFirstVersion(
      db.admin as never,
      ORG,
      { id: "agente-1", published_version_id: null },
      "PROMPT",
      "u-1",
    );
    expect(db.versoes[0]?.channel_session_id).toBe("canal-escolhido");
  });
});

describe("ativarAgenteDoOnboarding — o primeiro número põe o agente no ar", () => {
  it("⭐ rascunho do onboarding + número: publica e registra o evento", async () => {
    m.canais.mockResolvedValue([{ id: "canal-1", status: "WORKING" }]);
    const db = banco({
      versoes: [
        {
          id: "versao-1",
          version_number: 1,
          provisioning_origin: "onboarding",
          status: "draft",
          channel_session_id: null,
        },
      ],
    });
    const r = await ativarAgenteDoOnboarding(db.admin as never, ORG, "u-1", {
      origem: "conexao_um_clique",
    });
    expect(r).toEqual({ estado: "publicado", agentId: "agente-1" });
    expect(db.versoes[0]?.channel_session_id).toBe("canal-1");
    expect(db.eventos[0]).toMatchObject({
      event_type: "ai_agent.published",
      entity_kind: "ai_agent",
    });
  });

  it("agente já no ar: não toca em nada", async () => {
    m.canais.mockResolvedValue([{ id: "canal-1", status: "WORKING" }]);
    const db = banco({ agente: { published_version_id: "versao-velha" } });
    expect(await ativarAgenteDoOnboarding(db.admin as never, ORG, "u-1")).toEqual({
      estado: "ja_no_ar",
    });
    expect(m.publicar).not.toHaveBeenCalled();
  });

  it("sem agente (o passo de treinar foi pulado): nada a fazer", async () => {
    m.canais.mockResolvedValue([{ id: "canal-1", status: "WORKING" }]);
    const db = banco({ agente: null });
    expect(await ativarAgenteDoOnboarding(db.admin as never, ORG, "u-1")).toEqual({
      estado: "sem_agente",
    });
  });

  it("versão feita no EDITOR (duas versões): não publica por cima — pede revisão", async () => {
    m.canais.mockResolvedValue([{ id: "canal-1", status: "WORKING" }]);
    const db = banco({
      versoes: [
        {
          id: "versao-1",
          version_number: 1,
          provisioning_origin: "onboarding",
          status: "draft",
          channel_session_id: null,
        },
        {
          id: "versao-2",
          version_number: 2,
          provisioning_origin: null,
          status: "draft",
          channel_session_id: null,
        },
      ],
    });
    const r = await ativarAgenteDoOnboarding(db.admin as never, ORG, "u-1");
    expect(r.estado).toBe("precisa_revisao");
    expect(m.publicar).not.toHaveBeenCalled();
  });

  it("nunca lança: a conexão que já deu certo não pode falhar por causa do agente", async () => {
    m.canais.mockRejectedValue(new Error("banco fora"));
    const db = banco();
    await expect(ativarAgenteDoOnboarding(db.admin as never, ORG, "u-1")).resolves.toMatchObject({
      estado: "precisa_revisao",
    });
  });
});
