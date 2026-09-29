/**
 * O ÍCONE DO APP INSTALADO — a tela inicial do celular, o ícone da notificação
 * e o selo da barra de status — tirado do LOGO que a instalação subiu.
 *
 * ─── O defeito, medido em produção (25/09/2026) ─────────────────────────────
 *
 * Instalação com nome e logo configurados em `/admin/marca`. No iPhone, o app
 * instalado se chamava "DeskcommCRM" e as notificações chegavam com esse nome:
 * o manifesto era congelado no `next build` (ver `app/manifest.ts`). O ícone,
 * um ladrilho de 64 px com a inicial — o iOS pede 180 px e o Android 192/512,
 * e nenhum dos dois usava o logo que o operador tinha subido.
 *
 * ─── Por que RECORTAR o símbolo ─────────────────────────────────────────────
 *
 * Logo de marca costuma ser horizontal: símbolo à esquerda, nome à direita
 * (o medido era 347×100). Encaixado inteiro num quadrado, o nome vira uma faixa
 * de 40 px ilegível. Ícone de app é o SÍMBOLO — e quando o logo tem um símbolo
 * separado do nome e mais alto que ele, dá para achá-lo pelos pixels. Quando a
 * forma não é essa (só o nome, símbolo da mesma altura do texto, logo
 * empilhado), vale o logo inteiro: menos bonito, nunca errado.
 *
 * ─── Só o arquivo do NOSSO bucket ───────────────────────────────────────────
 *
 * `app/icon.tsx` explica por que não busca `logo_url`: é texto livre, e buscá-lo
 * a cada requisição seria SSRF com gatilho. Aqui a regra é a mesma, com uma
 * saída: o logo SUBIDO mora no bucket público `brand-logos`, num caminho de
 * forma fixa (`<escopo>/<uuid>.<png|jpg>`), sob a URL do Supabase que vem do
 * ambiente. Só esse endereço é buscado; URL colada nunca.
 */
import { logger } from "@/lib/logger";

import { farejarTipo, type TipoDeLogo } from "./logo-arquivo";
import {
  baseDoStorage,
  FORMA_DO_NOME_DO_LOGO,
  PREFIXO_DA_INSTALACAO,
  TAMANHO_MAXIMO_DO_LOGO,
  urlPublicaDoLogo,
} from "./logo";
import { codificarPng, decodificarPng, recortar, type ImagemRgba } from "./png";

export type Rgba = { readonly r: number; readonly g: number; readonly b: number; readonly a: number };
export type Caixa = { readonly x: number; readonly y: number; readonly largura: number; readonly altura: number };

export type AnaliseDoLogo = {
  /** A cor do canto — o fundo que o próprio logo desenhou (ou transparente). */
  readonly fundo: Rgba;
  /** O que vai no ícone: o símbolo, ou o logo inteiro sem a borda vazia. */
  readonly recorte: Caixa;
  readonly simbolo: boolean;
  /** O conteúdo é claro (texto branco pensado para fundo escuro)? */
  readonly conteudoClaro: boolean;
};

function pixel(img: ImagemRgba, x: number, y: number): Rgba {
  const o = (y * img.largura + x) * 4;
  return { r: img.rgba[o]!, g: img.rgba[o + 1]!, b: img.rgba[o + 2]!, a: img.rgba[o + 3]! };
}

/** O pixel é desenho, e não fundo? */
function ehConteudo(p: Rgba, fundo: Rgba): boolean {
  if (p.a < 64) return false;
  if (fundo.a < 128) return true;
  return Math.abs(p.r - fundo.r) + Math.abs(p.g - fundo.g) + Math.abs(p.b - fundo.b) > 60;
}

type Faixa = { x0: number; x1: number; y0: number; y1: number };

/**
 * Onde está o símbolo do logo. PURA — recebe pixels, devolve caixas.
 *
 * Três condições para recortar, e todas as três conservadoras:
 *   1. o conteúdo se divide em blocos separados por um vão largo (≥ 8% da
 *      altura) — o vão entre símbolo e nome, não o espaço entre letras;
 *   2. o primeiro bloco é pelo menos 25% mais ALTO que todo o resto — símbolo
 *      ao lado de texto; um nome sozinho tem letras da mesma altura, e a
 *      primeira letra de "Acme" nunca vira ícone;
 *   3. o primeiro bloco é mais ou menos quadrado (entre 1:2 e 2:1).
 */
export function analisarLogo(img: ImagemRgba): AnaliseDoLogo {
  const fundo = pixel(img, 0, 0);
  const colunas: Array<{ y0: number; y1: number } | null> = [];
  let y0 = Infinity;
  let y1 = -1;
  let somaLuz = 0;
  let quantos = 0;
  for (let x = 0; x < img.largura; x++) {
    let topo = -1;
    let base = -1;
    for (let y = 0; y < img.altura; y++) {
      const p = pixel(img, x, y);
      if (!ehConteudo(p, fundo)) continue;
      if (topo < 0) topo = y;
      base = y;
      somaLuz += 0.2126 * p.r + 0.7152 * p.g + 0.0722 * p.b;
      quantos += 1;
    }
    colunas.push(topo < 0 ? null : { y0: topo, y1: base });
    if (topo >= 0) {
      y0 = Math.min(y0, topo);
      y1 = Math.max(y1, base);
    }
  }
  const conteudoClaro = quantos > 0 && somaLuz / quantos > 180;
  const inteiro: Caixa = { x: 0, y: 0, largura: img.largura, altura: img.altura };
  if (y1 < 0) return { fundo, recorte: inteiro, simbolo: false, conteudoClaro };

  const alturaDoConteudo = y1 - y0 + 1;
  const vaoMinimo = Math.max(2, Math.round(alturaDoConteudo * 0.08));

  const faixas: Faixa[] = [];
  let atual: Faixa | null = null;
  let vao = 0;
  colunas.forEach((c, x) => {
    if (!c) {
      vao += 1;
      return;
    }
    if (atual && vao < vaoMinimo) {
      atual.x1 = x;
      atual.y0 = Math.min(atual.y0, c.y0);
      atual.y1 = Math.max(atual.y1, c.y1);
    } else {
      atual = { x0: x, x1: x, y0: c.y0, y1: c.y1 };
      faixas.push(atual);
    }
    vao = 0;
  });

  const todas: Faixa = {
    x0: faixas[0]!.x0,
    x1: faixas[faixas.length - 1]!.x1,
    y0,
    y1,
  };
  const caixaDe = (f: Faixa): Caixa => ({ x: f.x0, y: f.y0, largura: f.x1 - f.x0 + 1, altura: f.y1 - f.y0 + 1 });

  const [primeira, ...resto] = faixas;
  if (primeira && resto.length > 0) {
    const alturaDoSimbolo = primeira.y1 - primeira.y0 + 1;
    const alturaDoResto = Math.max(...resto.map((f) => f.y1 - f.y0 + 1));
    const proporcao = (primeira.x1 - primeira.x0 + 1) / alturaDoSimbolo;
    if (alturaDoSimbolo >= alturaDoResto * 1.25 && proporcao >= 0.5 && proporcao <= 2) {
      return { fundo, recorte: caixaDe(primeira), simbolo: true, conteudoClaro };
    }
  }
  return { fundo, recorte: caixaDe(todas), simbolo: false, conteudoClaro };
}

/** `#rrggbb`. */
export function hexDe(c: Rgba): string {
  return `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * O fundo do ícone. Logo com fundo próprio (opaco) → a MESMA cor, e o recorte
 * some dentro do quadrado sem emenda. Logo transparente → branco, ou quase
 * preto quando o desenho é claro: o iOS pinta de preto o que vier transparente,
 * e um logo escuro sobre preto desapareceria.
 */
export function fundoDoIcone(analise: Pick<AnaliseDoLogo, "fundo" | "conteudoClaro">): string {
  if (analise.fundo.a >= 128) return hexDe(analise.fundo);
  return analise.conteudoClaro ? "#111111" : "#ffffff";
}

/** O recorte, branco sobre transparente — o selo monocromático do Android. */
export function silhueta(img: ImagemRgba, analise: AnaliseDoLogo): ImagemRgba {
  const { x, y, largura, altura } = analise.recorte;
  const rgba = new Uint8Array(largura * altura * 4);
  for (let j = 0; j < altura; j++) {
    for (let i = 0; i < largura; i++) {
      const o = (j * largura + i) * 4;
      rgba[o] = 255;
      rgba[o + 1] = 255;
      rgba[o + 2] = 255;
      rgba[o + 3] = ehConteudo(pixel(img, x + i, y + j), analise.fundo) ? 255 : 0;
    }
  }
  return { largura, altura, rgba };
}

export type LogoParaIcone = {
  /** `data:` URI pronto para o `<img>` do satori — nunca uma URL de rede. */
  readonly src: string;
  readonly largura: number;
  readonly altura: number;
  /** A cor do quadrado por trás. */
  readonly fundo: string;
  readonly simbolo: boolean;
  /** Só existe quando o PNG pôde ser lido — sem ele, o selo cai na letra. */
  readonly silhueta: { readonly src: string; readonly largura: number; readonly altura: number } | null;
};

const dataUri = (tipo: TipoDeLogo, bytes: Uint8Array): string =>
  `data:${tipo};base64,${Buffer.from(bytes).toString("base64")}`;

/**
 * Do arquivo do logo ao que o ícone desenha. JPEG não é decodificado aqui:
 * vai inteiro, sobre branco (é o fundo de quase todo JPEG de logo).
 */
export function logoParaIcone(bytes: Uint8Array, tipo: TipoDeLogo): LogoParaIcone | null {
  if (tipo === "image/jpeg") {
    return { src: dataUri(tipo, bytes), largura: 0, altura: 0, fundo: "#ffffff", simbolo: false, silhueta: null };
  }
  const img = decodificarPng(bytes);
  if (!img) return null;
  const analise = analisarLogo(img);
  const { x, y, largura, altura } = analise.recorte;
  // Margem de 4% em volta do recorte: o satori suaviza a borda ao ampliar, e
  // colado no limite o símbolo sairia com a beirada cortada.
  const m = Math.round(Math.max(largura, altura) * 0.04);
  const caixa = {
    x: Math.max(0, x - m),
    y: Math.max(0, y - m),
    largura: Math.min(img.largura, x + largura + m) - Math.max(0, x - m),
    altura: Math.min(img.altura, y + altura + m) - Math.max(0, y - m),
  };
  const selo = silhueta(img, { ...analise, recorte: caixa });
  return {
    src: dataUri("image/png", codificarPng(recortar(img, caixa.x, caixa.y, caixa.largura, caixa.altura))),
    largura: caixa.largura,
    altura: caixa.altura,
    fundo: fundoDoIcone(analise),
    simbolo: analise.simbolo,
    silhueta: { src: dataUri("image/png", codificarPng(selo)), largura: selo.largura, altura: selo.altura },
  };
}

/** Maior caixa com a proporção do recorte que cabe em `lado × fracao`. */
export function encaixe(largura: number, altura: number, lado: number, fracao: number): { w: number; h: number } {
  const limite = lado * fracao;
  if (largura <= 0 || altura <= 0) return { w: Math.round(limite), h: Math.round(limite) };
  const escala = Math.min(limite / largura, limite / altura);
  return { w: Math.max(1, Math.round(largura * escala)), h: Math.max(1, Math.round(altura * escala)) };
}

/**
 * O endereço é o de um logo SUBIDO para o nosso bucket? Base vazia (sem
 * Supabase no ambiente) responde não, e o ícone cai na letra.
 */
export function ehLogoDoBucket(url: string, base: string): boolean {
  if (base.length === 0) return false;
  const prefixo = urlPublicaDoLogo("", base);
  if (!url.startsWith(prefixo)) return false;
  const caminho = url.slice(prefixo.length);
  const barra = caminho.indexOf("/");
  if (barra <= 0) return false;
  const escopo = caminho.slice(0, barra + 1);
  const escopoValido =
    escopo === PREFIXO_DA_INSTALACAO || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/$/.test(escopo);
  return escopoValido && FORMA_DO_NOME_DO_LOGO.test(caminho.slice(barra + 1));
}

/**
 * Memória por URL. O nome do arquivo é um uuid novo a cada upload
 * (`caminhoNovoDoLogo`), então a mesma URL é sempre o mesmo conteúdo: não há o
 * que invalidar. Só sucesso entra — uma falha de rede tenta de novo depois.
 */
const memoria = new Map<string, LogoParaIcone>();
const MEMORIA_MAXIMA = 8;

/** NUNCA lança: qualquer falha é `null`, e o ícone cai na letra. */
export async function logoDoBucketParaIcone(
  url: string | null,
  base: string = baseDoStorage(),
  buscar: typeof fetch = fetch,
): Promise<LogoParaIcone | null> {
  if (!url || !ehLogoDoBucket(url, base)) return null;
  const guardado = memoria.get(url);
  if (guardado) return guardado;
  try {
    const resposta = await buscar(url, { signal: AbortSignal.timeout(3000), redirect: "error", cache: "no-store" });
    if (!resposta.ok) return null;
    const bytes = new Uint8Array(await resposta.arrayBuffer());
    if (bytes.length === 0 || bytes.length > TAMANHO_MAXIMO_DO_LOGO) return null;
    const tipo = farejarTipo(bytes);
    if (!tipo) return null;
    const pronto = logoParaIcone(bytes, tipo);
    if (!pronto) return null;
    if (memoria.size >= MEMORIA_MAXIMA) memoria.delete(memoria.keys().next().value!);
    memoria.set(url, pronto);
    return pronto;
  } catch (erro) {
    logger.warn("icone do app: logo não pôde ser lido; vale a letra", {
      detalhe: erro instanceof Error ? erro.message : String(erro),
    });
    return null;
  }
}
