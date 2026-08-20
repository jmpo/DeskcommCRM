/**
 * Atribuição de anúncio — de qual campanha um contato veio.
 *
 * Este arquivo é a parte AGNÓSTICA: o formato do dado atribuído e a gravação
 * dele no contato. Quem sabe ler o payload é o transporte, cada um no seu
 * módulo — é a doutrina de restrição de canal (`docs/doctrine/restricao-de-canal.md`,
 * invariante 1: nenhuma feature nomeia um provider), e o `pnpm lint:channels`
 * reprova quem a quebra.
 *
 * Os extratores vivem um por transporte, cada um na pasta do seu canal —
 * `atribuicao-de-anuncio-oficial.ts` para o `referral` do webhook da API
 * oficial, e o homônimo na pasta do transporte por QR para o mesmo dado quando
 * ele vem embutido na própria mensagem. Procure por `extrairAtribuicao` para
 * achar os dois; citar o caminho aqui é justamente o que o invariante proíbe.
 *
 * Não há extrator de Google Ads: não existe mecanismo nativo equivalente para
 * WhatsApp. Aquele caminho depende de uma landing page que capture o `gclid` e
 * embuta um código de rastreio na mensagem pré-preenchida, e essa LP ainda não
 * existe.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

export type PlataformaDeAnuncio = "meta_ads" | "google_ads";

export interface AtribuicaoDeAnuncio {
  plataforma: PlataformaDeAnuncio;
  /** `ctwa_clid` — identifica o clique específico que abriu a conversa. */
  sourceId: string | null;
  /** Título/headline do anúncio, quando o payload o traz. */
  titulo: string | null;
  corpo: string | null;
  sourceUrl: string | null;
  /** Payload de onde isto foi extraído — nunca descartado, é a prova. */
  bruto: Record<string, unknown>;
}

export type Bruto = Record<string, unknown>;
export const obj = (v: unknown): Bruto | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Bruto) : null;
export const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;

/**
 * Grava a atribuição no CONTATO — só na primeira vez.
 *
 * Primeiro toque: uma vez gravada, não muda. A pessoa pode clicar em outro
 * anúncio meses depois, numa conversa já aberta — isso não deveria reescrever
 * de onde ela veio ORIGINALMENTE, que é o dado que explica a existência do
 * relacionamento. `fn_estampar_atribuicao_de_anuncio` faz a guarda e o merge
 * de `source_metadata` ATOMICAMENTE no banco (não aqui): duas mensagens quase
 * simultâneas do mesmo contato novo não podem correr a corrida de leitura e
 * escrita em JS e uma pisar na outra.
 */
export async function estamparAtribuicaoDoContato(
  admin: SupabaseClient,
  contactId: string,
  atribuicao: AtribuicaoDeAnuncio,
): Promise<void> {
  const { error } = await admin.rpc("fn_estampar_atribuicao_de_anuncio" as never, {
    p_contact: contactId,
    p_platform: atribuicao.plataforma,
    p_metadata: {
      ad_platform: atribuicao.plataforma,
      ad_source_id: atribuicao.sourceId,
      ad_title: atribuicao.titulo,
      ad_body: atribuicao.corpo,
      ad_source_url: atribuicao.sourceUrl,
      ad_raw: atribuicao.bruto,
      ad_captured_at: new Date().toISOString(),
    },
  } as never);

  if (error) {
    // `logger.error`, não `console.error`: o DoD proíbe console em código
    // mergeado, e um erro que só existe no stdout do contêiner não chega a
    // ninguém. A falha é tolerada de propósito — perder a atribuição não pode
    // derrubar a entrada da mensagem — mas ela precisa aparecer.
    logger.error("[atribuicao-de-anuncio] falha ao estampar contato", {
      contact_id: contactId,
      plataforma: atribuicao.plataforma,
      detail: error.message.slice(0, 200),
    });
  }
}
