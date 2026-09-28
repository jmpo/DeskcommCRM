/**
 * O PINO GANHA RUA, BAIRRO E CIDADE APROXIMADOS — quando a organização tem a
 * chave de Mapas (migration 0444).
 *
 * Medido numa loja (28/09/2026): 10 de 10 pinos do mês chegaram só com
 * coordenadas, e o agente lia um link sem saber a cidade. As respostas do
 * Google abaixo são recortes das REAIS, pedidas em 28/09 para pontos públicos.
 *
 * O que este arquivo prende:
 * - a leitura da resposta: a cidade é o DISTRITO, sem bairro nem número —
 *   medido contra 8 pedidos confirmados (distrito 8/8, bairro 1/8, número
 *   interpolado) —, e os erros que pedem ações diferentes de quem configura
 *   (API não habilitada × chave recusada);
 * - o corpo do pino — o que o agente lê — com "(aprox.)", e IDÊNTICO ao de
 *   antes quando não há endereço;
 * - o recebimento do pino: sem chave, nenhuma chamada ao Google; com chave, o
 *   endereço entra; Google fora do ar, o pino entra como antes.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { completarLocalizacao } from "@/lib/channels/zernio/localizacao";
import { resolveZernioCreds } from "@/lib/channels/zernio/credentials";
import type { ZernioInboundMessage } from "@/lib/channels/zernio/webhook";
import {
  geocodificarReverso,
  idiomaDaConsulta,
  lerRespostaDoGoogle,
  textoDoEnderecoAproximado,
} from "@/lib/mapas/geocodificacao";
import { corpoDaLocalizacao, lerLocalizacao } from "@/lib/messaging/localizacao";

vi.mock("@/lib/channels/zernio/credentials", async (orig) => ({
  ...(await orig<typeof import("@/lib/channels/zernio/credentials")>()),
  resolveZernioCreds: vi.fn(),
}));

const comp = (long_name: string, ...types: string[]) => ({ long_name, short_name: long_name, types });

/** Capiatá (28/09/2026): o primeiro resultado já é a rua com número. */
const CAPIATA = {
  status: "OK",
  results: [
    {
      types: ["premise", "street_address"],
      address_components: [
        comp("402", "street_number"),
        comp("Boqueron", "route"),
        comp("Santo Domingo", "neighborhood", "political"),
        comp("Capiatá", "locality", "political"),
        comp("Capiatá", "administrative_area_level_2", "political"),
        comp("Central", "administrative_area_level_1", "political"),
        comp("Paraguay", "country", "political"),
      ],
    },
  ],
};

/** Asunción (28/09/2026): o primeiro resultado é um estabelecimento SEM bairro; o segundo tem. */
const ASUNCION = {
  status: "OK",
  results: [
    {
      types: ["establishment", "lodging", "point_of_interest"],
      address_components: [
        comp("1155", "street_number"),
        comp("Ytororó", "route"),
        comp("Asunción", "locality", "political"),
        comp("Asunción", "administrative_area_level_1", "political"),
      ],
    },
    {
      types: ["neighborhood", "political"],
      address_components: [
        comp("Itá Enramada", "neighborhood", "political"),
        comp("San Juan", "sublocality_level_1", "sublocality", "political"),
        comp("Asunción", "locality", "political"),
      ],
    },
  ],
};

describe("a resposta do Google vira endereço aproximado", () => {
  it("rua, cidade e departamento — sem bairro nem número", () => {
    const r = lerRespostaDoGoogle(CAPIATA);
    expect(r).toEqual({ ok: true, endereco: { rua: "Boqueron", cidade: "Capiatá", regiao: "Central" } });
    expect(r.ok && textoDoEnderecoAproximado(r.endereco)).toBe("Boqueron, Capiatá, Central");
  });

  it("o departamento igual à cidade não se repete, e sem distrito vale a localidade", () => {
    const r = lerRespostaDoGoogle(ASUNCION);
    expect(r.ok && textoDoEnderecoAproximado(r.endereco)).toBe("Ytororó, Asunción");
  });

  it("⭐ zona rural: a cidade é o DISTRITO, não a compañía que o Google chama de localidade", () => {
    // Pedido confirmado em Atyrá (28/09/2026): locality "Tucangua Cordillera",
    // administrative_area_level_2 "Atyrá" — e o cliente escreveu Atyrá.
    const r = lerRespostaDoGoogle({
      status: "OK",
      results: [
        {
          address_components: [
            comp("Ruta Tobati - Atyra", "route"),
            comp("San Vicente", "neighborhood", "political"),
            comp("Tucangua Cordillera", "locality", "political"),
            comp("Atyrá", "administrative_area_level_2", "political"),
            comp("Cordillera", "administrative_area_level_1", "political"),
          ],
        },
      ],
    });
    expect(r.ok && textoDoEnderecoAproximado(r.endereco)).toBe("Ruta Tobati - Atyra, Atyrá, Cordillera");
  });

  it("\"Unnamed Road\" não é rua, e \"Central Department\" é Central", () => {
    // Os dois medidos em pinos reais de 28/09 (Ypané e Capiatá).
    const r = lerRespostaDoGoogle({
      status: "OK",
      results: [
        {
          address_components: [
            comp("Unnamed Road", "route"),
            comp("Ypané", "administrative_area_level_2", "political"),
            comp("Central Department", "administrative_area_level_1", "political"),
          ],
        },
      ],
    });
    expect(r).toEqual({ ok: true, endereco: { cidade: "Ypané", regiao: "Central" } });
  });

  it("⭐ API não habilitada e chave recusada são motivos DIFERENTES — pedem ações diferentes", () => {
    // Texto real de 28/09/2026, com a Geocoding API ainda desligada no projeto.
    expect(
      lerRespostaDoGoogle({ status: "REQUEST_DENIED", error_message: "This API is not activated on your API project." }),
    ).toMatchObject({ ok: false, motivo: "api_desativada" });
    expect(
      lerRespostaDoGoogle({ status: "REQUEST_DENIED", error_message: "The provided API key is invalid." }),
    ).toMatchObject({ ok: false, motivo: "chave_recusada" });
    expect(lerRespostaDoGoogle({ status: "ZERO_RESULTS", results: [] })).toMatchObject({ ok: false, motivo: "sem_resultado" });
    expect(lerRespostaDoGoogle({ status: "OVER_QUERY_LIMIT" })).toMatchObject({ ok: false, motivo: "cota" });
    expect(lerRespostaDoGoogle("lixo")).toMatchObject({ ok: false, motivo: "desconhecido" });
  });

  it("OK sem nenhum componente útil não inventa endereço", () => {
    expect(lerRespostaDoGoogle({ status: "OK", results: [{ address_components: [comp("Paraguay", "country")] }] })).toEqual({
      ok: false,
      motivo: "sem_resultado",
    });
  });

  it("o idioma dos nomes segue o da organização", () => {
    expect(idiomaDaConsulta("es-PY")).toBe("es");
    expect(idiomaDaConsulta("pt-BR")).toBe("pt-BR");
    expect(idiomaDaConsulta(null)).toBe("pt-BR");
  });
});

describe("a chamada ao Google", () => {
  it("manda coordenadas, idioma e chave; não lança em rede fora nem em resposta sem JSON", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(CAPIATA), { status: 200 }));
    const r = await geocodificarReverso("CHAVE", { latitude: -25.3551, longitude: -57.4455 }, { idioma: "es", fetchImpl: f as never });
    expect(r.ok).toBe(true);
    const url = new URL(String((f.mock.calls[0] as unknown[])[0]));
    expect(url.host).toBe("maps.googleapis.com");
    expect(url.searchParams.get("latlng")).toBe("-25.3551,-57.4455");
    expect(url.searchParams.get("language")).toBe("es");
    expect(url.searchParams.get("key")).toBe("CHAVE");

    const fora = vi.fn(async () => {
      throw new DOMException("tempo", "TimeoutError");
    });
    expect(await geocodificarReverso("CHAVE", { latitude: 1, longitude: 2 }, { fetchImpl: fora as never })).toMatchObject({
      ok: false,
      motivo: "rede",
    });
    const html = vi.fn(async () => new Response("<html>", { status: 502 }));
    expect(await geocodificarReverso("CHAVE", { latitude: 1, longitude: 2 }, { fetchImpl: html as never })).toMatchObject({
      ok: false,
      motivo: "rede",
    });
  });
});

describe("o corpo do pino — o que o agente lê", () => {
  it("⭐ com endereço aproximado: marcado (aprox.), antes do link", () => {
    const loc = { latitude: -25.3551, longitude: -57.4455, aproximado: { rua: "Boqueron", cidade: "Capiatá", regiao: "Central" } };
    expect(corpoDaLocalizacao(loc)).toBe("📍 Boqueron, Capiatá, Central (aprox.) — https://maps.google.com/?q=-25.3551,-57.4455");
  });

  it("controle: sem endereço aproximado, o corpo é o mesmo de antes", () => {
    expect(corpoDaLocalizacao({ latitude: -25.3, longitude: -57.5 })).toBe("📍 https://maps.google.com/?q=-25.3,-57.5");
  });

  it("o endereço gravado no metadata volta na leitura (a tela o mostra), e lixo nele é ignorado", () => {
    const lida = lerLocalizacao({ latitude: -25.3, longitude: -57.5, aproximado: { cidade: "Lambaré", bairro: 7, x: "y" } });
    expect(lida?.aproximado).toEqual({ cidade: "Lambaré" });
    expect(lerLocalizacao({ latitude: -25.3, longitude: -57.5, aproximado: {} })?.aproximado).toBeUndefined();
  });
});

// ─── o recebimento do pino (Zernio), de ponta a ponta com rede de mentira ─────

const ORG = "11111111-1111-1111-1111-111111111111";

const PINO = {
  direction: "inbound",
  kind: "message",
  conversationId: "conv",
  externalId: "wamid.X",
  accountId: "acc_1",
  text: "📍 Location",
  attachments: [],
  sentAt: null,
  identity: {},
} as unknown as ZernioInboundMessage;

function adminFalso(opcoes: { temChave: boolean }) {
  const rpc = vi.fn(async (nome: string) => ({ data: nome === "fn_decrypt_oauth" ? "CHAVE_DE_MAPAS" : null, error: null }));
  return {
    rpc,
    from(tabela: string) {
      const linhas: Record<string, unknown> = {
        map_provider_credentials: opcoes.temChave ? { api_key_encrypted: "\\xabc" } : null,
        organizations: { locale: "es-PY" },
      };
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: linhas[tabela] ?? null, error: null }),
      };
      return q;
    },
  };
}

function redeFalsa(google: () => Response) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    if (String(url).includes("maps.googleapis.com")) return google();
    return new Response(
      JSON.stringify({ status: "success", messages: [{ id: "wamid.X", metadata: { location: { latitude: -25.3551, longitude: -57.4455 } } }] }),
      { status: 200 },
    );
  });
}

describe("o pino que chega pelo canal", () => {
  afterEach(() => vi.restoreAllMocks());

  it("⭐ com a chave de Mapas: o pino entra com rua, cidade e departamento", async () => {
    vi.mocked(resolveZernioCreds).mockResolvedValue({ accountId: "acc_1", apiKey: "k", baseUrl: "https://z.test/api", source: "session" });
    const f = redeFalsa(() => new Response(JSON.stringify(CAPIATA), { status: 200 }));
    const msg = await completarLocalizacao(adminFalso({ temChave: true }) as never, ORG, PINO);
    expect(msg.location?.aproximado).toEqual({ rua: "Boqueron", cidade: "Capiatá", regiao: "Central" });
    expect(corpoDaLocalizacao(msg.location!)).toContain("Boqueron, Capiatá, Central (aprox.)");
    const google = f.mock.calls.find(([u]) => String(u).includes("maps.googleapis.com"));
    expect(new URL(String(google![0])).searchParams.get("language")).toBe("es");
  });

  it("⭐ sem chave: nenhuma chamada ao Google, e o pino é o de antes", async () => {
    vi.mocked(resolveZernioCreds).mockResolvedValue({ accountId: "acc_1", apiKey: "k", baseUrl: "https://z.test/api", source: "session" });
    const f = redeFalsa(() => new Response("{}", { status: 200 }));
    const msg = await completarLocalizacao(adminFalso({ temChave: false }) as never, ORG, PINO);
    expect(msg.location).toEqual({ latitude: -25.3551, longitude: -57.4455 });
    expect(f.mock.calls.some(([u]) => String(u).includes("maps.googleapis.com"))).toBe(false);
  });

  it("Google recusando ou fora do ar: o pino entra com as coordenadas, sem endereço", async () => {
    vi.mocked(resolveZernioCreds).mockResolvedValue({ accountId: "acc_1", apiKey: "k", baseUrl: "https://z.test/api", source: "session" });
    redeFalsa(() => new Response(JSON.stringify({ status: "REQUEST_DENIED", error_message: "This API is not activated on your API project." }), { status: 200 }));
    const recusado = await completarLocalizacao(adminFalso({ temChave: true }) as never, ORG, PINO);
    expect(recusado.location).toEqual({ latitude: -25.3551, longitude: -57.4455 });

    vi.restoreAllMocks();
    vi.mocked(resolveZernioCreds).mockResolvedValue({ accountId: "acc_1", apiKey: "k", baseUrl: "https://z.test/api", source: "session" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("maps.googleapis.com")) throw new TypeError("fetch failed");
      return new Response(
        JSON.stringify({ status: "success", messages: [{ id: "wamid.X", metadata: { location: { latitude: -25.3551, longitude: -57.4455 } } }] }),
        { status: 200 },
      );
    });
    const foraDoAr = await completarLocalizacao(adminFalso({ temChave: true }) as never, ORG, PINO);
    expect(foraDoAr.location).toEqual({ latitude: -25.3551, longitude: -57.4455 });
  });
});
