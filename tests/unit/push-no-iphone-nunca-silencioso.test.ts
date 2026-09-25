/**
 * No iPhone, TODO push mostra notificação — mesmo com o app aberto.
 *
 * O Safari (iOS e Mac) cancela a assinatura depois de 3 pushes sem
 * notificação, sem erro nenhum: os avisos simplesmente param. O service worker
 * pulava a bandeja quando havia janela visível — certo no Chrome, onde a
 * página já avisa, e fatal no iPhone de quem usa o app o dia todo.
 *
 * O teste EXECUTA `public/notify-sw.js` num `self` de mentira, em vez de ler o
 * texto: o que importa é o `showNotification` acontecer.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const CODIGO = fs.readFileSync(path.join(process.cwd(), "public/notify-sw.js"), "utf8");

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";
const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36";
const SAFARI_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15";
const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

async function push(userAgent: string, janelaVisivel: boolean) {
  const ouvintes: Record<string, (e: unknown) => void> = {};
  const showNotification = vi.fn(async (_titulo: string, _opcoes: { badge?: string }) => undefined);
  const self = {
    navigator: { userAgent },
    location: { origin: "https://crm.exemplo" },
    registration: { showNotification },
    clients: {
      matchAll: async () => (janelaVisivel ? [{ visibilityState: "visible" }] : []),
      claim: async () => undefined,
    },
    skipWaiting: async () => undefined,
    addEventListener: (tipo: string, fn: (e: unknown) => void) => {
      ouvintes[tipo] = fn;
    },
  };
  vm.runInNewContext(CODIGO, { self, URL });
  let espera: Promise<unknown> = Promise.resolve();
  ouvintes.push!({
    data: { json: () => ({ title: "🎉 ¡Nueva venta! Gs. 125.000", body: "Pedido confirmado", tag: "aviso:i1" }) },
    waitUntil: (p: Promise<unknown>) => {
      espera = p;
    },
  });
  await espera;
  return showNotification;
}

describe("push com o app aberto", () => {
  it("iPhone: mostra a notificação mesmo com a janela visível", async () => {
    const mostrar = await push(IPHONE, true);
    expect(mostrar).toHaveBeenCalledTimes(1);
    expect(mostrar.mock.calls[0]![0]).toBe("🎉 ¡Nueva venta! Gs. 125.000");
  });

  it("Safari no Mac: idem — a regra do WebKit é a mesma", async () => {
    expect(await push(SAFARI_MAC, true)).toHaveBeenCalledTimes(1);
  });

  it("Chrome (Android e Mac) com a janela visível: a página avisa, a bandeja não repete", async () => {
    expect(await push(CHROME_ANDROID, true)).not.toHaveBeenCalled();
    expect(await push(CHROME_MAC, true)).not.toHaveBeenCalled();
  });

  it("app fechado: mostra em todo lugar, com o selo da marca", async () => {
    for (const ua of [IPHONE, CHROME_ANDROID]) {
      const mostrar = await push(ua, false);
      expect(mostrar).toHaveBeenCalledTimes(1);
      expect(mostrar.mock.calls[0]![1].badge).toBe(
        "https://crm.exemplo/icone/selo",
      );
    }
  });
});
