import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { contaDoEventoZernio, inboundPayloadBelongsToSession } from "@/lib/channels/inbound";

/**
 * O WEBHOOK DO PROVEDOR É POR ESPAÇO DE TRABALHO, NÃO POR NÚMERO.
 *
 * Medido em produção (23/09/2026): um espaço com DEZ contas — dois WhatsApp e
 * Facebook/Instagram/Meta Ads de três negócios. A caixa do número "Mia Costa"
 * recebeu 33 boas-vindas de OUTRO negócio ("Hola José! Tu cuenta de
 * Automotor…"), enviadas por outro número do mesmo espaço. A guarda de conta
 * existia só para o canal social; para o WhatsApp devolvia `true` sem olhar.
 */
const MIA = "6ab336888d284ffb2131bdf3";
const OUTRA = "6a3572a15f7d1751ab117832";
const admin = {} as never;

function sessao(conta: string | null) {
  return { id: "s1", organization_id: "o1", provider: "zernio", zernio_account_id: conta };
}
const evento = (corpo: Record<string, unknown>) =>
  ({ session: sessao(MIA), rawBody: JSON.stringify(corpo), headers: new Headers(), secret: "x" }) as never;

describe("o WhatsApp do provedor só aceita evento da SUA conta", () => {
  it("evento de OUTRA conta do mesmo espaço é recusado — o caso medido", async () => {
    const ok = await inboundPayloadBelongsToSession(admin, evento({ event: "message.sent", account: { id: OUTRA } }));
    expect(ok).toBe(false);
  });

  it("evento da própria conta passa — nos três lugares onde o provedor põe a conta", async () => {
    for (const corpo of [{ account: { id: MIA } }, { account: { accountId: MIA } }, { accountId: MIA }]) {
      expect(await inboundPayloadBelongsToSession(admin, evento(corpo)), JSON.stringify(corpo)).toBe(true);
    }
  });

  it("evento SEM conta passa — recusá-lo cegaria o vigia para `account.disconnected`", async () => {
    expect(await inboundPayloadBelongsToSession(admin, evento({ event: "account.disconnected" }))).toBe(true);
  });

  it("corpo que não é JSON não derruba a guarda", () => {
    expect(contaDoEventoZernio("isto não é json")).toBeNull();
  });

  /**
   * ⚠️ O CASO QUE PEGA A GUARDA DE ENFEITE.
   *
   * A primeira versão desta guarda lia `session.zernio_account_id` — e a rota
   * NÃO selecionava essa coluna. Sem a conta na sessão a guarda devolve `true`
   * (conexão sem conta configurada não tem com o que comparar), então ela
   * ficava verde e não filtrava NADA. Os casos acima passavam, porque montam a
   * sessão à mão. Este lê a rota.
   */
  it("a rota do webhook traz a conta da sessão — senão a guarda não guarda nada", () => {
    const rota = readFileSync("app/api/v1/webhooks/channel/[token]/route.ts", "utf8");
    const selects = [...rota.matchAll(/\.select\(\s*[`"]([^`"]+)[`"]/g)].map((m) => m[1]!);
    const daSessao = selects.filter((s) => s.includes("webhook_secret_encrypted"));
    expect(daSessao.length, "não achei o SELECT da sessão na rota").toBeGreaterThan(0);
    for (const s of daSessao) expect(s, "o SELECT da sessão não traz zernio_account_id").toContain("zernio_account_id");
  });
});
