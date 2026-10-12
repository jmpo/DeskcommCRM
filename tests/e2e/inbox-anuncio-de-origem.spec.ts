/**
 * O ANÚNCIO QUE TROUXE A PESSOA — provado pela tela, como quem atende lê a conversa.
 *
 * ## O pedido
 *
 * Operação real (Pedilo, 12/10/2026): "cuando un cliente viene de un anuncio,
 * que ese anuncio aparezca en la conversación y al costado, para saber por qué
 * anuncio de Meta Ads vino". O dado já existia — `metadata.anuncio` na mensagem
 * nascida do clique e `source_metadata.ad_*` no contato — e só a ficha do
 * contato o mostrava.
 *
 * ## O que esta spec mede que o teste de componente não mede
 *
 * - que `metadata.anuncio` sobrevive à rota de mensagens até a bolha certa;
 * - que o `crm-summary` devolve o anúncio de origem e o mais recente ao painel;
 * - que a imagem CARREGA (`naturalWidth > 0`), e não só que o `<img>` existe;
 * - no tema escuro, o CONTRASTE do nome da conversa selecionada, medido com a
 *   cor computada do texto contra o fundo efetivo (a captura de 12/10 mostrava
 *   o nome branco sobre a linha selecionada branca).
 *
 * A miniatura da Meta é https e externa; a spec a serve por `page.route`, para
 * provar o carregamento sem depender da rede.
 *
 * Pré-requisitos (banco local, app buildada):
 *   pnpm exec tsx scripts/seed-e2e-credentials.ts
 *   pnpm e2e:env && pnpm e2e:build
 *   E2E_PORT=3021 pnpm exec playwright test tests/e2e/inbox-anuncio-de-origem.spec.ts
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { expect, test, type Page } from "./helpers/test";
import { createClient } from "@supabase/supabase-js";

import { carregarEnvLocal } from "../../scripts/lib/env-de-teste";

const CREDS_PATH = path.join(process.cwd(), ".e2e-creds.json");
const EVIDENCIA = path.join(process.cwd(), "evidence/inbox-anuncio-de-origem");

interface Creds {
  password: string;
  org_id: string;
  users: Record<string, { id: string; email: string; role: string }>;
}

const env = carregarEnvLocal();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PREFIXO = "Anuncio de Origem E2E";
const NOME_DO_CONTATO = `${PREFIXO} ${Date.now()}`;
const MINIATURA_A = "https://scontent.e2e-anuncio.test/pico.svg";
const MINIATURA_B = "https://scontent.e2e-anuncio.test/parasol.svg";
const ANUNCIO_A = {
  titulo: "DELIVERY GRATIS",
  texto: "Pico de alta presión: lavá el auto con tu manguera. Pagás cuando te llega.",
  ad_id: "120251615780570072",
  url: "https://fb.me/pico-e2e",
  miniatura: MINIATURA_A,
};
const ANUNCIO_B = {
  titulo: "ENVÍO GRATIS",
  texto: "Parasol para auto: protegé tu tablero del sol.",
  ad_id: "120251738379250072",
  url: "https://fb.me/parasol-e2e",
  miniatura: MINIATURA_B,
};
const PRIMEIRA = "Hola, ¿cuál es el precio?";
const SEGUNDA = "¿Y el parasol cuánto sale?";

let creds: Creds;
let conversaId = "";

const svg = (cor: string, rotulo: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="${cor}"/>` +
  `<text x="60" y="68" font-size="22" text-anchor="middle" fill="#fff" font-family="sans-serif">${rotulo}</text></svg>`;

async function servirMiniaturas(page: Page): Promise<void> {
  await page.route("https://scontent.e2e-anuncio.test/**", (rota) =>
    rota.fulfill({
      contentType: "image/svg+xml",
      body: rota.request().url().includes("parasol") ? svg("#c2410c", "PARASOL") : svg("#1d4ed8", "PICO"),
    }),
  );
}

async function login(page: Page, email: string, senha: string): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(senha);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/app/, { timeout: 60_000 });
}

async function limpar(): Promise<void> {
  const { data } = await admin
    .from("contacts")
    .select("id")
    .eq("organization_id", creds.org_id)
    .like("display_name", `${PREFIXO}%`);
  const ids = ((data as Array<{ id: string }> | null) ?? []).map((c) => c.id);
  if (ids.length === 0) return;
  await admin.from("messages").delete().in("contact_id", ids);
  await admin.from("conversations").delete().in("contact_id", ids);
  await admin.from("contacts").delete().in("id", ids);
}

test.describe("Inbox — o anúncio que trouxe a pessoa aparece na conversa e no painel", () => {
  test.describe.configure({ timeout: 180_000 });

  test.beforeAll(async () => {
    if (!fs.existsSync(CREDS_PATH)) {
      execFileSync("npx", ["tsx", "scripts/seed-e2e-credentials.ts"], { stdio: "inherit" });
    }
    creds = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as Creds;
    await limpar();

    const { data: sessaoExistente } = await admin
      .from("channel_sessions")
      .select("id")
      .eq("organization_id", creds.org_id)
      .limit(1)
      .maybeSingle();
    let sessaoId = (sessaoExistente as { id: string } | null)?.id ?? null;
    if (!sessaoId) {
      const { data, error } = await admin
        .from("channel_sessions")
        .insert({
          organization_id: creds.org_id,
          waha_session_name: `e2e-anuncio-de-origem-${Date.now()}`,
          webhook_secret_encrypted: "e2e",
        })
        .select("id")
        .single();
      if (error) throw new Error(`channel_sessions: ${error.message}`);
      sessaoId = (data as { id: string }).id;
    }

    const t0 = Date.now() - 60_000;
    // O contato como `estamparAtribuicaoDoContato` o carimba no primeiro clique.
    const { data: contato, error: erroContato } = await admin
      .from("contacts")
      .insert({
        organization_id: creds.org_id,
        display_name: NOME_DO_CONTATO,
        phone_number: `+59598${String(Date.now()).slice(-7)}`,
        source: "meta_ads",
        source_metadata: {
          ad_platform: "meta_ads",
          ad_source_id: "clique-e2e",
          ad_id: ANUNCIO_A.ad_id,
          ad_title: ANUNCIO_A.titulo,
          ad_body: ANUNCIO_A.texto,
          ad_source_url: ANUNCIO_A.url,
          ad_thumbnail_url: MINIATURA_A,
          ad_raw: { source_type: "ad" },
          ad_captured_at: new Date(t0).toISOString(),
        },
      })
      .select("id")
      .single();
    if (erroContato) throw new Error(`contacts: ${erroContato.message}`);
    const contatoId = (contato as { id: string }).id;

    const { data: conversa, error: erroConversa } = await admin
      .from("conversations")
      .insert({
        organization_id: creds.org_id,
        contact_id: contatoId,
        channel_session_id: sessaoId,
        status: "open",
        last_message_at: new Date(t0 + 2000).toISOString(),
        last_inbound_at: new Date(t0 + 2000).toISOString(),
      })
      .select("id")
      .single();
    if (erroConversa) throw new Error(`conversations: ${erroConversa.message}`);
    conversaId = (conversa as { id: string }).id;

    const base = {
      organization_id: creds.org_id,
      conversation_id: conversaId,
      channel_session_id: sessaoId,
      contact_id: contatoId,
      direction: "inbound",
      status: "received",
      sent_via: "external_device",
      type: "text",
    };
    const linhas = [
      { ...base, body: PRIMEIRA, metadata: { anuncio: ANUNCIO_A }, sent_at: new Date(t0).toISOString(), created_at: new Date(t0).toISOString() },
      // Voltou dias depois por OUTRO anúncio: é o que o painel chama de mais recente.
      { ...base, body: SEGUNDA, metadata: { anuncio: ANUNCIO_B }, sent_at: new Date(t0 + 2000).toISOString(), created_at: new Date(t0 + 2000).toISOString() },
    ];
    for (const linha of linhas) {
      const { error } = await admin.from("messages").insert(linha);
      if (error) throw new Error(`messages (${linha.body}): ${error.message}`);
    }
  });

  test.afterAll(async () => {
    await limpar();
  });

  test("a bolha do clique mostra o anúncio, e o painel diz o de origem e o mais recente", async ({ page }) => {
    await servirMiniaturas(page);
    await login(page, creds.users.agent!.email, creds.password);
    await page.goto(`/app/inbox/${conversaId}`);
    await expect(page.getByText(PRIMEIRA, { exact: true })).toBeVisible({ timeout: 60_000 });

    // Na bolha: o cartão do anúncio daquela mensagem, acima do texto do cliente.
    const bolha = (texto: string) => page.getByTestId("message-bubble").filter({ hasText: texto });
    const cartaoA = bolha(PRIMEIRA).getByTestId("anuncio-card");
    await expect(cartaoA).toContainText(ANUNCIO_A.titulo);
    await expect(cartaoA.getByRole("link", { name: /Ver an[uú]ncio/ })).toHaveAttribute("href", ANUNCIO_A.url);
    await expect
      .poll(() => cartaoA.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
      .toBe(true);
    await expect(bolha(SEGUNDA).getByTestId("anuncio-card")).toContainText(ANUNCIO_B.titulo);

    // No painel: o de origem (primeiro toque) e o mais recente, que é outro.
    const painel = page.getByTestId("inbox-anuncio");
    await expect(painel).toContainText(/Anúncio de origem|Anuncio de origen/);
    const cartoes = painel.getByTestId("anuncio-card");
    await expect(cartoes).toHaveCount(2);
    await expect(cartoes.nth(0)).toContainText(ANUNCIO_A.texto);
    await expect(painel).toContainText(/Voltou por outro anúncio|Volvió por otro anuncio/);
    await expect(cartoes.nth(1)).toContainText(ANUNCIO_B.texto);

    // O cartão cabe na coluna do painel: nada sai pela lateral (medido).
    const caixaDoPainel = await painel.boundingBox();
    for (const c of await cartoes.all()) {
      const caixa = await c.boundingBox();
      expect(caixa && caixaDoPainel && caixa.x + caixa.width <= caixaDoPainel.x + caixaDoPainel.width + 1).toBeTruthy();
    }

    fs.mkdirSync(EVIDENCIA, { recursive: true });
    await page.screenshot({ path: path.join(EVIDENCIA, "01-anuncio-na-bolha-e-no-painel.png"), animations: "disabled" });
  });

  test("no tema escuro, o nome da conversa selecionada é legível", async ({ page }) => {
    await servirMiniaturas(page);
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("deskcomm-theme", "dark");
      } catch {
        /* sem storage o teste reprova no poll abaixo, que é o que deve acontecer */
      }
    });
    await login(page, creds.users.agent!.email, creds.password);
    await page.goto(`/app/inbox/${conversaId}`);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme")))
      .toBe("dark");

    const linha = page.locator(`[data-conversation-id="${conversaId}"]`);
    await expect(linha).toHaveAttribute("aria-current", "true", { timeout: 60_000 });
    const nome = linha.getByText(NOME_DO_CONTATO, { exact: true });
    await expect(nome).toBeVisible();

    // Contraste WCAG entre a cor computada do nome e o fundo EFETIVO da linha
    // (o fundo da selecionada é translúcido: compõe sobre os ancestrais).
    const contraste = await nome.evaluate((el) => {
      const rgba = (s: string) => {
        const n = s.match(/[\d.]+/g)!.map(Number);
        return { r: n[0]!, g: n[1]!, b: n[2]!, a: n[3] ?? 1 };
      };
      const camadas: Array<{ r: number; g: number; b: number; a: number }> = [];
      for (let no: Element | null = el; no; no = no.parentElement) {
        const c = rgba(getComputedStyle(no).backgroundColor);
        if (c.a > 0) camadas.push(c);
        if (c.a >= 1) break;
      }
      let fundo = { r: 255, g: 255, b: 255 };
      for (const c of camadas.reverse()) {
        fundo = { r: c.r * c.a + fundo.r * (1 - c.a), g: c.g * c.a + fundo.g * (1 - c.a), b: c.b * c.a + fundo.b * (1 - c.a) };
      }
      const texto = rgba(getComputedStyle(el).color);
      const lum = ({ r, g, b }: { r: number; g: number; b: number }) => {
        const f = (v: number) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const [a, b] = [lum(texto), lum(fundo)].sort((x, y) => y - x);
      return (a! + 0.05) / (b! + 0.05);
    });
    expect(contraste, `contraste do nome na linha selecionada: ${contraste.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);

    fs.mkdirSync(EVIDENCIA, { recursive: true });
    await page.screenshot({ path: path.join(EVIDENCIA, "02-selecionada-no-escuro.png"), animations: "disabled" });
  });
});
