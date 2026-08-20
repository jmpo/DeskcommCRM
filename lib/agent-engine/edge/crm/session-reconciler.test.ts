import { describe, expect, it } from "vitest";

import { deveRetomarSessao } from "./session-reconciler";

/**
 * A regra que decide se o watchdog RELIGA a sessão. Religar FAILED é o que o
 * vigia de saúde recusa (pode ser banimento); SCAN_QR_CODE e STARTING já têm
 * dono. Só STOPPED: credencial no disco, sessão parada depois de restart.
 */
describe("deveRetomarSessao", () => {
  it("retoma só STOPPED", () => {
    expect(deveRetomarSessao("STOPPED")).toBe(true);
    expect(deveRetomarSessao("stopped")).toBe(true);
  });

  it.each(["WORKING", "STARTING", "SCAN_QR_CODE", "FAILED", ""])(
    "não religa %s — ou já está no ar, ou precisa de humano",
    (status) => {
      expect(deveRetomarSessao(status)).toBe(false);
    },
  );
});
