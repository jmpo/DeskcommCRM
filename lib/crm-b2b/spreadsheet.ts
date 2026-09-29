/**
 * Leitura de planilha para o import de empresas e pessoas — CSV e XLSX.
 *
 * CSV reusa o parser do importador de contatos (`lib/contacts/csv.ts`): RFC 4180,
 * detecta `;` do Excel em português, decodifica Latin-1.
 *
 * XLSX é lido com `fflate`, que JÁ está instalado (o pacote de skills descompacta
 * com ele). O PR original trazia `exceljs` só para isto: MIT, mas 21,8 MB
 * desempacotado, nove dependências diretas (archiver, unzipper, jszip, tmp…) e
 * ~100 pacotes novos no lockfile, para ler a PRIMEIRA aba de uma planilha. Um
 * `.xlsx` é um zip de XML; o que se lê aqui é o mínimo desse formato: a primeira
 * aba do `workbook.xml`, a tabela de textos compartilhados e as células. O que
 * fica de fora de propósito: fórmula (vale o último valor calculado, que o Excel
 * grava), estilo, data (sai o número de série; nenhum campo importado é data) e
 * `.xls` binário antigo — este é recusado com mensagem, em vez de virar lixo.
 */
import { strFromU8, unzipSync } from "fflate";

import { decodificarCsv, parseCsv } from "@/lib/contacts/csv";

export type SheetMatrix = { headers: string[]; rows: string[][] };

export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const IMPORT_MAX_DATA_ROWS = 2_000;
/**
 * Teto do XML DESCOMPACTADO por arquivo do zip. Os 2 MB do upload são do zip; XML
 * repetitivo comprime 100x, e sem este teto um arquivo pequeno vira centenas de
 * megabytes de memória no servidor.
 */
const XLSX_MAX_XML_BYTES = 40 * 1024 * 1024;

type Leitura = { ok: true; sheet: SheetMatrix } | { ok: false; error: string };

export function isXlsxFilename(name: string): boolean {
  return name.toLowerCase().endsWith(".xlsx");
}

export function isCsvFilename(name: string): boolean {
  return name.toLowerCase().endsWith(".csv");
}

export async function parseImportFile(bytes: ArrayBuffer, filename: string): Promise<Leitura> {
  if (bytes.byteLength > IMPORT_MAX_BYTES) {
    return { ok: false, error: `Arquivo maior que ${IMPORT_MAX_BYTES} bytes.` };
  }
  if (isXlsxFilename(filename)) return parseXlsx(bytes);
  if (isCsvFilename(filename)) return parseCsvBytes(bytes);
  return { ok: false, error: "Formato não suportado — envie .csv ou .xlsx." };
}

/** Cabeçalho + linhas, cada linha aparada ou completada até a largura do cabeçalho. */
function matrizParaPlanilha(matrix: string[][]): Leitura {
  if (matrix.length < 2) {
    return { ok: false, error: "Preciso de cabeçalho e ao menos uma linha de dados." };
  }
  const headers = matrix[0]!.map((h) => h.trim());
  const rows = matrix.slice(1);
  if (rows.length > IMPORT_MAX_DATA_ROWS) {
    return { ok: false, error: `Máximo de ${IMPORT_MAX_DATA_ROWS} linhas de dados.` };
  }
  const width = headers.length;
  const normalized = rows.map((r) => {
    const out = r.slice(0, width);
    while (out.length < width) out.push("");
    return out;
  });
  return { ok: true, sheet: { headers, rows: normalized } };
}

function parseCsvBytes(bytes: ArrayBuffer): Leitura {
  const decoded = decodificarCsv(bytes);
  if ("erro" in decoded) return { ok: false, error: decoded.erro };
  return matrizParaPlanilha(parseCsv(decoded.texto));
}

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodificarXml(texto: string): string {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (inteira, e: string) => {
    if (e[0] === "#") {
      const codigo = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(codigo) ? String.fromCodePoint(codigo) : inteira;
    }
    return ENTIDADES[e.toLowerCase()] ?? inteira;
  });
}

/** O texto de um `<si>` ou `<is>`: todos os `<t>`, inclusive os de texto rico (`<r><t>`). */
function textoDosRuns(xml: string): string {
  let out = "";
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += decodificarXml(m[1] ?? "");
  return out;
}

/** "A" → 0, "Z" → 25, "AA" → 26. */
function indiceDaColuna(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "").toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function valorDaCelula(attrs: string, corpo: string, compartilhados: string[]): string {
  const tipo = /\bt="([^"]+)"/.exec(attrs)?.[1];
  if (tipo === "inlineStr") return textoDosRuns(corpo);
  const v = /<v>([\s\S]*?)<\/v>/.exec(corpo)?.[1];
  if (v === undefined) return "";
  if (tipo === "s") return compartilhados[Number(v)] ?? "";
  if (tipo === "b") return v === "1" ? "TRUE" : "FALSE";
  if (tipo === "str" || tipo === "e" || tipo === "d") return decodificarXml(v);
  // Número: `String(Number(v))` desfaz o "1.1222333000181E+13" que alguns
  // geradores gravam para um CNPJ ou telefone digitado como número.
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : v;
}

function parseXlsx(bytes: ArrayBuffer): Leitura {
  let arquivos: Record<string, Uint8Array>;
  let grandeDemais = false;
  try {
    arquivos = unzipSync(new Uint8Array(bytes), {
      filter: (f) => {
        const util =
          f.name === "xl/workbook.xml" ||
          f.name === "xl/_rels/workbook.xml.rels" ||
          f.name === "xl/sharedStrings.xml" ||
          /^xl\/worksheets\/[^/]+\.xml$/.test(f.name);
        if (util && f.originalSize > XLSX_MAX_XML_BYTES) grandeDemais = true;
        return util && !grandeDemais;
      },
    });
  } catch {
    return { ok: false, error: "Não consegui ler o arquivo XLSX." };
  }
  if (grandeDemais) return { ok: false, error: "Planilha grande demais para importar de uma vez." };

  const texto = (nome: string) => {
    const a = arquivos[nome];
    return a ? strFromU8(a) : null;
  };
  const workbook = texto("xl/workbook.xml");
  if (workbook === null) return { ok: false, error: "Não consegui ler o arquivo XLSX." };

  // A PRIMEIRA aba na ordem das abas, que não é necessariamente `sheet1.xml`.
  const rid = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(workbook)?.[1];
  const rels = texto("xl/_rels/workbook.xml.rels") ?? "";
  let alvo: string | undefined;
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    if (m[0].includes(`Id="${rid}"`)) alvo = /Target="([^"]+)"/.exec(m[0])?.[1];
  }
  const caminho = alvo ? `xl/${alvo.replace(/^\/?xl\//, "").replace(/^\//, "")}` : "xl/worksheets/sheet1.xml";
  const aba = texto(caminho);
  if (aba === null) return { ok: false, error: "Planilha vazia." };

  const compartilhados = [...(texto("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    textoDosRuns(m[1] ?? ""),
  );

  const matriz: string[][] = [];
  for (const linha of aba.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const celulas: string[] = [];
    for (const c of (linha[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1] ?? "";
      const ref = /\br="([A-Z]+\d*)"/i.exec(attrs)?.[1];
      const i = ref ? indiceDaColuna(ref) : celulas.length;
      while (celulas.length < i) celulas.push("");
      celulas[i] = valorDaCelula(attrs, c[2] ?? "", compartilhados);
    }
    if (celulas.some((v) => v.trim() !== "")) matriz.push(celulas);
  }
  return matrizParaPlanilha(matriz);
}

/** Sugere mapeamento por apelidos comuns de coluna. */
const ALIASES: Record<string, string[]> = {
  company_name: ["empresa", "company", "company_name", "nome da empresa", "razao", "razão social"],
  legal_name: ["razao social", "razão social", "legal_name", "razao_social"],
  trade_name: ["nome fantasia", "fantasia", "trade_name", "nome_fantasia"],
  cnpj: ["cnpj"],
  person_name: ["pessoa", "decisor", "contato", "nome", "person", "person_name", "nome do contato"],
  job_title: ["cargo", "job_title", "função", "funcao", "titulo"],
  phone: ["telefone", "phone", "celular", "whatsapp", "fone"],
  email: ["email", "e-mail", "mail"],
};

export type MappingField =
  | "company_name"
  | "legal_name"
  | "trade_name"
  | "cnpj"
  | "person_name"
  | "job_title"
  | "phone"
  | "email";

export function suggestColumnMapping(headers: string[]): Partial<Record<MappingField, string>> {
  const out: Partial<Record<MappingField, string>> = {};
  const lower = headers.map((h) => ({ raw: h, key: h.trim().toLowerCase() }));
  for (const [field, aliases] of Object.entries(ALIASES) as [MappingField, string[]][]) {
    const hit = lower.find((h) => aliases.includes(h.key));
    if (hit) out[field] = hit.raw;
  }
  return out;
}

export function applyMapping(
  headers: string[],
  row: string[],
  mapping: Partial<Record<MappingField, string>>,
): Record<MappingField, string> {
  const idx = new Map(headers.map((h, i) => [h, i]));
  const get = (field: MappingField): string => {
    const col = mapping[field];
    if (!col) return "";
    const i = idx.get(col);
    if (i === undefined) return "";
    return (row[i] ?? "").trim();
  };
  return {
    company_name: get("company_name"),
    legal_name: get("legal_name"),
    trade_name: get("trade_name"),
    cnpj: get("cnpj"),
    person_name: get("person_name"),
    job_title: get("job_title"),
    phone: get("phone"),
    email: get("email"),
  };
}
