/**
 * A MÍDIA QUE ACOMPANHA LEGENDA nos passos automáticos (ação `send_whatsapp_message`
 * das automações e passo de mensagem do follow-up).
 *
 * Aqui mora só a DECISÃO do que pode sair: imagem ou PDF, e nada mais. O envio em
 * si é o caminho de sempre — `sendMessageHandler` (`app/api/v1/messages/_handler.ts`),
 * o mesmo que o Inbox e as campanhas usam. Este módulo não fala com canal nenhum:
 * existe para que a regra "só imagem ou PDF" seja UMA, e não uma cópia por ação.
 *
 * ═══ Por que o tipo sai do MIME e, sem MIME, da EXTENSÃO URL ═══
 *
 * O campo do editor é uma URL (o upload pela tela é fatia seguinte), e a URL
 * raramente carrega o MIME. Sem uma pista do tipo, o envio teria de escolher
 * entre dois erros — mandar tudo como `octet-stream` (o que o WhatsApp entrega
 * como arquivo genérico, não como imagem) ou mandar tudo como imagem (o que
 * quebra o PDF). A extensão é a pista que o operador já dá ao colar o link; o
 * MIME declarado, quando existe, tem precedência porque é o dado mais forte.
 *
 * Tipo que não é imagem nem PDF é RECUSADO, nunca rebaixado a "documento": a
 * issue pede imagem ou PDF, e um `.zip`/`.docx` "aceito como documento" seria a
 * promessa escrita da tela valendo menos que a tela.
 */
import { kindFromMime } from "./upload-validation";

/** O que a legenda pode acompanhar. `document` aqui é SEMPRE PDF — ver o corte abaixo. */
export type TipoDeMidiaComLegenda = "image" | "document";

export type ClassificacaoDeMidia =
  | { ok: true; type: TipoDeMidiaComLegenda; mime: string }
  | { ok: false; motivo: string };

/** Extensão → MIME, só o que a régua aceita. Chave minúscula, sem o ponto. */
const MIME_POR_EXTENSAO: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
};

/** Extensão da URL, minúscula e sem query/âncora. `null` quando não há ou a URL é inválida. */
function extensaoDaUrl(url: string): string | null {
  let caminho: string;
  try {
    caminho = new URL(url).pathname;
  } catch {
    return null;
  }
  const ultimo = caminho.split("/").pop() ?? "";
  const ponto = ultimo.lastIndexOf(".");
  if (ponto < 0) return null;
  const ext = ultimo.slice(ponto + 1).toLowerCase();
  return ext.length > 0 ? ext : null;
}

/**
 * Classifica a mídia de um passo automático. `mime` é opcional e, quando dado,
 * vence a extensão — quem declarou o tipo sabe mais que o nome do arquivo.
 *
 * `document` só vale para `application/pdf`: os outros documentos que o upload
 * do Inbox aceita (docx, xlsx, zip…) NÃO passam aqui, de propósito.
 */
export function classificarMidiaComLegenda(
  url: string,
  mime?: string | null,
): ClassificacaoDeMidia {
  const declarado = (mime ?? "").split(";")[0]!.trim().toLowerCase();
  const daUrl = extensaoDaUrl(url);
  const efetivo = declarado || (daUrl ? (MIME_POR_EXTENSAO[daUrl] ?? "") : "");
  const kind = efetivo ? kindFromMime(efetivo) : null;
  if (kind === "image") return { ok: true, type: "image", mime: efetivo };
  if (kind === "document" && efetivo === "application/pdf") {
    return { ok: true, type: "document", mime: efetivo };
  }
  return {
    ok: false,
    motivo: "A mídia do passo precisa ser uma imagem (jpg, png, webp, gif) ou um PDF — outros arquivos não são enviados.",
  };
}
