/**
 * A CHAVE DE MAPAS, PELA TELA (Configurações › Provedores, cartão "Mapas").
 *
 * Pedido de uma loja (28/09/2026): o pino de localização chegava só com
 * coordenadas e o agente não sabia a cidade. Com a chave da Geocoding API, o
 * pino ganha rua, bairro e cidade aproximados. Esta spec dirige o que o admin
 * faz: cola a chave, grava, vê só os 4 últimos caracteres, testa, e remove —
 * e confere no banco que a chave ficou CIFRADA e que nunca voltou ao browser.
 *
 * O "Testar" chama o Google de verdade com uma chave falsa: o que se prova é
 * que a tela explica a recusa em vez de dizer "funcionou" (o caminho feliz,
 * com chave real, é provado na instalação — nenhuma chave vai para o CI).
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { expect, test } from "./helpers/test";
import { generateTotp, msUntilNextTotpWindow } from "./utils/totp";
import { admin, captura, creds, registra } from "./qa-l12-comum";

const CREDS_PATH = path.join(process.cwd(), ".e2e-creds.json");
const CHAVE = `AIzaChaveFalsaDeTesteE2E${`${Date.now()}`.slice(-6)}`;

/** O `admin` da organização de teste tem TOTP; sem ele o login para em /login/mfa. */
async function loginComTotp(page: import("@playwright/test").Page, email: string, senha: string): Promise<void> {
  const segredo = (JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as { admin_totp?: { secret: string } }).admin_totp
    ?.secret;
  if (!segredo) throw new Error("sem admin_totp em .e2e-creds.json");

  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(senha);
  await page.getByRole("button", { name: "Entrar", exact: true }).click({ timeout: 15_000 });
  await page.waitForURL(/\/login\/mfa/, { timeout: 90_000 });

  const digito1 = page.locator('input[aria-label="Dígito 1"]');
  const recusa = page.locator("form").getByRole("alert");
  for (let i = 0; i < 3; i++) {
    if (msUntilNextTotpWindow() < 3_000) await page.waitForTimeout(msUntilNextTotpWindow() + 200);
    await digito1.click({ timeout: 15_000 });
    await page.keyboard.type(generateTotp(segredo), { delay: 40 });
    const desfecho = await Promise.race([
      page.waitForURL(/\/app\//, { timeout: 60_000 }).then(() => "entrou" as const, () => "nada" as const),
      recusa.waitFor({ state: "visible", timeout: 60_000 }).then(() => "recusado" as const, () => "nada" as const),
    ]);
    if (desfecho === "entrou") return;
    registra(`[ambiente] MFA de ${email}: tentativa ${i + 1} = ${desfecho}`);
    await page.waitForTimeout(msUntilNextTotpWindow() + 200);
  }
  throw new Error(`MFA falhou para ${email} (url=${page.url()})`);
}

test.describe("Mapas em Provedores", () => {
  test.describe.configure({ timeout: 300_000 });

  test("grava a chave cifrada, mostra só os 4 últimos, explica a recusa do Google e remove", async ({ page }) => {
    const c = creds();
    await admin.from("map_provider_credentials").delete().eq("organization_id", c.org_id);

    await loginComTotp(page, c.users.admin!.email, c.password);
    await page.goto("/app/ai/providers");
    const cartao = page.getByTestId("cartao-de-mapas");
    await cartao.scrollIntoViewIfNeeded({ timeout: 60_000 });
    await expect(cartao.getByTestId("mapas-estado")).toHaveText("Sem chave", { timeout: 30_000 });
    await expect(cartao.getByTestId("mapas-testar")).toBeDisabled();

    await cartao.getByTestId("mapas-chave").fill(CHAVE);
    await captura(page, "mapas-01-chave-colada");
    await cartao.getByTestId("mapas-salvar").click();
    await expect(cartao.getByTestId("mapas-estado")).toContainText(`Chave gravada ···${CHAVE.slice(-4)}`, {
      timeout: 30_000,
    });

    // No banco: os 4 últimos e a chave CIFRADA; na tela, o campo limpo e a chave em lugar nenhum.
    const { data } = await admin
      .from("map_provider_credentials")
      .select("api_key_last4, api_key_encrypted")
      .eq("organization_id", c.org_id)
      .single();
    const linha = data as { api_key_last4: string; api_key_encrypted: string };
    expect(linha.api_key_last4).toBe(CHAVE.slice(-4));
    expect(String(linha.api_key_encrypted)).not.toContain(CHAVE);
    await expect(cartao.getByTestId("mapas-chave")).toHaveValue("");
    expect(await page.content()).not.toContain(CHAVE);

    // Testar a gravada: o Google recusa a chave falsa, e a tela explica em vez de dizer "funcionou".
    await cartao.getByTestId("mapas-testar").click();
    const resultado = cartao.getByTestId("mapas-resultado");
    await expect(resultado).toBeVisible({ timeout: 30_000 });
    await expect(resultado).not.toContainText("Funcionou");
    registra(`mapas · teste com chave falsa = ${await resultado.innerText()}`);
    await captura(page, "mapas-02-teste-explica-a-recusa");

    await cartao.getByTestId("mapas-remover").click();
    await expect(cartao.getByTestId("mapas-estado")).toHaveText("Sem chave", { timeout: 30_000 });
    const { count } = await admin
      .from("map_provider_credentials")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", c.org_id);
    expect(count).toBe(0);
  });
});
