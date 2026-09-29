/**
 * TODA TELA DO ADMINISTRADOR DA INSTALAÇÃO TEM PORTA NO MENU DELE.
 *
 * `navegacao-completude.test.ts` cobre só `app/app/**` (a navegação do tenant); o
 * menu do administrador é a lista `NAV_ITEMS` de `components/admin/AdminSidebar.tsx`,
 * e nada o vigiava. Foi assim que `/admin/modulos` nasceu sem porta no PR #1578: as
 * rotas de honorários mandavam o operador instalar o módulo "em Módulos", e só se
 * chegava lá digitando a URL.
 *
 * O recorte é o primeiro nível de `app/admin/(protected)/`: é ali que mora cada
 * tela do menu. Subpáginas (`tenants/new`, `audit/[entryId]`) são alcançadas de
 * dentro da tela-mãe, não do menu.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = join(process.cwd(), "app", "admin", "(protected)");
const MENU = readFileSync(join(process.cwd(), "components", "admin", "AdminSidebar.tsx"), "utf8");

function telasDoPrimeiroNivel(): string[] {
  return readdirSync(RAIZ, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("[") && !d.name.startsWith("("))
    .filter((d) => existsSync(join(RAIZ, d.name, "page.tsx")))
    .map((d) => `/admin/${d.name}`)
    .sort();
}

describe("menu do administrador da instalação", () => {
  it("o instrumento enxerga as telas (controle: /admin/dashboard existe e tem porta)", () => {
    expect(telasDoPrimeiroNivel()).toContain("/admin/dashboard");
    expect(MENU).toContain('href: "/admin/dashboard"');
  });

  it("toda tela de primeiro nível tem uma entrada no menu", () => {
    const semPorta = telasDoPrimeiroNivel().filter((href) => !MENU.includes(`href: "${href}"`));
    expect(
      semPorta,
      "tela do administrador sem porta no menu: acrescente-a a NAV_ITEMS em components/admin/AdminSidebar.tsx",
    ).toEqual([]);
  });
});
