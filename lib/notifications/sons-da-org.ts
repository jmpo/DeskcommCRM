/**
 * Os SONS dos avisos da Central, escolhidos pela organização.
 *
 * Dois momentos pedem a atenção de quem opera, e cada um tem seu som:
 *
 *   - `venda`  — um negócio entrou numa etapa que avisa (a venda confirmada,
 *                 em quem vende contra entrega): aviso `other` apontando para
 *                 um negócio (`lib/leads/aviso-de-etapa.handler.ts`);
 *   - `pessoa` — o assistente passou a conversa para uma pessoa (`handoff`).
 *
 * O arquivo vive no bucket PRIVADO `org-sounds` (migration 0397), em
 * `<organization_id>/<tipo>-<uuid>.<ext>`; o caminho fica em
 * `organizations.settings.sons_de_aviso`. A tela recebe URL assinada.
 * Sem arquivo, toca o bipe do produto — o aviso nunca fica mudo por falta de
 * configuração.
 */
import type { SoundId } from "./sounds";

export const BUCKET_DOS_SONS = "org-sounds";

export const TIPOS_DE_SOM = ["venda", "pessoa"] as const;
export type TipoDeSom = (typeof TIPOS_DE_SOM)[number];

/** 1 MB: um efeito sonoro curto; o bucket recusa acima disso. */
export const TAMANHO_MAXIMO_DO_SOM = 1024 * 1024;

export const TIPOS_DE_AUDIO_ACEITOS = ["audio/mpeg", "audio/ogg", "audio/wav"] as const;
export type TipoDeAudio = (typeof TIPOS_DE_AUDIO_ACEITOS)[number];

/** O bipe do produto quando a organização não escolheu um arquivo. */
export const SOM_PADRAO: Record<TipoDeSom, SoundId> = { venda: "success", pessoa: "attention" };

/**
 * O tipo REAL do arquivo, pelos primeiros bytes — nunca pela extensão nem pelo
 * `Content-Type` que o navegador declarou (os dois são do cliente).
 */
export function farejarAudio(bytes: Uint8Array): TipoDeAudio | null {
  const ascii = (inicio: number, fim: number) => String.fromCharCode(...bytes.slice(inicio, fim));
  if (bytes.length < 12) return null;
  if (ascii(0, 3) === "ID3") return "audio/mpeg";
  // Quadro MPEG sem cabeçalho ID3: sincronismo de 11 bits.
  if (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) return "audio/mpeg";
  if (ascii(0, 4) === "OggS") return "audio/ogg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "audio/wav";
  return null;
}

export function extensaoDoAudio(tipo: TipoDeAudio): string {
  return tipo === "audio/mpeg" ? "mp3" : tipo === "audio/ogg" ? "ogg" : "wav";
}

/** Qual som um aviso da Central pede — `null` = aviso sem som próprio. */
export function somDoAviso(aviso: { kind: string; ref_kind: string | null }): TipoDeSom | null {
  if (aviso.kind === "handoff") return "pessoa";
  if (aviso.kind === "other" && aviso.ref_kind === "lead") return "venda";
  return null;
}

/**
 * Os sons a tocar para os avisos que apareceram DESDE a última leitura.
 *
 * `vistos === null` é a primeira leitura da página: marca tudo como visto e não
 * toca nada — abrir o CRM com três avisos antigos não pode disparar três sons.
 * Um som por tipo, mesmo com vários avisos iguais de uma vez.
 */
export function sonsNovos(
  vistos: ReadonlySet<string> | null,
  avisos: ReadonlyArray<{ id: string; kind: string; ref_kind: string | null }>,
): TipoDeSom[] {
  if (vistos === null) return [];
  const tipos = new Set<TipoDeSom>();
  for (const a of avisos) {
    if (vistos.has(a.id)) continue;
    const som = somDoAviso(a);
    if (som) tipos.add(som);
  }
  return [...tipos];
}
