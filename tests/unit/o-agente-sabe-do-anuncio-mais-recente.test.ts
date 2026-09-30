/**
 * O agente sabe por qual anúncio o contato VOLTOU — não só por qual veio.
 *
 * ─── O defeito, medido na loja com dois produtos ────────────────────────────
 *
 * Cada produto tem o seu anúncio "Clique para o WhatsApp", e o texto
 * pré-preenchido dos dois é o mesmo, genérico ("¿Cuál es el precio y tienen
 * delivery?"). A atribuição do contato é PRIMEIRO TOQUE — gravada uma vez, nunca
 * reescrita —, então a pessoa que chegou pelo anúncio A e dias depois clicou no
 * anúncio B aparecia ao agente só com o A. O agente oferecia o produto errado a
 * quem acabou de perguntar pelo outro. E o clique novo não deixava rastro em
 * lugar nenhum: a mensagem não guardava de qual anúncio nasceu.
 *
 * ─── O que se prova aqui ─────────────────────────────────────────────────────
 *
 * 1. A INGESTÃO grava o anúncio na própria mensagem (`metadata.anuncio`), nos
 *    três transportes que sabem ler o clique — sem mexer no primeiro toque do
 *    contato.
 * 2. O CONTEXTO do turno mostra `anuncio_mais_recente` quando o último anúncio
 *    é OUTRO que não o de origem, e cala quando é o mesmo ou quando não há.
 * 3. A linha gravada pela ingestão é a mesma que o contexto sabe ler — o teste
 *    do contexto usa o objeto que o escritor produz, não um literal paralelo.
 *
 * O que NÃO se prova aqui: o SQL contra um Postgres real (índice, jsonb_typeof)
 * — o banco aqui é de mentira; isso é do `test:db`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
// Os efeitos pós-entrada (opt-out, lead, despacho do agente) não são o assunto
// e cada um tem teste próprio; aqui só importa o que a MENSAGEM grava.
vi.mock("@/lib/channels/pos-entrada", () => ({ aplicarEfeitosPosEntrada: vi.fn() }));

import { projetarContexto } from "@/lib/agent-engine/agent/projecao";
import { ritualBlocks } from "@/lib/agent-engine/agent/abertura/ritual";
import { getLeadContext } from "@/lib/agent-engine/edge/crm/get-lead-context";
import { extrairAtribuicaoMeta } from "@/lib/channels/atribuicao-de-anuncio-oficial";
import { ingestMetaInbound } from "@/lib/channels/meta/ingest";
import type { InboundMessageEvent } from "@/lib/channels/meta/webhook";
import { ingestZernioInbound } from "@/lib/channels/zernio/ingest";
import { metadataDoAnuncio, type AnuncioDaMensagem } from "@/lib/leads/atribuicao-de-anuncio";
import { dispatchWahaEvent, type WahaEnvelope } from "@/lib/waha/ingest";

// ─── Os dois anúncios da loja ───────────────────────────────────────────────

const ANUNCIO_A = {
  source_id: "120200000000000001",
  source_type: "ad",
  source_url: "https://fb.me/pico",
  headline: "Pico de alta presión",
  body: "Lavá tu auto en minutos. Envío gratis.",
  ctwa_clid: "ARAk_clique_A",
};

const ANUNCIO_B = {
  source_id: "120200000000000002",
  source_type: "ad",
  source_url: "https://fb.me/parasol",
  headline: "Parasol para auto",
  body: "Protegé tu tablero del sol. Envío gratis.",
  ctwa_clid: "ARAk_clique_B",
};

const TEXTO_GENERICO = "¿Cuál es el precio y tienen delivery?";

// ─── 1. A ingestão grava o anúncio na mensagem ─────────────────────────────

/**
 * Admin de mentira TOLERANTE: toda cadeia do PostgREST resolve vazia, as duas
 * RPCs de resolução devolvem id, e o INSERT de `messages` é registrado — é a
 * única escrita que este bloco mede.
 */
function adminTolerante() {
  const insertsDeMensagem: Array<Record<string, unknown>> = [];
  const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];

  const cadeia = (op: string): unknown => {
    const proxy: unknown = new Proxy(function () {}, {
      get(_alvo, prop) {
        if (prop === "then") {
          return (ok: (v: unknown) => unknown) => ok({ data: [], error: null });
        }
        if (prop === "maybeSingle" || prop === "single") {
          return async () => ({ data: op === "insert" ? { id: "mensagem-1" } : null, error: null });
        }
        return () => proxy;
      },
    });
    return proxy;
  };

  const admin = {
    from: (tabela: string) => ({
      select: () => cadeia("select"),
      insert: (linha: Record<string, unknown>) => {
        if (tabela === "messages") insertsDeMensagem.push(linha);
        return cadeia("insert");
      },
      update: () => cadeia("update"),
      upsert: () => cadeia("upsert"),
      delete: () => cadeia("delete"),
    }),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      if (fn === "fn_upsert_wa_contact") return { data: "contato-1", error: null };
      if (fn === "fn_upsert_wa_conversation") return { data: "conversa-1", error: null };
      return { data: null, error: null };
    },
  };
  return { admin, insertsDeMensagem, rpcs };
}

const metadataGravada = (inserts: Array<Record<string, unknown>>) =>
  (inserts[0]?.metadata ?? null) as Record<string, unknown> | null;

const ANUNCIO_B_NA_MENSAGEM = {
  titulo: "Parasol para auto",
  texto: "Protegé tu tablero del sol. Envío gratis.",
  ad_id: "120200000000000002",
};

describe("ingestão — a mensagem nascida de um clique guarda o SEU anúncio", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("canal intermediado (o número oficial da loja)", () => {
    // A forma medida no provider real (24/09/2026): o `referral` mora em
    // `metadata` no nível do EVENTO, não na mensagem.
    const evento = (referral: unknown, extra: Record<string, unknown> = {}) => ({
      id: "evt_1",
      event: "message.received",
      account: { id: "acc_1" },
      ...(referral ? { metadata: { referral } } : {}),
      message: {
        id: "m_1",
        conversationId: "thread-1",
        platform: "whatsapp",
        platformMessageId: "wamid.CLIQUE_B",
        direction: "incoming",
        text: TEXTO_GENERICO,
        attachments: [],
        sender: { phoneNumber: "+595981000000", name: "Carlos" },
        sentAt: "2026-09-29T15:00:00.000Z",
        ...extra,
      },
    });
    const ENTRADA = { organizationId: "org-1", channelSessionId: "sessao-1" };

    it("clique em anúncio: `metadata.anuncio` com título, texto e id — sem o clique nem o cru", async () => {
      const { admin, insertsDeMensagem } = adminTolerante();
      const r = await ingestZernioInbound(admin as never, { ...ENTRADA, payload: evento(ANUNCIO_B) });

      expect(r.status).toBe("ingested");
      const metadata = metadataGravada(insertsDeMensagem);
      expect(metadata?.anuncio).toEqual(ANUNCIO_B_NA_MENSAGEM);
      // Compacto de propósito: o clique identifica uma pessoa, e o cru já mora
      // no contato. Nada disso se repete em cada mensagem.
      expect(JSON.stringify(metadata)).not.toContain("ARAk_clique_B");
      expect(JSON.stringify(metadata)).not.toContain("fb.me");
    });

    it("o primeiro toque do contato continua sendo estampado como antes", async () => {
      const { admin, rpcs } = adminTolerante();
      await ingestZernioInbound(admin as never, { ...ENTRADA, payload: evento(ANUNCIO_B) });

      const estampas = rpcs.filter((c) => c.fn === "fn_estampar_atribuicao_de_anuncio");
      expect(estampas).toHaveLength(1);
      expect(estampas[0]!.args).toMatchObject({ p_contact: "contato-1", p_platform: "meta_ads" });
    });

    it("mensagem sem anúncio: a chave nem aparece", async () => {
      const { admin, insertsDeMensagem } = adminTolerante();
      await ingestZernioInbound(admin as never, { ...ENTRADA, payload: evento(null) });
      expect("anuncio" in (metadataGravada(insertsDeMensagem) ?? {})).toBe(false);
    });

    it("post orgânico compartilhado não é anúncio — não vira `metadata.anuncio`", async () => {
      const { admin, insertsDeMensagem } = adminTolerante();
      await ingestZernioInbound(admin as never, {
        ...ENTRADA,
        payload: evento({ ...ANUNCIO_B, source_type: "post" }),
      });
      expect("anuncio" in (metadataGravada(insertsDeMensagem) ?? {})).toBe(false);
    });

    it("o anúncio convive com o anexo: `provider_attachments` segue gravado", async () => {
      const { admin, insertsDeMensagem } = adminTolerante();
      await ingestZernioInbound(admin as never, {
        ...ENTRADA,
        payload: evento(ANUNCIO_B, {
          attachments: [{ type: "image", url: "https://provider.example/anexo" }],
        }),
      });
      const metadata = metadataGravada(insertsDeMensagem);
      expect(metadata?.provider_attachments).toBeDefined();
      expect(metadata?.anuncio).toEqual(ANUNCIO_B_NA_MENSAGEM);
    });
  });

  describe("canal oficial direto", () => {
    const evento = (referral: unknown): InboundMessageEvent => ({
      kind: "inbound_message",
      wabaId: "waba-1",
      phoneNumberId: "phone-1",
      externalId: "wamid.CLIQUE_B",
      from: "595981000000",
      profileName: "Carlos",
      sentAt: new Date("2026-09-29T15:00:00.000Z"),
      type: "text",
      text: TEXTO_GENERICO,
      media: null,
      referral,
    });

    it("clique em anúncio: `metadata.anuncio` gravado no INSERT", async () => {
      const { admin, insertsDeMensagem } = adminTolerante();
      const r = await ingestMetaInbound(admin as never, evento(ANUNCIO_B), {
        organizationId: "org-1",
        channelSessionId: "sessao-1",
      });
      expect(r.status).toBe("ingested");
      expect(metadataGravada(insertsDeMensagem)?.anuncio).toEqual(ANUNCIO_B_NA_MENSAGEM);
    });

    it("sem anúncio: a chave nem aparece", async () => {
      const { admin, insertsDeMensagem } = adminTolerante();
      await ingestMetaInbound(admin as never, evento(null), {
        organizationId: "org-1",
        channelSessionId: "sessao-1",
      });
      expect("anuncio" in (metadataGravada(insertsDeMensagem) ?? {})).toBe(false);
    });
  });

  describe("canal por QR", () => {
    const envelope = (externalAdReply: Record<string, unknown> | null): WahaEnvelope => ({
      event: "message",
      session: "default",
      payload: {
        id: "false_595981000000@c.us_CLIQUE_B",
        from: "595981000000@c.us",
        fromMe: false,
        body: TEXTO_GENERICO,
        timestamp: 1_790_000_000,
        _data: {
          message: {
            extendedTextMessage: {
              text: TEXTO_GENERICO,
              contextInfo: externalAdReply ? { externalAdReply } : {},
            },
          },
        },
      },
    });
    const SESSION = { id: "sessao-1", organization_id: "org-1" };

    it("clique em anúncio: `metadata.anuncio` gravado junto do tipo cru", async () => {
      const { admin, insertsDeMensagem } = adminTolerante();
      await dispatchWahaEvent(
        admin as never,
        SESSION as never,
        envelope({
          title: "Parasol para auto",
          body: "Protegé tu tablero del sol. Envío gratis.",
          sourceId: "120200000000000002",
          ctwaClid: "ARAk_clique_B",
          sourceType: "ad",
        }),
        "req-1",
      );
      const metadata = metadataGravada(insertsDeMensagem);
      expect(metadata?.anuncio).toEqual(ANUNCIO_B_NA_MENSAGEM);
      expect("raw_type" in (metadata ?? {})).toBe(true);
    });

    it("sem anúncio: a chave nem aparece", async () => {
      const { admin, insertsDeMensagem } = adminTolerante();
      await dispatchWahaEvent(admin as never, SESSION as never, envelope(null), "req-1");
      expect(insertsDeMensagem).toHaveLength(1);
      expect("anuncio" in (metadataGravada(insertsDeMensagem) ?? {})).toBe(false);
    });
  });
});

// ─── 2. O contexto do turno mostra o anúncio mais recente ──────────────────

/** O que a ingestão grava para cada anúncio — o MESMO escritor de produção. */
const naMensagem = (referral: unknown): AnuncioDaMensagem =>
  metadataDoAnuncio(extrairAtribuicaoMeta(referral)).anuncio!;

interface Mundo {
  origem: { ad_title: string | null; ad_body: string | null; ad_id: string | null };
  /** Linhas que a consulta do anúncio mais recente devolve. `"lança"` = a consulta cai. */
  ultimaComAnuncio: Array<{ anuncio: unknown; created_at: Date | string }> | "lança";
}

function bancoDoContexto(mundo: Mundo) {
  const consultas: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    query: async (sql: string, params: unknown[]) => {
      consultas.push({ sql, params });
      if (sql.includes("from contacts")) {
        return {
          rows: [{
            name: "Carlos", display_name: null, email: null, phone_number: "+595981000000", tags: [],
            is_blocked: false, source: "whatsapp", consent: null, is_anonymized: false,
            ...mundo.origem,
          }],
        };
      }
      if (sql.includes("metadata->'anuncio'")) {
        if (mundo.ultimaComAnuncio === "lança") throw new Error("connection terminated");
        return { rows: mundo.ultimaComAnuncio };
      }
      return { rows: [] };
    },
  };
  return { db, consultas };
}

const ORIGEM_A = {
  ad_title: ANUNCIO_A.headline,
  ad_body: ANUNCIO_A.body,
  ad_id: ANUNCIO_A.source_id,
};
const KNOBS = { historyLimit: 20, maxTokens: 1_000 };
// Fuso sem horário de verão, para a hora esperada não depender da base de fusos
// da máquina.
const ENTRADA = { tenantId: "org-1", leadId: "contato-1", fuso: "America/Sao_Paulo" };
const QUANDO = new Date("2026-09-29T15:00:00.000Z");

async function contexto(mundo: Mundo) {
  const { db, consultas } = bancoDoContexto(mundo);
  const r = await getLeadContext(db as never, {} as never, ENTRADA, KNOBS);
  if (!r.ok) throw new Error("contexto falhou");
  return { ctx: r.context, consultas };
}

describe("contexto do turno — `anuncio_mais_recente`", () => {
  it("voltou por OUTRO anúncio: o agente vê o anúncio novo, com a hora, e o de origem continua lá", async () => {
    const { ctx } = await contexto({
      origem: ORIGEM_A,
      ultimaComAnuncio: [{ anuncio: naMensagem(ANUNCIO_B), created_at: QUANDO }],
    });

    expect(ctx.anuncio_mais_recente).toEqual({
      titulo: "Parasol para auto",
      texto: "Protegé tu tablero del sol. Envío gratis.",
      recebido_em: "2026-09-29T12:00:00-03:00",
    });
    // O primeiro toque não muda: o de origem segue sendo o A.
    expect(ctx.anuncio_de_origem?.titulo).toBe("Pico de alta presión");

    // O modo projetado (o que esconde ids) também leva — e sem id de anúncio.
    const projetado = projetarContexto(ctx);
    expect(projetado.anuncio_mais_recente?.titulo).toBe("Parasol para auto");
    expect(JSON.stringify(projetado)).not.toContain(ANUNCIO_B.source_id);
    expect(JSON.stringify(ctx)).not.toContain(ANUNCIO_B.source_id);
  });

  it("o ritual diz ao agente que o anúncio mais recente é o assunto de agora", async () => {
    const { ctx } = await contexto({
      origem: ORIGEM_A,
      ultimaComAnuncio: [{ anuncio: naMensagem(ANUNCIO_B), created_at: QUANDO }],
    });
    const texto = ritualBlocks(null, null, ctx, "—", true).join("\n");
    expect(texto).toContain("OUTRO anúncio: `anuncio_mais_recente`");
    expect(texto).toContain("Parasol para auto");
  });

  it("a consulta é limitada: organização + contato, só entrada, a mais recente", async () => {
    const { consultas } = await contexto({ origem: ORIGEM_A, ultimaComAnuncio: [] });
    const c = consultas.find((q) => q.sql.includes("metadata->'anuncio'"));
    expect(c).toBeDefined();
    expect(c!.params).toEqual(["org-1", "contato-1"]);
    expect(c!.sql).toMatch(/organization_id = \$1 and contact_id = \$2/);
    expect(c!.sql).toMatch(/direction = 'inbound'/);
    expect(c!.sql).toMatch(/order by created_at desc/);
    expect(c!.sql).toMatch(/limit 1/);
  });

  it("o último anúncio É o de origem: a chave nem aparece (mesmo id)", async () => {
    const { ctx } = await contexto({
      origem: ORIGEM_A,
      ultimaComAnuncio: [{ anuncio: naMensagem(ANUNCIO_A), created_at: QUANDO }],
    });
    expect("anuncio_mais_recente" in ctx).toBe(false);
    expect("anuncio_mais_recente" in projetarContexto(ctx)).toBe(false);
    expect(ritualBlocks(null, null, ctx, "—", true).join("\n")).not.toContain("anuncio_mais_recente");
  });

  it("origem sem id (contato antigo): compara por título e texto", async () => {
    const { ctx } = await contexto({
      origem: { ...ORIGEM_A, ad_id: null },
      ultimaComAnuncio: [{ anuncio: naMensagem(ANUNCIO_A), created_at: QUANDO }],
    });
    expect("anuncio_mais_recente" in ctx).toBe(false);
  });

  it("anúncio duplicado (id diferente, mesmo título e texto): não repete o mesmo texto", async () => {
    const { ctx } = await contexto({
      origem: ORIGEM_A,
      ultimaComAnuncio: [{
        anuncio: naMensagem({ ...ANUNCIO_A, source_id: "120200000000000099" }),
        created_at: QUANDO,
      }],
    });
    expect("anuncio_mais_recente" in ctx).toBe(false);
  });

  it("nenhuma mensagem veio de anúncio: a chave nem aparece", async () => {
    const { ctx } = await contexto({ origem: ORIGEM_A, ultimaComAnuncio: [] });
    expect("anuncio_mais_recente" in ctx).toBe(false);
    expect(ctx.anuncio_de_origem?.titulo).toBe("Pico de alta presión");
  });

  it("metadata malformado não derruba o turno — vira ausência", async () => {
    for (const anuncio of ["lixo", 42, [], { titulo: 42, texto: {} }, null]) {
      const { ctx } = await contexto({
        origem: ORIGEM_A,
        ultimaComAnuncio: [{ anuncio, created_at: QUANDO }],
      });
      expect("anuncio_mais_recente" in ctx).toBe(false);
    }
    const { ctx } = await contexto({
      origem: ORIGEM_A,
      ultimaComAnuncio: [{ anuncio: naMensagem(ANUNCIO_B), created_at: "não é data" }],
    });
    expect("anuncio_mais_recente" in ctx).toBe(false);
  });

  it("a consulta cai: o contexto segue montando, sem o anúncio mais recente", async () => {
    const { ctx } = await contexto({ origem: ORIGEM_A, ultimaComAnuncio: "lança" });
    expect("anuncio_mais_recente" in ctx).toBe(false);
    expect(ctx.contact.name).toBe("Carlos");
  });
});
