/**
 * O CADASTRO E O ONBOARDING DE UM CLIENTE DO PARAGUAI, PELA TELA.
 *
 * O QA de 26/10/2026 (em produção, celular e PC) achou o caminho inteiro
 * travado para quem não é brasileiro: cadastro em espanhol e wizard em
 * português; "senha incorreta" para quem só não tinha confirmado o e-mail;
 * agente "Sem versão" para quem pulou o telefone, sem botão para voltar a ele;
 * fuso de São Paulo; funil "Carrinho abandonado"; nada dizendo, na Inbox, que
 * faltava conectar o WhatsApp.
 *
 * Esta spec percorre o caminho COMO a pessoa: navegador em `es-PY`, fuso de
 * Assunção, celular de 390×844 (e o PC onde a tela muda). O que só o banco sabe
 * (idioma/fuso/moeda gravados, o rascunho do agente) é conferido pelo cliente de
 * serviço — a tela é a prova, o banco é a régua.
 *
 * Dublês, e por quê:
 *  - Chave de IA: uma credencial VALIDADA de mentira (cifrada como o produto
 *    cifra) é semeada na empresa nova, como a que a pessoa cola no passo
 *    "Treinar". O rascunho nasce com ela; o ensaio roda sob
 *    `INTERNAL_AGENT_RUN_STUB=true` (o provedor dublado do CI). A sugestão do
 *    quadro tenta o provedor de verdade com a chave de mentira, é recusada e o
 *    passo cai no quadro pronto — que é o que se mede.
 *  - O playbook "platform": o worker o semeia no boot de toda instalação; o
 *    e2e não sobe worker, então o caso roda o MESMO seed antes do ensaio.
 *  - O número: conectar um WhatsApp de verdade exige um celular. A "conexão
 *    depois do onboarding" é uma sessão `WORKING` semeada, como
 *    `seed-e2e-numero-conectado.ts`; o que se prova é o que a TELA faz com ela.
 *  - A conexão por um clique (o caminho recomendado) precisa da chave do
 *    provedor da instalação e do dublê HTTP de `numero-oficial-um-clique`: sem
 *    `ZERNIO_PLATFORM_API_KEY` no servidor, o caso dela se declara pulado.
 */
import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";
import pg from "pg";

import { seedPlatformPlaybook } from "../../lib/agent-engine/agent/playbook-seed";
import { credenciaisSupabaseDeTeste } from "../../scripts/lib/env-de-teste";

import {
  extractAuthConfirmLink,
  seguirLinkDeAcesso,
  uniqueEmail,
  waitForEmail,
} from "./helpers/auth";
import { expect, test, type Page } from "./helpers/test";

const svc = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false },
  },
);

const EVIDENCIA = path.join(process.cwd(), "evidence", "onboarding-entendible");
const CEL = { width: 390, height: 844 };
const PC = { width: 1366, height: 768 };
const SENHA = "Asuncion!2026#Qa";
const EMPRESA = `Ferretería QA ${randomUUID().slice(0, 6)}`;
const email = uniqueEmail("onb-py");

let orgId = "";
let canalId = "";

/**
 * A credencial cifrada como `lib/crypto/aes_gcm.ts` cifra (sem importar o
 * módulo, que puxa `lib/env` para o processo do Playwright). Mexer na VERSÃO
 * para o ensaio funcionar estragaria a prova: o gatilho
 * `trg_agent_provisioning_origin` zera a procedência a cada UPDATE.
 */
function cifrarComoOProduto(texto: string): Record<string, string> {
  const chave = Buffer.from(process.env.AI_CRED_AES_KEY ?? "", "base64");
  if (chave.length !== 32)
    throw new Error("AI_CRED_AES_KEY ausente ou inválida no ambiente do e2e");
  const iv = randomBytes(12);
  const cifra = createCipheriv("aes-256-gcm", chave, iv);
  const texto_ = Buffer.concat([cifra.update(texto, "utf8"), cifra.final()]);
  const hex = (b: Buffer) => `\\x${b.toString("hex")}`;
  return {
    api_key_encrypted: hex(texto_),
    api_key_iv: hex(iv),
    api_key_tag: hex(cifra.getAuthTag()),
  };
}

async function foto(page: Page, nome: string): Promise<void> {
  fs.mkdirSync(EVIDENCIA, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCIA, `${nome}.png`), fullPage: true });
}

async function entrar(page: Page): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(SENHA);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
}

async function empresa(): Promise<Record<string, unknown>> {
  const { data, error } = await svc
    .from("organizations")
    .select("id, locale, timezone, currency, country, onboarded_at")
    .eq("display_name", EMPRESA)
    .maybeSingle();
  if (error || !data) throw new Error(`empresa não achada: ${error?.message ?? "sem linha"}`);
  return data as Record<string, unknown>;
}

test.use({ locale: "es-PY", timezoneId: "America/Asuncion" });
test.describe.configure({ mode: "serial", timeout: 180_000 });

// `E2E_MANTER_DADOS=1` deixa a empresa no banco local para inspecionar uma
// falha (o trace mostra a tela; o banco mostra por quê).
test.afterAll(async () => {
  if (!orgId || process.env.E2E_MANTER_DADOS === "1") return;
  for (const tabela of [
    "ai_agent_runs",
    "ai_agent_versions",
    "ai_agents",
    "org_memory_pointers",
    "org_memory_versions",
  ]) {
    await svc.from(tabela).delete().eq("organization_id", orgId);
  }
  await svc.from("ai_provider_credentials").delete().eq("organization_id", orgId);
  if (canalId) await svc.from("channel_sessions").delete().eq("id", canalId);
});

test.describe("um cliente do Paraguai se cadastra e monta o atendente", () => {
  test("cadastro em espanhol: confirmar o e-mail, reenviar, e o login antes de confirmar", async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize(CEL);
    await page.goto("/signup");
    await expect(page.getByRole("heading", { name: "Crear cuenta" })).toBeVisible();

    await page.locator("#org_name").fill(EMPRESA);
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(SENHA);
    await page.locator("#password_confirm").fill(SENHA);
    await page.getByRole("button", { name: "Crear cuenta" }).click();

    // A tela de "confirme su correo" ganhou a saída que faltava: reenviar, e
    // o aviso de que ele pode estar no spam.
    await expect(page.getByText("Confirme su correo")).toBeVisible({ timeout: 30_000 });
    const reenviar = page.getByTestId("reenviar-confirmacao");
    await expect(reenviar).toContainText(/spam/i);
    await expect(
      reenviar.getByRole("button", { name: "Reenviar correo de confirmación" }),
    ).toBeVisible();
    await foto(page, "01-cel-confirma-tu-correo");

    // Entrar ANTES de confirmar: a senha está certa, e a tela diz o que falta
    // (era "Correo o contraseña incorrectos").
    await page.goto("/login");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(SENHA);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: /Falta confirmar su correo/ }),
    ).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/incorrect/i)).toHaveCount(0);
    await page.getByRole("button", { name: "Reenviar correo de confirmación" }).click();
    // O provedor de e-mail tem teto próprio (uma por minuto por endereço): o que
    // se cobra é que a tela RESPONDE ao clique, com sucesso ou com o teto.
    await expect(
      page
        .getByTestId("reenviar-confirmacao")
        .getByText(/Listo: si este correo|Demasiados intentos|Muchos intentos/i),
    ).toBeVisible({ timeout: 30_000 });
    await foto(page, "02-cel-login-sin-confirmar");

    // Confirma pelo e-mail de verdade (Mailpit).
    const html = await waitForEmail(email, "Confirme", 60_000);
    await seguirLinkDeAcesso(page, extractAuthConfirmLink(html, baseURL!));
    await page.waitForURL(/\/onboarding\/welcome/, { timeout: 60_000 });

    // ⭐ O wizard abre em ESPANHOL — era o defeito número 1.
    await expect(page.getByRole("heading", { name: /Le damos la bienvenida a/ })).toBeVisible();
    // Fala com quem CRIOU A CONTA, não com quem instalou o servidor.
    await expect(page.getByTestId("boas-vindas-da-conta")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/instalaste el sistema|instaló el sistema|já instalou/i);
    // O seletor de idioma à vista, e o passo atual por extenso no celular.
    await expect(page.getByTestId("seletor-de-idioma")).toContainText("ES");
    await expect(page.getByTestId("passo-atual")).toContainText(/Paso 1 de \d · Su negocio/);
    // "Dónde atiende" já vem em Assunção (o fuso do navegador).
    await expect(page.locator("#timezone")).toContainText("Asunción");
    await foto(page, "03-cel-bienvenida");

    // A régua: a empresa nasceu em espanhol, no fuso e na moeda do Paraguai.
    const org = await empresa();
    orgId = String(org.id);
    expect(org).toMatchObject({ locale: "es", timezone: "America/Asuncion", currency: "PYG" });
    const { data: etapas } = await svc
      .from("crm_stages")
      .select("name, slug")
      .eq("organization_id", orgId);
    const nomes = (etapas ?? []).map((e) => e.name);
    expect(nomes).toEqual(
      expect.arrayContaining(["Carrito abandonado", "Esperando el pago", "Pagado"]),
    );
    expect(nomes).not.toContain("Carrinho abandonado");
    const { data: tipos } = await svc
      .from("calendar_event_types")
      .select("name")
      .eq("organization_id", orgId);
    expect((tipos ?? []).map((t) => t.name)).toContain("Reunión");
  });

  test("o telefone: pular deixa saída, e o 'já conectei' só aparece com número", async ({
    page,
  }) => {
    await page.setViewportSize(CEL);
    await entrar(page);
    await page.waitForURL(/\/onboarding\/welcome/, { timeout: 30_000 });

    await page.locator("#display_name").fill(EMPRESA);
    await page.locator("#o_que_faz").fill("Venta de herramientas y materiales de construcción.");
    await page.locator('input[type="checkbox"]').first().check();
    await page.getByRole("button", { name: "Continuar" }).click();
    await page.waitForURL(/\/onboarding\/connect-whatsapp/, { timeout: 30_000 });

    await expect(page.getByText("¿Cómo usa hoy ese número?")).toBeVisible();
    // O antigo botão verde "Conectei em outro lugar" marcava o passo sem número.
    await expect(page.getByRole("button", { name: /conecté en otro lugar|Conectei/i })).toHaveCount(
      0,
    );
    await expect(page.getByRole("button", { name: "Omitir por ahora" })).toBeVisible();
    await foto(page, "04-cel-telefono");

    // Com o oficial por um clique na instalação (rodada com a chave do provedor
    // da instalação): é a PRIMEIRA opção, sem marca, com o que ter à mão.
    if (process.env.ZERNIO_PLATFORM_API_KEY) {
      const primeira = page.locator('[data-testid^="forma-"]').first();
      await expect(primeira).toHaveAttribute("data-testid", "forma-parceiro");
      await expect(primeira).toContainText("WhatsApp Business oficial (recomendado)");
      await primeira.locator("input").click();
      await expect(page.getByTestId("antes-de-comecar")).toContainText(
        /Facebook con acceso de administrador/,
      );
      await expect(page.getByRole("button", { name: "Conectar mi WhatsApp" })).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByRole("button", { name: /usar mi clave/i })).toHaveCount(0);
      await expect(page.locator("main")).not.toContainText(/Zernio|webhook/i);
      await foto(page, "04b-cel-telefono-oficial");
      await page.setViewportSize(PC);
      await foto(page, "04c-pc-telefono-oficial");
      await page.setViewportSize(CEL);
      await page.getByTestId("voltar-para-escolha").click();
    }

    await page.setViewportSize(PC);
    await foto(page, "05-pc-telefono");
    await page.getByRole("button", { name: "Omitir por ahora" }).click();
    await page.waitForURL(/\/onboarding\/setup-ai/, { timeout: 30_000 });
  });

  test("treinar sem número: o rascunho nasce em espanhol e o ensaio funciona", async ({ page }) => {
    // A chave que a pessoa colaria aqui: validada, da organização nova, cifrada
    // como o produto cifra (AES-GCM com `AI_CRED_AES_KEY`). O texto é de mentira:
    // o ensaio roda sob o provedor dublado e nunca a manda a ninguém.
    const { data: cred, error } = await svc
      .from("ai_provider_credentials")
      .insert({
        organization_id: orgId,
        provider: "anthropic",
        label: "E2E onboarding entendível",
        ...cifrarComoOProduto("sk-ant-e2e-onboarding-entendivel"),
        api_key_last4: "dvel",
        is_active: true,
        validated_at: new Date().toISOString(),
      } as never)
      .select("id")
      .single();
    if (error || !cred) throw new Error(`credencial: ${error?.message}`);

    await page.setViewportSize(CEL);
    await entrar(page);
    await page.waitForURL(/\/onboarding\/setup-ai/, { timeout: 30_000 });
    // O nome sugerido e o título da lista, no idioma da tela.
    await expect(page.locator("#name")).toHaveValue("Asistente IA");
    await expect(page.getByText("Y siempre cumple estas reglas")).toBeVisible();
    await foto(page, "06-cel-entrenar");

    await page.locator("#name").fill("Rocío");
    await page.getByRole("button", { name: "Crear y continuar" }).click();
    await page.waitForURL(/\/onboarding\/funil/, { timeout: 60_000 });

    // ⭐ O rascunho EXISTE sem número: canal nulo, prompt e palavras em espanhol.
    const { data: versoes } = await svc
      .from("ai_agent_versions")
      .select("id, status, channel_session_id, system_prompt, handoff_keywords")
      .eq("organization_id", orgId);
    expect(versoes).toHaveLength(1);
    const v = (versoes ?? [])[0] as Record<string, unknown>;
    expect(v).toMatchObject({ status: "draft", channel_session_id: null });
    expect(String(v.system_prompt)).toMatch(/^Atiendes a los clientes de /);
    expect(String(v.system_prompt)).not.toMatch(/\.\./);
    expect(v.handoff_keywords).toEqual(expect.arrayContaining(["hablar con una persona"]));

    // O quadro pronto em espanhol (a sugestão da IA não vem: a chave é de mentira).
    await expect(
      page.getByRole("heading", { name: "Dónde organiza a sus clientes" }),
    ).toBeVisible();
    await expect(page.locator("#nome_do_quadro")).toHaveValue("Ventas");
    await expect(page.locator('input[aria-label="Nombre de la columna 1"]')).toHaveValue(
      "Nuevo contacto",
    );
    // Medido por ferramenta: o campo do nome da coluna ocupa a largura do cartão
    // no celular (o "Remover" ao lado cortava "Escolhendo o produ…").
    const largura = await page
      .locator('input[aria-label="Nombre de la columna 3"]')
      .evaluate((el) => el.getBoundingClientRect().width);
    expect(largura).toBeGreaterThan(250);
    await foto(page, "07-cel-embudo");
    await page.getByRole("button", { name: "Usar este tablero" }).click();
    await page.waitForURL(/\/onboarding\/testar/, { timeout: 60_000 });

    // ⭐ "Ver al agente atender" tem o que ensaiar.
    await expect(page.getByTestId("ensaio-do-rascunho")).toContainText(
      /todavía no está atendiendo/,
    );
    await expect(page.locator("#mensagem")).toHaveValue(
      "¡Hola! ¿Atienden hoy? Quería saber el precio.",
    );
    // A camada "platform" do playbook é semeada pelo WORKER no boot de toda
    // instalação; o e2e não sobe worker — o seed é o mesmo que ele roda.
    const pool = new pg.Pool({ connectionString: credenciaisSupabaseDeTeste().dbUrl, max: 2 });
    try {
      await seedPlatformPlaybook(pool);
    } finally {
      await pool.end();
    }
    await page.getByRole("button", { name: "Enviar mensaje" }).click();
    await expect(page.getByText(/respondió/)).toBeVisible({ timeout: 90_000 });
    await foto(page, "08-cel-ver-atender");
    await page.getByRole("button", { name: "Continuar" }).click();
    await page.waitForURL(/\/onboarding\/invite-team/, { timeout: 30_000 });
    await page.getByRole("button", { name: "Omitir por ahora" }).click();
    await page.waitForURL(/\/onboarding\/done/, { timeout: 30_000 });
  });

  test("o fim do wizard leva de volta ao telefone, e a Inbox diz o que falta", async ({ page }) => {
    await page.setViewportSize(CEL);
    await entrar(page);
    await page.waitForURL(/\/onboarding\/done/, { timeout: 30_000 });

    // ⭐ Era "(você pulou)" e mais nada.
    const falta = page.getByTestId("falta-o-numero");
    await expect(falta).toBeVisible();
    await expect(falta.getByRole("link", { name: "Conectar WhatsApp" })).toHaveAttribute(
      "href",
      /\/onboarding\/connect-whatsapp/,
    );
    await foto(page, "09-cel-listo");
    await page.setViewportSize(PC);
    await foto(page, "10-pc-listo");

    await page.getByRole("button", { name: "Empezar a usar" }).click();
    await page.waitForURL(/\/app\/inbox/, { timeout: 60_000 });

    // ⭐ A Inbox vazia diz POR QUÊ, e leva aonde resolver.
    const faixa = page.getByTestId("faixa-do-primeiro-numero");
    await expect(faixa).toContainText("Su WhatsApp todavía no está conectado");
    await expect(faixa.getByRole("link", { name: "Conectar WhatsApp" })).toHaveAttribute(
      "href",
      "/app/connections",
    );
    await foto(page, "11-pc-inbox-sin-numero");
    await page.setViewportSize(CEL);
    await foto(page, "12-cel-inbox-sin-numero");

    // Sem número e com o oficial por um clique, Conexões abre NELE (antes abria
    // na aba do QR e escondia o caminho recomendado).
    if (process.env.ZERNIO_PLATFORM_API_KEY) {
      await faixa.getByRole("link", { name: "Conectar WhatsApp" }).click();
      await page.waitForURL(/\/app\/connections/, { timeout: 30_000 });
      await expect(page.getByText("WhatsApp Business oficial (recomendado)")).toBeVisible({
        timeout: 30_000,
      });
      await foto(page, "12b-cel-conexiones-abre-en-oficial");
    }
  });

  test("o número chegou depois: a faixa oferece ativar, e o agente entra no ar", async ({
    page,
  }) => {
    const { data: canal, error } = await svc
      .from("channel_sessions")
      .insert({
        organization_id: orgId,
        waha_session_name: `e2e-onb-py-${randomUUID().slice(0, 8)}`,
        display_name: "Número de la ferretería",
        phone_number: "+595981000111",
        status: "WORKING",
        webhook_secret_encrypted: "\\x00",
      } as never)
      .select("id")
      .single();
    if (error || !canal) throw new Error(`canal: ${error?.message}`);
    canalId = (canal as { id: string }).id;

    await page.setViewportSize(CEL);
    await entrar(page);
    await page.waitForURL(/\/app\//, { timeout: 30_000 });
    await page.goto("/app/inbox");
    const faixa = page.getByTestId("faixa-do-primeiro-numero");
    await expect(faixa).toContainText("Rocío está listo, pero todavía no atiende por su número.");
    await foto(page, "13-cel-agente-listo");
    await faixa.getByRole("button", { name: "Activar ahora" }).click();
    await expect(page.getByText("Listo: su agente ya está atendiendo por su número.")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("faixa-do-primeiro-numero")).toHaveCount(0, { timeout: 30_000 });
    await foto(page, "14-cel-agente-activado");

    // A régua: o MESMO rascunho, agora com o número e publicado.
    const { data: agente } = await svc
      .from("ai_agents")
      .select("published_version_id")
      .eq("organization_id", orgId)
      .eq("is_default", true)
      .maybeSingle();
    expect(agente?.published_version_id).toBeTruthy();
    const { data: versoes } = await svc
      .from("ai_agent_versions")
      .select("id, channel_session_id, status")
      .eq("organization_id", orgId);
    expect(versoes).toHaveLength(1);
    expect((versoes ?? [])[0]).toMatchObject({ channel_session_id: canalId, status: "published" });
  });

  test("Conexões abre no oficial por um clique quando ele existe (com a chave do provedor da instalação)", async ({
    page,
  }) => {
    test.skip(
      !process.env.ZERNIO_PLATFORM_API_KEY,
      "sem a chave do provedor da instalação no servidor, a conexão por um clique não existe nesta rodada",
    );
    // A empresa deste caso já tem número (o caso anterior): a aba padrão só
    // muda para quem NÃO tem. Aqui se mede o cartão em si, pela aba.
    await page.setViewportSize(CEL);
    await entrar(page);
    await page.waitForURL(/\/app\//, { timeout: 30_000 });
    await page.goto("/app/connections?aba=parceiro");
    await expect(page.getByText("WhatsApp Business oficial (recomendado)")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("antes-de-comecar")).toContainText(
      /Facebook con acceso de administrador/,
    );
    await expect(page.getByRole("button", { name: /usar mi clave/i })).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText(/Zernio|webhook/i);
    await foto(page, "15-cel-conexiones-oficial");
  });
});
