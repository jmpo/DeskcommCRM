import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONVERSAS_IGNORADAS, WahaClient } from "@/lib/waha/client";

/**
 * O CRM PAGAVA POR CONVERSA QUE ELE MESMO DESCARTA.
 *
 * ─── Medido no banco de produção, 20/08/2026 ────────────────────────────────
 *
 * Todo evento do WAHA é arquivado inteiro. Separando os de mensagem por origem:
 *
 *   estados / difusão ......... 23.010 ... 271 MB
 *   grupos .................... 17.970 .... 89 MB
 *   canais / newsletter ........ 1.818 .... 16 MB
 *   conversa 1-a-1 ............. 4.739 .... 19 MB   ← o negócio
 *
 * 376 dos 395 MB eram conversa que o CRM recebe, grava inteira e joga fora —
 * `handleInbound` já ignora tudo que não é 1-a-1. O gasto acontecia ANTES da
 * decisão: na rede, na CPU do contêiner e no arquivo.
 *
 * ─── Por que a convergência importa mais que a criação ──────────────────────
 *
 * `POST /api/sessions` devolve 422 quando a sessão já existe, e nesse caminho a
 * config NÃO é aplicada. Foi exatamente assim que a sessão de produção ficou
 * sem o filtro: ela nasceu antes desta mudança e nenhum código voltaria para
 * ajustá-la. Sem o PUT, esta economia só valeria para instalação nova.
 */

const fetchOriginal = globalThis.fetch;
let chamadas: { url: string; metodo: string; corpo: unknown }[] = [];

function espionar(respostas: Record<string, number>) {
  globalThis.fetch = vi.fn(async (url: unknown, init?: unknown) => {
    const u = String(url);
    const i = (init ?? {}) as { method?: string; body?: string };
    chamadas.push({ url: u, metodo: i.method ?? "GET", corpo: i.body ? JSON.parse(i.body) : null });
    const status =
      Object.entries(respostas).find(([frag]) => u.includes(frag))?.[1] ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({ status: "SCAN_QR_CODE" }),
      text: async () => "",
    };
  }) as unknown as typeof fetch;
}

beforeEach(() => { chamadas = []; });
afterEach(() => { globalThis.fetch = fetchOriginal; });

describe("a sessão nasce ignorando o que o CRM não atende", () => {
  it("a criação leva as quatro categorias", async () => {
    espionar({});
    await new WahaClient("http://w", "k").startSession("s1");
    const criacao = chamadas.find((c) => c.url.endsWith("/api/sessions") && c.metodo === "POST");
    expect((criacao?.corpo as { config?: { ignore?: unknown } })?.config?.ignore).toEqual({
      status: true, broadcast: true, channels: true, groups: true,
    });
  });

  it("os estados são a categoria que mais pesava — não podem sair da lista", () => {
    // 271 MB de 395 MB, sozinhos. Se alguém "aliviar" o filtro, é por aqui que
    // o banco volta a crescer 23 MB/dia.
    expect(CONVERSAS_IGNORADAS.status, "os estados voltaram a ser recebidos").toBe(true);
  });
});

describe("sessão que JÁ existe também é corrigida", () => {
  it("422 na criação dispara o PUT da config", async () => {
    // Este é o caso da instalação real: a sessão nasceu antes da mudança. Sem
    // isto, a economia só valeria para quem instalar do zero.
    espionar({ "/api/sessions": 422 });
    await new WahaClient("http://w", "k").startSession("s1").catch(() => undefined);
    const put = chamadas.find((c) => c.metodo === "PUT");
    expect(put, "a sessão existente ficou sem o filtro").toBeTruthy();
    expect((put?.corpo as { config?: { ignore?: unknown } })?.config?.ignore).toEqual(
      CONVERSAS_IGNORADAS,
    );
  });

  it("falha do PUT não impede a sessão de iniciar", async () => {
    // É economia, não condição de envio. Uma versão do WAHA que não conheça o
    // PUT faria toda reconexão falhar por causa de um byte poupado.
    espionar({ "/api/sessions": 422 });
    const cliente = new WahaClient("http://w", "k");
    globalThis.fetch = vi.fn(async (url: unknown, init?: unknown) => {
      const u = String(url);
      const m = ((init ?? {}) as { method?: string }).method ?? "GET";
      if (m === "PUT") throw new Error("ECONNRESET");
      chamadas.push({ url: u, metodo: m, corpo: null });
      return { ok: m !== "POST", status: m === "POST" ? 422 : 200,
               json: async () => ({ status: "WORKING" }), text: async () => "" };
    }) as unknown as typeof fetch;
    await expect(cliente.startSession("s1")).resolves.toBeTruthy();
  });
});
