import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Achados da revisão adversarial do #1502.
const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("fotos do catálogo", () => {
  it("o send_message só manda as fotos que cabem no teto de mensagens do turno", () => {
    const turno = ler("lib/agent-engine/agent/inbound-turn.ts");
    const chamada = turno.slice(0, turno.indexOf("return enviarComFotos("));
    const recorte = chamada.slice(chamada.lastIndexOf("send: (finalBody"));
    expect(recorte).toMatch(/fotosDoProduto\.slice\(0,\s*Math\.max\(0,\s*maxSendsPerTurn\s*-\s*seq\)\)/);
    expect(turno).toMatch(/return enviarComFotos\(finalBody,\s*fotosNoTeto,/);
  });

  it("a rota de upload recusa pelo Content-Length antes de ler o corpo", () => {
    const rota = ler("app/api/v1/products/[id]/fotos/route.ts");
    const precheck = rota.indexOf('req.headers.get("content-length")');
    const leitura = rota.indexOf("req.formData()");
    expect(precheck).toBeGreaterThan(-1);
    expect(precheck).toBeLessThan(leitura);
  });
});
