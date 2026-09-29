/**
 * HONORÁRIOS PELA TELA: O DONO INSTALA O MÓDULO E O ESCRITÓRIO REGISTRA UM PAGAMENTO.
 *
 * O módulo de honorários (#1578, de @nsbastosconsultoria) é o primeiro no formato da
 * ADR-0002: as tabelas só nascem quando o administrador da instalação instala. A
 * condição do dono do produto para ele entrar (docs de decisão 61 e 66) é o teste
 * prático numa instalação nova — e o banco deste e2e é o `baseline.sql` aplicado do
 * zero, sem o módulo.
 *
 * O caminho, como um leigo faria:
 *   1. o dono do servidor acha "Módulos" no menu do painel e instala Honorários;
 *   2. a porta aparece em Análise e leva à tela;
 *   3. cria uma conta no caixa, um contrato de valor fixo e uma parcela;
 *   4. clica DUAS VEZES em "Pagar" — o clique duplo que pagava em dobro;
 *   5. o caixa tem UM lançamento daquela parcela, na conta escolhida.
 *
 * ⚠️ Instalar é da INSTALAÇÃO e não se desfaz: as specs que rodam depois desta,
 * na mesma parte, veem o menu com a porta nova. A ordem de execução não segue a
 * lista do workflow; na primeira rodada verde (job 108983924934) ela foi a 39ª
 * de 77 e a parte inteira passou.
 */
import { expect, test } from "./helpers/test";

import { lerCreds, loginComoDono } from "./helpers/login-admin";
import { afirmarDonoDoServidor } from "./utils/precondicao";

test.describe("Honorários: instalar e registrar um pagamento", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
  });

  test("do menu do painel ao lançamento no caixa, sem pagar em dobro", async ({ page }) => {
    test.setTimeout(180_000);
    await loginComoDono(page, lerCreds());

    // 1. A porta no menu do painel da instalação, e o botão Instalar.
    await page.goto("/admin/dashboard");
    const porta = page.locator('a[href="/admin/modulos"]').first();
    await expect(porta, "o menu do painel não oferece porta para os módulos").toBeVisible();
    await porta.click();
    await expect(page).toHaveURL(/\/admin\/modulos/);

    const cartao = page.getByTestId("modulo-honorarios");
    await expect(cartao).toBeVisible();
    const instalar = page.getByTestId("instalar-honorarios");
    if (await instalar.isVisible()) await instalar.click();
    await expect(cartao.getByText(/instalado/i), "o módulo não ficou instalado").toBeVisible({
      timeout: 30_000,
    });

    // 2. A porta da tela do módulo aparece na área de Análise da empresa.
    await page.goto("/app/analise");
    const portaDaTela = page.locator('a[href="/app/honorarios"]').first();
    await expect(portaDaTela, "instalado, o módulo não ganhou porta em Análise").toBeVisible();
    await portaDaTela.click();
    await expect(page).toHaveURL(/\/app\/honorarios/);

    // 3a. Uma conta no caixa, pela tela do financeiro.
    const nomeDaConta = `Conta honorários e2e ${Date.now()}`;
    await page.goto("/app/settings/tenant/financeiro");
    await page.getByLabel(/nome da conta/i).fill(nomeDaConta);
    await page.getByRole("button", { name: /adicionar conta/i }).click();
    await expect(page.getByText(nomeDaConta).first()).toBeVisible();

    // 3b. Contrato de valor fixo e uma parcela.
    await page.goto("/app/honorarios");
    await page.getByTestId("contrato-modelo").selectOption("fixo");
    await page.getByTestId("contrato-valor-fixo").fill("3000");
    await page.getByTestId("criar-contrato").click();
    await expect(page.locator('tr[data-testid^="contrato-"]').first()).toBeVisible();

    await page.getByTestId("parcela-vencimento").fill("2026-12-10");
    await page.getByTestId("parcela-valor").fill("1234,56");
    await page.getByTestId("criar-parcela").click();
    const linha = page.locator('tr[data-testid^="parcela-"]').first();
    await expect(linha).toContainText(/pendente/i);

    // 4. O clique duplo.
    await page.getByTestId("parcela-conta").selectOption({ label: nomeDaConta });
    await linha.locator('[data-testid^="pagar-parcela-"]').dblclick();
    await expect(linha, "a parcela não ficou paga").toContainText(/pago/i, { timeout: 15_000 });

    // 5. Um lançamento só, na conta escolhida, com o valor da parcela.
    const contas = (await (await page.request.get("/api/v1/financeiro/catalogo/contas")).json()) as {
      data: Array<{ id: string; name: string }>;
    };
    const conta = contas.data.find((c) => c.name === nomeDaConta);
    expect(conta, "a conta criada pela tela não voltou da API").toBeDefined();

    const resposta = await page.request.get("/api/v1/financeiro/lancamentos");
    expect(resposta.ok()).toBe(true);
    const { data: lancamentos } = (await resposta.json()) as {
      data: Array<{ account_id: string; amount_cents: number; direction: string }>;
    };
    const daConta = lancamentos.filter((l) => l.account_id === conta!.id);
    expect(daConta, "o clique duplo lançou a parcela mais de uma vez (ou nenhuma)").toHaveLength(1);
    expect(daConta[0]).toMatchObject({ amount_cents: 123456, direction: "in" });
  });
});
