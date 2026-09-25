/**
 * O ícone do APP INSTALADO sai do logo que a instalação subiu — e o nome, do
 * manifesto, lido em runtime.
 *
 * Medido em produção (25/09/2026): com nome e logo configurados, o iPhone
 * instalou o app com o nome padrão do produto (manifesto congelado no build) e
 * um ícone de 64 px com a inicial. Estes casos travam as duas pontas: o
 * manifesto nunca mais congela, e o ícone usa o SÍMBOLO do logo quando dá para
 * achá-lo — e o logo inteiro quando não dá, nunca a primeira letra de um nome.
 */
import fs from "node:fs";
import path from "node:path";
import { deflateSync, crc32 } from "node:zlib";
import { describe, expect, it, vi } from "vitest";

import { isPublicPath } from "@/lib/auth/public-paths";
import {
  analisarLogo,
  ehLogoDoBucket,
  encaixe,
  fundoDoIcone,
  logoDoBucketParaIcone,
  logoParaIcone,
} from "@/lib/branding/icone-do-app";
import { urlPublicaDoLogo } from "@/lib/branding/logo";
import { codificarPng, decodificarPng, type ImagemRgba } from "@/lib/branding/png";

const RAIZ = process.cwd();
const BASE = "https://proj.supabase.co";
const UUID = "296f7a18-def9-47d0-a404-066e99ac8d2d";
const ORG = "5727bccd-60cc-4a2c-8979-9378cb204904";

type Cor = [number, number, number, number];

/** Uma tela de `largura × altura` com retângulos pintados por cima do fundo. */
function tela(largura: number, altura: number, fundo: Cor, blocos: Array<[number, number, number, number, Cor]>): ImagemRgba {
  const rgba = new Uint8Array(largura * altura * 4);
  for (let i = 0; i < largura * altura; i++) rgba.set(fundo, i * 4);
  for (const [x, y, w, h, cor] of blocos) {
    for (let j = y; j < y + h; j++) for (let k = x; k < x + w; k++) rgba.set(cor, (j * largura + k) * 4);
  }
  return { largura, altura, rgba };
}

/** "Texto": letras de 16 px de largura e `alturaDaLetra` de altura, com 3 px entre elas. */
function letras(x0: number, y: number, quantas: number, alturaDaLetra: number, cor: Cor): Array<[number, number, number, number, Cor]> {
  return Array.from({ length: quantas }, (_, i) => [x0 + i * 19, y, 16, alturaDaLetra, cor] as [number, number, number, number, Cor]);
}

const PRETO: Cor = [0, 0, 0, 255];
const BRANCO: Cor = [255, 255, 255, 255];
const AZUL: Cor = [19, 62, 205, 255];
const TRANSPARENTE: Cor = [0, 0, 0, 0];

function chunk(nome: string, dados: Uint8Array): Buffer {
  const corpo = Buffer.concat([Buffer.from(nome, "ascii"), Buffer.from(dados)]);
  const tam = Buffer.alloc(4);
  tam.writeUInt32BE(dados.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo) >>> 0);
  return Buffer.concat([tam, corpo, crc]);
}

/**
 * PNG de PALETA (tipo 3, 8 bits) com filtro por linha — é a forma do logo
 * medido em produção. O codificador do módulo só escreve RGBA sem filtro;
 * este existe para o decodificador ser exercido no caso real.
 */
function pngDePaleta(indices: number[][], paleta: Cor[], filtros: number[]): Uint8Array {
  const altura = indices.length;
  const largura = indices[0]!.length;
  const linhas: number[] = [];
  let anterior = new Array<number>(largura).fill(0);
  indices.forEach((linha, y) => {
    const f = filtros[y % filtros.length]!;
    linhas.push(f);
    linha.forEach((v, x) => {
      const a = x > 0 ? linha[x - 1]! : 0;
      const b = anterior[x]!;
      const c = x > 0 ? anterior[x - 1]! : 0;
      const p = a + b - c;
      const pr = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pr;
      linhas.push((v - pred) & 0xff);
    });
    anterior = linha;
  });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8;
  ihdr[9] = 3;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("PLTE", new Uint8Array(paleta.flatMap(([r, g, b]) => [r, g, b]))),
      chunk("tRNS", new Uint8Array(paleta.map(([, , , a]) => a))),
      chunk("IDAT", deflateSync(Buffer.from(linhas))),
      chunk("IEND", new Uint8Array(0)),
    ]),
  );
}

describe("PNG sem dependência", () => {
  it("o que se escreve se lê de volta, pixel a pixel", () => {
    const img = tela(7, 5, [10, 20, 30, 255], [[2, 1, 3, 2, [200, 100, 50, 128]]]);
    const lida = decodificarPng(codificarPng(img))!;
    expect(lida.largura).toBe(7);
    expect(lida.altura).toBe(5);
    expect(Array.from(lida.rgba)).toEqual(Array.from(img.rgba));
  });

  it("lê PNG de paleta com transparência e os cinco filtros de linha", () => {
    const indices = [
      [0, 1, 2, 1, 0],
      [1, 2, 2, 2, 1],
      [2, 2, 1, 2, 2],
      [0, 0, 1, 0, 0],
      [1, 0, 2, 0, 1],
    ];
    const paleta: Cor[] = [TRANSPARENTE, AZUL, BRANCO];
    const lida = decodificarPng(pngDePaleta(indices, paleta, [0, 1, 2, 3, 4]))!;
    indices.forEach((linha, y) =>
      linha.forEach((i, x) => {
        const o = (y * 5 + x) * 4;
        expect(Array.from(lida.rgba.subarray(o, o + 4))).toEqual(paleta[i]);
      }),
    );
  });

  it("arquivo que não é PNG, ou cortado, vira null — nunca exceção", () => {
    expect(decodificarPng(new Uint8Array([1, 2, 3]))).toBeNull();
    const bom = codificarPng(tela(4, 4, PRETO, []));
    expect(decodificarPng(bom.subarray(0, bom.length - 20))).toBeNull();
  });
});

describe("onde está o símbolo do logo", () => {
  it("logo horizontal (símbolo alto + nome baixo) → recorta SÓ o símbolo", () => {
    // A forma do logo medido: 347×100, fundo preto, símbolo ~80 px à esquerda,
    // nome em letras de ~35 px à direita.
    const img = tela(347, 100, PRETO, [[34, 12, 80, 80, AZUL], ...letras(140, 33, 6, 35, BRANCO)]);
    const a = analisarLogo(img);
    expect(a.simbolo).toBe(true);
    expect(a.recorte).toEqual({ x: 34, y: 12, largura: 80, altura: 80 });
    expect(fundoDoIcone(a)).toBe("#000000");
  });

  it("só o nome → o logo inteiro; a primeira letra NUNCA vira ícone", () => {
    const img = tela(200, 60, BRANCO, letras(10, 10, 8, 40, AZUL));
    const a = analisarLogo(img);
    expect(a.simbolo).toBe(false);
    expect(a.recorte).toEqual({ x: 10, y: 10, largura: 7 * 19 + 16, altura: 40 });
  });

  it("símbolo da MESMA altura do nome → logo inteiro (não dá para ter certeza)", () => {
    const img = tela(300, 80, BRANCO, [[10, 20, 40, 40, AZUL], ...letras(70, 20, 6, 40, AZUL)]);
    expect(analisarLogo(img).simbolo).toBe(false);
  });

  it("fundo transparente: branco por trás, ou quase preto se o desenho é claro", () => {
    const escuro = analisarLogo(tela(100, 50, TRANSPARENTE, [[10, 10, 30, 30, AZUL]]));
    expect(fundoDoIcone(escuro)).toBe("#ffffff");
    const claro = analisarLogo(tela(100, 50, TRANSPARENTE, [[10, 10, 30, 30, BRANCO]]));
    expect(fundoDoIcone(claro)).toBe("#111111");
  });

  it("do arquivo ao ícone: o recorte, a cor do fundo e o selo branco", () => {
    const bytes = codificarPng(tela(347, 100, PRETO, [[34, 12, 80, 80, AZUL], ...letras(140, 33, 6, 35, BRANCO)]));
    const pronto = logoParaIcone(bytes, "image/png")!;
    expect(pronto.simbolo).toBe(true);
    expect(pronto.fundo).toBe("#000000");
    expect(pronto.src.startsWith("data:image/png;base64,")).toBe(true);
    // Margem de 4% em volta dos 80 px.
    expect(pronto.largura).toBe(86);
    const selo = decodificarPng(new Uint8Array(Buffer.from(pronto.silhueta!.src.split(",")[1]!, "base64")))!;
    // Canto = fundo → transparente; centro = símbolo → branco opaco.
    expect(Array.from(selo.rgba.subarray(0, 4))).toEqual([255, 255, 255, 0]);
    const meio = ((selo.altura >> 1) * selo.largura + (selo.largura >> 1)) * 4;
    expect(Array.from(selo.rgba.subarray(meio, meio + 4))).toEqual([255, 255, 255, 255]);
  });

  it("o encaixe mantém a proporção dentro da fração do lado", () => {
    expect(encaixe(347, 100, 180, 0.84)).toEqual({ w: 151, h: 44 });
    expect(encaixe(86, 86, 180, 0.64)).toEqual({ w: 115, h: 115 });
  });
});

describe("só o arquivo do NOSSO bucket é buscado", () => {
  const doBucket = urlPublicaDoLogo(`platform/${UUID}.png`, BASE);

  it("aceita o logo da instalação e o de uma organização", () => {
    expect(ehLogoDoBucket(doBucket, BASE)).toBe(true);
    expect(ehLogoDoBucket(urlPublicaDoLogo(`${ORG}/${UUID}.jpg`, BASE), BASE)).toBe(true);
  });

  it("recusa URL colada, outro host, caminho torto e base vazia", () => {
    expect(ehLogoDoBucket("https://evil.example/logo.png", BASE)).toBe(false);
    expect(ehLogoDoBucket(doBucket.replace("proj.supabase.co", "outro.supabase.co"), BASE)).toBe(false);
    expect(ehLogoDoBucket(urlPublicaDoLogo(`platform/../x/${UUID}.png`, BASE), BASE)).toBe(false);
    expect(ehLogoDoBucket(urlPublicaDoLogo(`platform/${UUID}.svg`, BASE), BASE)).toBe(false);
    expect(ehLogoDoBucket(doBucket, "")).toBe(false);
  });

  it("URL de fora nem chega a ser pedida; a do bucket vira ícone e fica em memória", async () => {
    const buscar = vi.fn(async () => new Response(Buffer.from(codificarPng(tela(40, 20, BRANCO, [[5, 5, 10, 10, AZUL]])))));
    expect(await logoDoBucketParaIcone("https://evil.example/logo.png", BASE, buscar as never)).toBeNull();
    expect(buscar).not.toHaveBeenCalled();

    const url = urlPublicaDoLogo(`platform/${"a".repeat(8)}-0000-4000-8000-${"b".repeat(12)}.png`, BASE);
    const pronto = await logoDoBucketParaIcone(url, BASE, buscar as never);
    expect(pronto?.src.startsWith("data:image/png")).toBe(true);
    await logoDoBucketParaIcone(url, BASE, buscar as never);
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it("arquivo que não é imagem (SVG, HTML de erro) não vira ícone", async () => {
    const url = urlPublicaDoLogo(`platform/${"c".repeat(8)}-0000-4000-8000-${"d".repeat(12)}.png`, BASE);
    const buscar = vi.fn(async () => new Response("<svg><script>alert(1)</script></svg>"));
    expect(await logoDoBucketParaIcone(url, BASE, buscar as never)).toBeNull();
  });
});

describe("o celular vê a marca da instalação", () => {
  it("o manifesto é lido em runtime — nunca congelado no build", () => {
    const manifesto = fs.readFileSync(path.join(RAIZ, "app/manifest.ts"), "utf8");
    expect(manifesto).toMatch(/export const dynamic\s*=\s*"force-dynamic"/);
    expect(manifesto).toMatch(/marcaDaSaida\(null\)/);
    expect(manifesto).toContain('"/icone/192"');
    expect(manifesto).toContain('"/icone/512"');
  });

  it("os ícones do app são gerados em runtime e alcançáveis sem sessão", () => {
    const rota = fs.readFileSync(path.join(RAIZ, "app/icone/[lado]/route.tsx"), "utf8");
    expect(rota).toMatch(/export const dynamic\s*=\s*"force-dynamic"/);
    for (const lado of ["180", "192", "512", "selo"]) {
      expect(rota).toContain(`"${lado}"`);
      expect(isPublicPath(`/icone/${lado}`)).toBe(true);
    }
    expect(isPublicPath("/icone/999")).toBe(false);
    expect(isPublicPath("/icone/180/../../app")).toBe(false);
  });

  it("o iPhone recebe ícone de tela inicial e o nome da marca", () => {
    const layout = fs.readFileSync(path.join(RAIZ, "app/layout.tsx"), "utf8");
    expect(layout).toMatch(/apple:\s*"\/icone\/180"/);
    expect(layout).toMatch(/appleWebApp:\s*\{\s*title:\s*name\s*\}/);
  });
});
