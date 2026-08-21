import { describe, expect, it, vi } from "vitest";

import { wahaContactPayload } from "@/lib/waha/contact-card";
import {
  resolveWhatsappIdForContactCard,
  whatsappIdFromCheckResult,
} from "@/lib/waha/resolve-contact-whatsapp-id";

describe("whatsappIdFromCheckResult", () => {
  it("prefere pn sobre chatId", () => {
    expect(
      whatsappIdFromCheckResult({
        numberExists: true,
        pn: "553198966398@c.us",
        chatId: "70192801575156@lid",
      }),
    ).toBe("553198966398");
  });

  it("extrai dígitos de chatId @c.us", () => {
    expect(
      whatsappIdFromCheckResult({
        numberExists: true,
        chatId: "5531998966398@c.us",
      }),
    ).toBe("5531998966398");
  });
});

describe("resolveWhatsappIdForContactCard", () => {
  it("tenta variantes BR e usa a primeira que existir", async () => {
    const client = {
      checkContactExists: vi
        .fn()
        .mockResolvedValueOnce({ numberExists: false })
        .mockResolvedValueOnce({ numberExists: true, pn: "553198966398@c.us" }),
    };

    const id = await resolveWhatsappIdForContactCard(
      client as never,
      "sessao-1",
      "+5531998966398",
    );

    expect(id).toBe("553198966398");
    expect(client.checkContactExists).toHaveBeenCalledTimes(2);
  });

  it("retorna null quando nenhuma variante existe", async () => {
    const client = {
      checkContactExists: vi.fn().mockResolvedValue({ numberExists: false }),
    };

    const id = await resolveWhatsappIdForContactCard(
      client as never,
      "sessao-1",
      "+5531998966398",
    );

    expect(id).toBeNull();
  });
});

describe("wahaContactPayload com wa_id resolvido", () => {
  it("alinha phoneNumber e waid ao id canônico de 12 dígitos", () => {
    const p = wahaContactPayload("Maria", "+5531998966398", "553198966398");
    expect(p.whatsappId).toBe("553198966398");
    expect(p.phoneNumber).toBe("+553198966398");
    expect(p.vcard).toContain("waid=553198966398");
    expect(p.vcard).toContain("+553198966398");
  });
});
