// @vitest-environment node
//
// LIGAR A ATUALIZAÇÃO DE CARD EXIGE ASSINATURA NA FONTE (#2316).
//
// "Atualizar card é integração entre sistemas, e o formulário HTML público não
// precisa disso" — a régua é a MESMA da autorização de IA, e por isso as duas
// moram numa pergunta só (`opcaoSemAssinatura`). O que ela decide, e que a rota
// do PATCH traduz em recusa `signature_required` (422):
//
//   - ligar a opção sem assinatura configurada → recusa, dizendo QUAL opção;
//   - definir a assinatura no MESMO patch → passa (o segredo entra junto);
//   - DESLIGAR qualquer uma das duas → passa sempre (a tela promete "desligue
//     primeiro", e uma recusa aqui deixaria a pessoa presa).

import { describe, expect, it } from "vitest";

import {
  assinaturaObrigatoriaAusente,
  opcaoSemAssinatura,
} from "@/lib/webhooks/assinatura-autorizacao";

const SEM_SEGREDO = { authorize_ai_on_capture: false, secret_encrypted: null };
const COM_SEGREDO = { authorize_ai_on_capture: false, secret_encrypted: "cifrado" };
const CIFRADO = "cifrado";

describe("a opção de atualizar o card pela integração exige assinatura (#2316)", () => {
  it("⭐ ligar sem assinatura na fonte: recusa apontando a opção certa", () => {
    expect(
      opcaoSemAssinatura(SEM_SEGREDO, { update_existing_lead_on_capture: true }),
    ).toBe("update_lead");
  });

  it("fonte que já tem assinatura: liga sem pedir nada", () => {
    expect(
      opcaoSemAssinatura(COM_SEGREDO, { update_existing_lead_on_capture: true }),
    ).toBeNull();
  });

  it("assinatura definida no MESMO patch: liga junto", () => {
    expect(
      opcaoSemAssinatura(SEM_SEGREDO, {
        update_existing_lead_on_capture: true,
        secret: CIFRADO,
      }),
    ).toBeNull();
  });

  it("remover a assinatura com a opção LIGADA: recusa — desligue primeiro", () => {
    expect(
      opcaoSemAssinatura(
        { authorize_ai_on_capture: false, secret_encrypted: CIFRADO },
        { update_existing_lead_on_capture: true, secret: null },
      ),
    ).toBe("update_lead");
  });

  it("DESLIGAR a opção nunca pede assinatura", () => {
    expect(
      opcaoSemAssinatura(COM_SEGREDO, { update_existing_lead_on_capture: false }),
    ).toBeNull();
    expect(opcaoSemAssinatura(SEM_SEGREDO, { update_existing_lead_on_capture: false })).toBeNull();
  });
});

describe("a régua da autorização de IA continua a mesma", () => {
  it("ligar IA sem assinatura: recusa apontando a IA", () => {
    expect(opcaoSemAssinatura(SEM_SEGREDO, { authorize_ai_on_capture: true })).toBe("ai");
  });

  it("as duas ligadas de uma vez sem assinatura: a IA é a primeira resposta", () => {
    expect(
      opcaoSemAssinatura(SEM_SEGREDO, {
        authorize_ai_on_capture: true,
        update_existing_lead_on_capture: true,
      }),
    ).toBe("ai");
  });

  it("o booleano histórico continua respondendo o mesmo", () => {
    expect(assinaturaObrigatoriaAusente(SEM_SEGREDO, { authorize_ai_on_capture: true })).toBe(true);
    expect(
      assinaturaObrigatoriaAusente(SEM_SEGREDO, { update_existing_lead_on_capture: true }),
    ).toBe(true);
    expect(assinaturaObrigatoriaAusente(COM_SEGREDO, { authorize_ai_on_capture: true })).toBe(false);
    // Um patch que não toca em nenhuma das duas opções (definir a assinatura,
    // renomear, desativar) nunca recusa.
    expect(assinaturaObrigatoriaAusente(SEM_SEGREDO, { secret: CIFRADO })).toBe(false);
  });
});
