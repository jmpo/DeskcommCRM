import { describe, expect, it } from "vitest";

import { contaDoEventoZernio, inboundPayloadBelongsToSession } from "@/lib/channels/inbound";

/**
 * O WEBHOOK DO PROVEDOR É POR ESPAÇO DE TRABALHO, NÃO POR NÚMERO.
 *
 * Medido em produção (23/09/2026): um espaço com DEZ contas — dois WhatsApp e
 * Facebook/Instagram/Meta Ads de três negócios. A caixa do número "Mia Costa"
 * recebeu mensagens enviadas por OUTRO número do mesmo espaço. A guarda de
 * conta existia só para o canal social; para o WhatsApp devolvia `true` sem olhar.
 *
 * A guarda busca a conta da sessão ELA MESMA (como a social). A primeira versão
 * a lia de um campo que a rota deveria trazer e não trazia — ficava verde sem
 * filtrar nada. Buscar na própria guarda fecha essa porta por construção.
 */
const MIA = "6ab336888d284ffb2131bdf3";
const OUTRA = "6a3572a15f7d1751ab117832";

/** Banco dublado: devolve a conta que a sessão tem. */
function banco(contaDaSessao: string | null) {
  const cadeia: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) cadeia[m] = () => cadeia;
  cadeia.maybeSingle = async () => ({ data: { zernio_account_id: contaDaSessao }, error: null });
  return { from: () => cadeia } as never;
}
const entrada = (corpo: Record<string, unknown>) =>
  ({
    session: { id: "s1", organization_id: "o1", provider: "zernio" },
    rawBody: JSON.stringify(corpo),
    headers: new Headers(),
    secret: "x",
  }) as never;

describe("o WhatsApp do provedor só aceita evento da SUA conta", () => {
  it("evento de OUTRA conta do mesmo espaço é recusado — o caso medido", async () => {
    expect(await inboundPayloadBelongsToSession(banco(MIA), entrada({ event: "message.sent", account: { id: OUTRA } }))).toBe(false);
  });

  it("evento da própria conta passa — nos três lugares onde o provedor põe a conta", async () => {
    for (const corpo of [{ account: { id: MIA } }, { account: { accountId: MIA } }, { accountId: MIA }]) {
      expect(await inboundPayloadBelongsToSession(banco(MIA), entrada(corpo)), JSON.stringify(corpo)).toBe(true);
    }
  });

  it("evento SEM conta passa — recusá-lo cegaria o vigia para `account.disconnected`", async () => {
    expect(await inboundPayloadBelongsToSession(banco(MIA), entrada({ event: "account.disconnected" }))).toBe(true);
  });

  it("sessão ainda sem conta configurada não tem com o que comparar — passa", async () => {
    expect(await inboundPayloadBelongsToSession(banco(null), entrada({ account: { id: OUTRA } }))).toBe(true);
  });

  it("corpo que não é JSON não derruba a guarda", () => {
    expect(contaDoEventoZernio("isto não é json")).toBeNull();
  });
});
