/**
 * Ler e escrever PNG sem dependência nova — só `node:zlib`.
 *
 * ─── Por que existe ─────────────────────────────────────────────────────────
 *
 * O ícone do app instalado no celular (`app/icone/[lado]/route.tsx`) precisa
 * OLHAR o logo: descobrir a cor do fundo e onde está o símbolo. O `sharp` não
 * está no runtime do contêiner de propósito (`next.config.ts`), e o satori que
 * desenha o ícone só compõe imagem, não devolve pixel. Um logo é pequeno (o
 * bucket recusa acima de 512 KB, `TAMANHO_MAXIMO_DO_LOGO`), então decodificar
 * aqui custa pouco.
 *
 * ─── O que NÃO cobre, e devolve `null` ──────────────────────────────────────
 *
 * PNG entrelaçado (Adam7) e qualquer coisa fora da especificação. Quem chama
 * trata `null` como "não sei olhar este arquivo" e desenha o logo inteiro, sem
 * recorte — o ícone fica menos bonito, nunca quebrado.
 *
 * ─── NUNCA LANÇA ────────────────────────────────────────────────────────────
 *
 * Os bytes vêm de um arquivo que alguém subiu. Cabeçalho mentiroso, chunk
 * cortado ou zlib corrompido viram `null`, e o limite de pixels segura a bomba
 * de descompressão antes do `inflate`.
 */
import { crc32, deflateSync, inflateSync } from "node:zlib";

export type ImagemRgba = {
  readonly largura: number;
  readonly altura: number;
  /** 4 bytes por pixel, linha a linha, alfa NÃO pré-multiplicado. */
  readonly rgba: Uint8Array;
};

const ASSINATURA = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** 4 megapixels: um logo de verdade tem uma fração disso. */
const MAXIMO_DE_PIXELS = 4_000_000;

const CANAIS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function u32(b: Uint8Array, i: number): number {
  return ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function decodificarPng(bytes: Uint8Array): ImagemRgba | null {
  try {
    return decodificar(bytes);
  } catch {
    return null;
  }
}

function decodificar(bytes: Uint8Array): ImagemRgba | null {
  if (bytes.length < 33 || !ASSINATURA.every((b, i) => bytes[i] === b)) return null;

  let largura = 0;
  let altura = 0;
  let profundidade = 0;
  let tipo = -1;
  let paleta: Uint8Array | null = null;
  let transparencia: Uint8Array | null = null;
  const blocos: Uint8Array[] = [];

  let i = 8;
  while (i + 8 <= bytes.length) {
    const tamanho = u32(bytes, i);
    const nome = String.fromCharCode(bytes[i + 4]!, bytes[i + 5]!, bytes[i + 6]!, bytes[i + 7]!);
    const inicio = i + 8;
    const fim = inicio + tamanho;
    if (fim + 4 > bytes.length) return null;
    const dados = bytes.subarray(inicio, fim);
    if (nome === "IHDR") {
      largura = u32(dados, 0);
      altura = u32(dados, 4);
      profundidade = dados[8]!;
      tipo = dados[9]!;
      // Entrelaçado: fora do escopo (ver o cabeçalho).
      if (dados[12] !== 0) return null;
    } else if (nome === "PLTE") {
      paleta = dados;
    } else if (nome === "tRNS") {
      transparencia = dados;
    } else if (nome === "IDAT") {
      blocos.push(dados);
    } else if (nome === "IEND") {
      break;
    }
    i = fim + 4;
  }

  const canais = CANAIS[tipo];
  if (!canais || largura <= 0 || altura <= 0) return null;
  if (largura * altura > MAXIMO_DE_PIXELS) return null;
  if (![1, 2, 4, 8, 16].includes(profundidade)) return null;
  if (tipo === 3 && (!paleta || profundidade === 16)) return null;

  const bitsPorPixel = canais * profundidade;
  const passo = Math.ceil((largura * bitsPorPixel) / 8);
  const bpp = Math.max(1, bitsPorPixel >> 3);
  const esperado = (passo + 1) * altura;

  const cru = inflateSync(Buffer.concat(blocos), { maxOutputLength: esperado + 1024 });
  if (cru.length < esperado) return null;

  // Desfaz o filtro de cada linha (PNG §9), no próprio buffer.
  const linhas = new Uint8Array(passo * altura);
  for (let y = 0; y < altura; y++) {
    const filtro = cru[y * (passo + 1)]!;
    const origem = y * (passo + 1) + 1;
    const destino = y * passo;
    for (let x = 0; x < passo; x++) {
      const bruto = cru[origem + x]!;
      const a = x >= bpp ? linhas[destino + x - bpp]! : 0;
      const b = y > 0 ? linhas[destino - passo + x]! : 0;
      const c = x >= bpp && y > 0 ? linhas[destino - passo + x - bpp]! : 0;
      let v: number;
      if (filtro === 0) v = bruto;
      else if (filtro === 1) v = bruto + a;
      else if (filtro === 2) v = bruto + b;
      else if (filtro === 3) v = bruto + ((a + b) >> 1);
      else if (filtro === 4) v = bruto + paeth(a, b, c);
      else return null;
      linhas[destino + x] = v & 0xff;
    }
  }

  const maximo = (1 << profundidade) - 1;
  const amostra = (linha: number, indice: number): number => {
    const base = linha * passo;
    if (profundidade === 8) return linhas[base + indice]!;
    if (profundidade === 16) return (linhas[base + indice * 2]! << 8) | linhas[base + indice * 2 + 1]!;
    const bit = indice * profundidade;
    return (linhas[base + (bit >> 3)]! >> (8 - profundidade - (bit & 7))) & maximo;
  };
  const oitoBits = (v: number): number =>
    profundidade === 16 ? v >> 8 : profundidade === 8 ? v : Math.round((v * 255) / maximo);
  const chave16 = (dados: Uint8Array | null, deslocamento: number): number | null =>
    dados && dados.length >= deslocamento + 2 ? (dados[deslocamento]! << 8) | dados[deslocamento + 1]! : null;

  const rgba = new Uint8Array(largura * altura * 4);
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      const o = (y * largura + x) * 4;
      if (tipo === 3) {
        const indice = amostra(y, x);
        rgba[o] = paleta![indice * 3] ?? 0;
        rgba[o + 1] = paleta![indice * 3 + 1] ?? 0;
        rgba[o + 2] = paleta![indice * 3 + 2] ?? 0;
        rgba[o + 3] = transparencia && indice < transparencia.length ? transparencia[indice]! : 255;
      } else if (tipo === 0 || tipo === 4) {
        const cinza = amostra(y, x * canais);
        const g = oitoBits(cinza);
        rgba[o] = g;
        rgba[o + 1] = g;
        rgba[o + 2] = g;
        rgba[o + 3] =
          tipo === 4 ? oitoBits(amostra(y, x * canais + 1)) : cinza === chave16(transparencia, 0) ? 0 : 255;
      } else {
        const r = amostra(y, x * canais);
        const g = amostra(y, x * canais + 1);
        const b = amostra(y, x * canais + 2);
        rgba[o] = oitoBits(r);
        rgba[o + 1] = oitoBits(g);
        rgba[o + 2] = oitoBits(b);
        if (tipo === 6) {
          rgba[o + 3] = oitoBits(amostra(y, x * canais + 3));
        } else {
          const transparente =
            r === chave16(transparencia, 0) && g === chave16(transparencia, 2) && b === chave16(transparencia, 4);
          rgba[o + 3] = transparente ? 0 : 255;
        }
      }
    }
  }
  return { largura, altura, rgba };
}

function chunk(nome: string, dados: Uint8Array): Buffer {
  const cabeca = Buffer.alloc(8);
  cabeca.writeUInt32BE(dados.length, 0);
  cabeca.write(nome, 4, "ascii");
  const corpo = Buffer.concat([cabeca.subarray(4), Buffer.from(dados)]);
  const cauda = Buffer.alloc(4);
  cauda.writeUInt32BE(crc32(corpo) >>> 0, 0);
  return Buffer.concat([cabeca.subarray(0, 4), corpo, cauda]);
}

/** RGBA 8 bits, sem filtro por linha: arquivo maior, código mínimo. */
export function codificarPng(imagem: ImagemRgba): Uint8Array {
  const { largura, altura, rgba } = imagem;
  const cru = Buffer.alloc((largura * 4 + 1) * altura);
  for (let y = 0; y < altura; y++) {
    cru[y * (largura * 4 + 1)] = 0;
    cru.set(rgba.subarray(y * largura * 4, (y + 1) * largura * 4), y * (largura * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from(ASSINATURA),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(cru)),
      chunk("IEND", new Uint8Array(0)),
    ]),
  );
}

/** Um pedaço retangular da imagem. Quem chama garante que cabe. */
export function recortar(imagem: ImagemRgba, x: number, y: number, largura: number, altura: number): ImagemRgba {
  const rgba = new Uint8Array(largura * altura * 4);
  for (let linha = 0; linha < altura; linha++) {
    const de = ((y + linha) * imagem.largura + x) * 4;
    rgba.set(imagem.rgba.subarray(de, de + largura * 4), linha * largura * 4);
  }
  return { largura, altura, rgba };
}
