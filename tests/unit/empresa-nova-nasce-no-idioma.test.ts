/**
 * A EMPRESA NOVA NASCE NO IDIOMA DE QUEM SE CADASTROU.
 *
 * ─── O defeito, medido em produção (QA de 26/10/2026) ──────────────────────
 *
 * Uma pessoa de Assunção se cadastrava numa tela em espanhol, confirmava o
 * e-mail e caía num wizard inteiro em português: a organização nascia com os
 * defaults da coluna (`pt-BR`, `America/Sao_Paulo`, `BRL`), e o funil semeado,
 * o prompt do agente e as palavras de passagem vinham junto, em português.
 *
 * Este arquivo cobra as três metades:
 *   1. a REGRA (`perfilDaEmpresaNova`): idioma da tela, fuso do navegador,
 *      moeda do país — e o caminho `pt-BR` INTACTO, porque a instalação da
 *      upstream é brasileira;
 *   2. o PROVISIONAMENTO grava a regra no INSERT e põe os nomes semeados no
 *      idioma da empresa;
 *   3. a entrada com Google leva as mesmas pistas pela URL de volta.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { perfilDaEmpresaNova, pistasParaGuardar } from "@/lib/auth/perfil-da-empresa-nova";
import { urlDeRetornoDoGoogle } from "@/lib/auth/entrada-com-google";

describe("perfilDaEmpresaNova — a regra", () => {
  it("⭐ espanhol + fuso de Assunção: es, America/Asuncion e guarani", () => {
    expect(perfilDaEmpresaNova({ idioma: "es", fuso: "America/Asuncion" })).toEqual({
      locale: "es",
      timezone: "America/Asuncion",
      currency: "PYG",
    });
  });

  it("⭐ o país NÃO é gravado enquanto não há perfil legal revisado do Paraguai", () => {
    // Gravar `PY` sem perfil faria Configurações › Empresa recusar o salvar
    // ("País sem perfil revisado: PY") — a empresa sem conseguir editar o
    // próprio cadastro. Quando o perfil existir, esta linha muda sozinha.
    expect(perfilDaEmpresaNova({ idioma: "es", fuso: "America/Asuncion" })).not.toHaveProperty(
      "country",
    );
  });

  it("sem fuso do navegador, a região do Accept-Language decide (es-PY → Paraguai)", () => {
    expect(
      perfilDaEmpresaNova({ idioma: "es", acceptLanguage: "es-PY,es;q=0.9,en;q=0.8" }),
    ).toEqual({
      locale: "es",
      timezone: "America/Asuncion",
      currency: "PYG",
    });
  });

  it("⭐ pt-BR nasce como sempre nasceu: só o idioma, os defaults da coluna para o resto", () => {
    // Mesmo com o navegador em Assunção: a instalação brasileira não muda.
    expect(perfilDaEmpresaNova({ idioma: "pt-BR", fuso: "America/Asuncion" })).toEqual({
      locale: "pt-BR",
    });
    expect(perfilDaEmpresaNova({})).toEqual({ locale: "pt-BR" });
  });

  it("idioma da tela vence o cabeçalho; idioma desconhecido cai no cabeçalho", () => {
    expect(perfilDaEmpresaNova({ idioma: "pt-BR", acceptLanguage: "es-PY" }).locale).toBe("pt-BR");
    expect(perfilDaEmpresaNova({ idioma: "xx", acceptLanguage: "es-PY" }).locale).toBe("es");
  });

  it("fuso que o Intl recusa (o acento de quem escreve à mão) é ignorado, não gravado", () => {
    const perfil = perfilDaEmpresaNova({
      idioma: "es",
      fuso: "America/Asunción",
      acceptLanguage: "es-PY",
    });
    expect(perfil.timezone).toBe("America/Asuncion");
  });

  it("fuso válido mas fora das opções de Configurações não é gravado (o <select> mostraria outro)", () => {
    const perfil = perfilDaEmpresaNova({ idioma: "es", fuso: "America/Caracas" });
    expect(perfil).toEqual({ locale: "es" });
  });

  it("país cuja moeda o produto não serve fica com a moeda padrão (não inventa)", () => {
    expect(perfilDaEmpresaNova({ idioma: "es", fuso: "America/Argentina/Buenos_Aires" })).toEqual({
      locale: "es",
      timezone: "America/Argentina/Buenos_Aires",
    });
    expect(perfilDaEmpresaNova({ idioma: "es", fuso: "Europe/Madrid" }).currency).toBe("EUR");
  });

  it("pistasParaGuardar: só idioma servido e fuso que existe", () => {
    expect(pistasParaGuardar({ idioma: "es", fuso: "America/Asuncion" })).toEqual({
      idioma: "es",
      fuso: "America/Asuncion",
    });
    expect(pistasParaGuardar({ idioma: "zh-CN", fuso: "Lua/Base" })).toEqual({});
    expect(pistasParaGuardar({ idioma: 42, fuso: "x".repeat(200) })).toEqual({});
  });
});

describe("urlDeRetornoDoGoogle — as pistas atravessam o Google", () => {
  it("⭐ idioma e fuso vão na URL de volta, saneados", () => {
    const url = new URL(
      urlDeRetornoDoGoogle("https://crm.exemplo", { idioma: "es", fuso: "America/Asuncion" }),
    );
    expect(url.searchParams.get("idioma")).toBe("es");
    expect(url.searchParams.get("fuso")).toBe("America/Asuncion");
  });

  it("sem pistas (ou adulteradas), a URL é a de sempre", () => {
    expect(urlDeRetornoDoGoogle("https://crm.exemplo", {})).toBe(
      "https://crm.exemplo/auth/callback",
    );
    expect(urlDeRetornoDoGoogle("https://crm.exemplo", { idioma: "xx", fuso: "nada" })).toBe(
      "https://crm.exemplo/auth/callback",
    );
  });
});

// ── 2. o provisionamento ─────────────────────────────────────────────────────

interface Escrita {
  tabela: string;
  op: "insert" | "update" | "select";
  payload: Record<string, unknown> | null;
  filtros: Record<string, unknown>;
}
const escritas: Escrita[] = [];

function bancoFalso() {
  return {
    from: (tabela: string) => {
      const e: Escrita = { tabela, op: "select", payload: null, filtros: {} };
      const responder = () => {
        if (tabela === "user_organizations" && e.op === "select")
          return { data: null, error: null };
        if (tabela === "organizations" && e.op === "insert")
          return { data: { id: "org-nova", slug: "x" }, error: null };
        if (tabela === "crm_pipelines") return { data: { id: "funil-1" }, error: null };
        if (e.op === "update") return { data: [{ id: "linha" }], error: null };
        return { data: null, error: null };
      };
      const b = {
        select: () => b,
        insert: (p: Record<string, unknown>) => {
          e.op = "insert";
          e.payload = p;
          escritas.push(e);
          return b;
        },
        update: (p: Record<string, unknown>) => {
          e.op = "update";
          e.payload = p;
          escritas.push(e);
          return b;
        },
        eq: (c: string, v: unknown) => {
          e.filtros[c] = v;
          return b;
        },
        is: (c: string, v: unknown) => {
          e.filtros[c] = v;
          return b;
        },
        in: (c: string, v: unknown) => {
          e.filtros[`in:${c}`] = v;
          return b;
        },
        limit: () => b,
        single: async () => responder(),
        maybeSingle: async () => responder(),
        then: (ok: (r: unknown) => unknown) => Promise.resolve(responder()).then(ok),
      };
      return b;
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => bancoFalso() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

describe("ensureTenantForUser — a empresa nasce com o perfil", () => {
  beforeEach(() => {
    escritas.length = 0;
  });

  it("⭐ cadastro em espanhol: o INSERT leva es, Assunção e guarani, e as etapas semeadas viram espanhol", async () => {
    const { ensureTenantForUser } = await import("@/lib/auth/provision");
    await ensureTenantForUser({
      id: "u-1",
      email: "dueno@ferreteria.py",
      user_metadata: {
        org_name: "Ferretería",
        idioma_do_cadastro: "es",
        fuso_do_cadastro: "America/Asuncion",
      },
    });

    const org = escritas.find((e) => e.tabela === "organizations" && e.op === "insert");
    expect(org?.payload).toMatchObject({
      locale: "es",
      timezone: "America/Asuncion",
      currency: "PYG",
    });

    const etapas = escritas.filter((e) => e.tabela === "crm_stages" && e.op === "update");
    const pago = etapas.find((e) => e.filtros.slug === "pago");
    expect(pago?.payload).toEqual({ name: "Pagado" });
    // Só a etapa que AINDA tem o nome semeado: renomeada por alguém, nunca é tocada.
    expect(pago?.filtros["in:name"]).toEqual(["Pago"]);
    // O slug é a chave da 0621 (funil pulado) — não muda.
    expect(etapas.every((e) => !("slug" in (e.payload ?? {})))).toBe(true);

    const tipos = escritas.filter((e) => e.tabela === "calendar_event_types" && e.op === "update");
    expect(tipos.find((e) => e.filtros.slug === "reuniao")?.payload).toEqual({ name: "Reunión" });
  });

  it("⭐ cadastro em português: o INSERT é o de sempre e nada é renomeado", async () => {
    const { ensureTenantForUser } = await import("@/lib/auth/provision");
    await ensureTenantForUser({
      id: "u-2",
      email: "dono@loja.com.br",
      user_metadata: {
        org_name: "Loja",
        idioma_do_cadastro: "pt-BR",
        fuso_do_cadastro: "America/Asuncion",
      },
    });

    const org = escritas.find((e) => e.tabela === "organizations" && e.op === "insert");
    expect(org?.payload).toMatchObject({ locale: "pt-BR" });
    expect(org?.payload).not.toHaveProperty("timezone");
    expect(org?.payload).not.toHaveProperty("currency");
    expect(escritas.some((e) => e.op === "update")).toBe(false);
  });

  it("conta antiga, sem pistas no metadado: o Accept-Language da confirmação decide", async () => {
    const { ensureTenantForUser } = await import("@/lib/auth/provision");
    await ensureTenantForUser(
      { id: "u-3", email: "x@y.py", user_metadata: { org_name: "X" } },
      { pistas: { acceptLanguage: "es-PY,es;q=0.9" } },
    );
    const org = escritas.find((e) => e.tabela === "organizations" && e.op === "insert");
    expect(org?.payload).toMatchObject({
      locale: "es",
      timezone: "America/Asuncion",
      currency: "PYG",
    });
  });
});
