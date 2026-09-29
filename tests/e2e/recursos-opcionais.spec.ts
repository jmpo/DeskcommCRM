/**
 * A ÁREA "RECURSOS OPCIONAIS", PELA TELA (pedido do mantenedor, doc 73; desenho no doc 80).
 *
 * O pedido era de achabilidade: "não entendi onde ficam os lugares para
 * ativar/desativar". Então esta spec prova o CAMINHO, não só a tela:
 *
 *   1. o admin da empresa chega pelo hub de Configurações (sem digitar URL),
 *      vê a lista e o "Ajustar" de uma chave o leva à tela onde ela mora;
 *   2. o dono do servidor vê a porta "Recursos opcionais" no menu do Admin, e a
 *      tela tem os três blocos, com o que depende do servidor só em leitura.
 *
 * O que ela NÃO prova: que cada leitura de estado bate com a tela do recurso —
 * isso é regra pura, coberta em `tests/unit/recursos-opcionais-catalogo.test.ts`.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { expect, test } from "./helpers/test";

import { lerCreds, loginComoAdmin, loginComoDono } from "./helpers/login-admin";
import { afirmarDonoDoServidor } from "./utils/precondicao";

const EVIDENCIA = path.join(process.cwd(), "evidence", "recursos-opcionais");
function evidencia(nome: string): string {
  fs.mkdirSync(EVIDENCIA, { recursive: true });
  return path.join(EVIDENCIA, nome);
}

test.describe.configure({ timeout: 120_000 });

test("admin da empresa acha os recursos opcionais e o Ajustar leva à tela certa", async ({ page }) => {
  await loginComoAdmin(page, lerCreds());

  // Pela porta, como o usuário: o hub de Configurações.
  await page.goto("/app/settings");
  await page.getByRole("link", { name: /Recursos opcionais/ }).first().click();
  await expect(page).toHaveURL(/\/app\/settings\/recursos$/);

  await expect(page.getByRole("heading", { level: 1, name: "Recursos opcionais" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Módulos desta instalação" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Da sua empresa" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Em cada agente" })).toBeVisible();

  const linha = page.locator('[data-recurso="conversa_fica_com_quem_atendeu"]');
  await expect(linha).toContainText("A conversa fica com quem atendeu");
  // O estado vem lido, não um placeholder: é um dos dois rótulos de chave da empresa.
  await expect(linha).toContainText(/Ligado|Desligado/);
  await page.screenshot({ path: evidencia("empresa.png"), fullPage: true });

  await linha.getByRole("link", { name: /Ajustar/ }).click();
  await expect(page).toHaveURL(/\/app\/settings\/atendimento$/);
  await expect(page.getByRole("heading", { level: 1, name: "Distribuição de atendimento" })).toBeVisible();
});

test("dono do servidor vê a porta Recursos opcionais e os três blocos no Admin", async ({ page }) => {
  // O `e2e-dono` só é platform admin se um seed anterior o promoveu; sem esta
  // afirmação a spec mediria a ordem de execução em vez do produto.
  await afirmarDonoDoServidor(lerCreds().users.dono!.email);
  await loginComoDono(page, lerCreds());

  await page.goto("/admin");
  await page.getByRole("link", { name: "Recursos opcionais" }).first().click();
  await expect(page).toHaveURL(/\/admin\/sistema$/);

  await expect(page.getByRole("heading", { level: 1, name: "Recursos opcionais" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Módulos", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Comportamento", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Depende do servidor" })).toBeVisible();

  // Só leitura, com estado detectado — e nada que se pareça com valor de segredo.
  const email = page.locator('[data-recurso="email"]');
  await expect(email).toContainText(/Configurado|Não configurado/);
  await expect(page.locator('[data-recurso="graph_parceiro"]')).toBeVisible();
  await page.screenshot({ path: evidencia("admin.png"), fullPage: true });
});
