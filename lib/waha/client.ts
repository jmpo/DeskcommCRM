/**
 * Minimal WAHA REST client used during onboarding (and elsewhere). Returns
 * `null` from `getWahaClient()` when env is not configured so callers can
 * gracefully render a "Docker is not up" banner instead of crashing.
 *
 * WAHA Plus auth: `X-Api-Key` header. The current devlikeapro/waha-plus
 * image expects the SHA512 HEX HASH directly in the header (matches what's
 * stored in container env). Plaintext-then-hash is NOT used in this version.
 * So WAHA_API_KEY in .env.local IS the hex hash.
 */
import { logger } from "@/lib/logger";
import { classificarFalhaDeAlcance, explicarFalhaDeAlcance } from "@/lib/net/alcance";

/**
 * AS CONVERSAS QUE O CRM NÃO ATENDE, E POR ISSO NÃO PRECISA RECEBER.
 *
 * ─── O que isto custava, medido no banco de produção ────────────────────────
 *
 * Todo evento que o WAHA manda é arquivado inteiro em `webhook_events_log`.
 * Separando os eventos de mensagem por origem, em 20/08/2026:
 *
 *   estados / difusão ......... 23.010 eventos ... 271 MB
 *   grupos .................... 17.970 eventos .... 89 MB
 *   canais / newsletter ........ 1.818 eventos .... 16 MB
 *   conversa 1-a-1 ............. 4.739 eventos .... 19 MB   ← o negócio
 *
 * Ou seja: 376 dos 395 MB eram conversa que o CRM RECEBE, GRAVA INTEIRA e
 * DESCARTA. `handleInbound` já ignora tudo que não é 1-a-1 — o dinheiro era
 * gasto antes da decisão, no transporte e no arquivo.
 *
 * ─── Por que no WAHA e não num `if` nosso ───────────────────────────────────
 *
 * A doc dele é explícita: `ignore` impede "event processing AND database
 * storage" — ou seja, ele nem processa nem guarda. Um filtro do nosso lado
 * chegaria tarde: a mensagem já teria atravessado a rede, ocupado CPU do
 * contêiner e entrado no banco DELE. Cortar na fonte é a única versão que
 * economiza as três coisas.
 *
 * ─── Grupos entram na lista, e isso não muda o produto ──────────────────────
 *
 * O CLAUDE.md manda pular o vínculo de CRM quando o chat termina em `@g.us`.
 * Já hoje nenhuma mensagem de grupo vira conversa, contato ou lead: o
 * comportamento visível é idêntico com ou sem esta linha. O que muda é parar
 * de pagar por elas. Quem um dia quiser grupos inverte a chave.
 */
export const CONVERSAS_IGNORADAS = {
  /** Os "estados" que os contatos publicam. Sozinhos eram 69% do arquivo. */
  status: true,
  /** Listas de difusão. */
  broadcast: true,
  /** Canais / newsletters. */
  channels: true,
  /** Ver o parágrafo acima: o CRM já os descarta na entrada. */
  groups: true,
} as const;

export class WahaClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  /**
   * Idempotent: ensures session exists, then starts it.
   * WAHA Plus split the API:
   *   POST /api/sessions               → create (422 if exists)
   *   POST /api/sessions/{name}/start  → start (422 if already starting/working)
   */
  async startSession(name: string): Promise<{ qr?: string; status: string }> {
    // 1) Create session (ignore 422/409 = already exists)
    const createRes = await fetch(`${this.baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "X-Api-Key": this.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ name, config: { ignore: CONVERSAS_IGNORADAS } }),
    });
    if (!createRes.ok && createRes.status !== 422 && createRes.status !== 409) {
      const body = await createRes.text().catch(() => "");
      throw new Error(`waha_create_${createRes.status}: ${body.slice(0, 200)}`);
    }

    // Sessão que JÁ existe devolve 422 e não recebe a config da criação — foi
    // assim que a sessão em produção ficou sem o filtro. Convergir aqui faz
    // toda reconexão corrigir o estado, em vez de deixar o ajuste dependendo de
    // alguém lembrar de apagar e recriar a sessão.
    if (createRes.status === 422 || createRes.status === 409) {
      await this.convergirConfigDaSessao(name);
    }

    // 2) Start session
    const startRes = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(name)}/start`,
      {
        method: "POST",
        headers: { "X-Api-Key": this.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    if (!startRes.ok && startRes.status !== 422 && startRes.status !== 409) {
      const body = await startRes.text().catch(() => "");
      throw new Error(`waha_start_${startRes.status}: ${body.slice(0, 200)}`);
    }
    if (startRes.status === 422 || startRes.status === 409) {
      // Already started — fetch and return current state
      return this.getSessionQr(name);
    }
    return (await startRes.json()) as { qr?: string; status: string };
  }

  /**
   * Stop a session. Idempotent: 404 (unknown) / 422 / 409 (already stopped)
   * are treated as success so callers can compose reconnect = stop + start.
   */
  async stopSession(name: string): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(name)}/stop`,
      {
        method: "POST",
        headers: { "X-Api-Key": this.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    if (!res.ok && ![404, 422, 409].includes(res.status)) {
      const body = await res.text().catch(() => "");
      throw new Error(`waha_stop_${res.status}: ${body.slice(0, 200)}`);
    }
  }

  /**
   * Logout: descarta as CREDENCIAIS pareadas da sessão (o conteúdo de
   * `/app/.sessions`), mantendo a sessão registrada no WAHA.
   *
   * É o passo que falta para reconectar um número desvinculado pelo celular:
   * `stop + start` sozinho reaproveita as credenciais em disco; se o WhatsApp já
   * as revogou, o engine tenta reconectar com credencial morta e cai direto em
   * FAILED — sem NUNCA passar por SCAN_QR_CODE, então a UI fica esperando um QR
   * que nunca vem. Com logout antes do start, o pareamento recomeça do zero.
   *
   * Idempotente: 404 (sessão desconhecida) / 422 / 409 (já deslogada) contam
   * como sucesso — quem chama quer o efeito, não a transição.
   */
  async logoutSession(name: string): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(name)}/logout`,
      {
        method: "POST",
        headers: { "X-Api-Key": this.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    if (!res.ok && ![404, 422, 409].includes(res.status)) {
      const body = await res.text().catch(() => "");
      throw new Error(`waha_logout_${res.status}: ${body.slice(0, 200)}`);
    }
  }

  /**
   * Põe a config de uma sessão que já existe no estado que queremos.
   *
   * NÃO lança: é melhoria de custo, não condição de envio. Uma versão do WAHA
   * que não conheça `PUT /api/sessions/{name}` faria toda reconexão falhar por
   * causa de uma economia — trocar mensagem por byte é o negócio errado.
   */
  async convergirConfigDaSessao(name: string): Promise<void> {
    try {
      const res = await fetch(`${this.baseUrl}/api/sessions/${encodeURIComponent(name)}`, {
        method: "PUT",
        headers: { "X-Api-Key": this.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ config: { ignore: CONVERSAS_IGNORADAS } }),
      });
      if (!res.ok) {
        logger.warn("[waha] não consegui convergir a config da sessão", { status: res.status });
      }
    } catch {
      // Rede fora aqui não é assunto de quem só quer iniciar a sessão.
    }
  }

  /**
   * Remove a sessão do WAHA por completo (registro + credenciais em disco).
   * Idempotente pelo mesmo motivo do logout: 404 = já não existe = sucesso.
   */
  async deleteSession(name: string): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(name)}`,
      {
        method: "DELETE",
        headers: { "X-Api-Key": this.apiKey, "Content-Type": "application/json" },
      },
    );
    if (!res.ok && ![404, 422, 409].includes(res.status)) {
      const body = await res.text().catch(() => "");
      throw new Error(`waha_delete_${res.status}: ${body.slice(0, 200)}`);
    }
  }

  async getSessionQr(name: string): Promise<{ qr?: string; status: string }> {
    const res = await fetch(`${this.baseUrl}/api/sessions/${encodeURIComponent(name)}`, {
      headers: { "X-Api-Key": this.apiKey },
    });
    if (!res.ok) throw new Error(`waha_${res.status}`);
    return (await res.json()) as { qr?: string; status: string };
  }

  /**
   * URL da foto de perfil do contato, ou null.
   *
   * NÃO lança quando falha: contato sem foto, com privacidade fechada ou
   * simplesmente desconhecido é o caso COMUM, não erro. Quem chama é um cron de
   * varredura — transformar isso em exceção encheria o log de ruído sobre o
   * estado normal da maioria dos contatos.
   *
   * A URL vem assinada pelo CDN do WhatsApp e expira (~9 dias, medido em
   * instalação real). Quem chama baixa e persiste; guardar a URL faz a foto
   * sumir sozinha depois.
   */
  async getProfilePictureUrl(session: string, chatId: string): Promise<string | null> {
    try {
      const res = await fetch(
        `${this.baseUrl}/api/contacts/profile-picture` +
          `?session=${encodeURIComponent(session)}&contactId=${encodeURIComponent(chatId)}`,
        { headers: { "X-Api-Key": this.apiKey } },
      );
      if (!res.ok) return null;
      const body = (await res.json()) as { profilePictureURL?: string | null };
      return body.profilePictureURL ?? null;
    } catch {
      return null;
    }
  }

  /**
   * O telefone por trás de um id opaco (`<lid>@lid`), quando o canal souber.
   *
   * ─── Por que isto não é sempre possível ─────────────────────────────────
   *
   * O WhatsApp passou a identificar quem escreve por um id opaco em vez do
   * número. O canal mantém uma tabela de tradução, mas ela só existe com o
   * STORE habilitado na sessão (`noweb.store.enabled`) — sem isso, todo pedido
   * volta 400 dizendo exatamente isso, medido numa instalação real.
   *
   * E mesmo com o store ligado a tabela é POVOADA POR ATIVIDADE: ela nasce
   * vazia e enche conforme as conversas acontecem. `null` aqui significa "ainda
   * não sei", não "não existe" — quem chama precisa poder tentar de novo depois
   * sem tratar isto como erro.
   */
  async resolvePhoneForLid(session: string, lid: string): Promise<string | null> {
    try {
      const res = await fetch(
        `${this.baseUrl}/api/${encodeURIComponent(session)}/lids/${encodeURIComponent(lid)}`,
        { headers: { "X-Api-Key": this.apiKey } },
      );
      if (!res.ok) return null;
      const body = (await res.json()) as { pn?: string | null };
      // `595981402525@c.us` → `+595981402525`. O sufixo é endereçamento do
      // canal, não parte do número, e guardá-lo faria a tela mostrar lixo.
      const pn = body.pn;
      if (!pn) return null;
      const digitos = String(pn).split("@")[0]?.replace(/\D/g, "") ?? "";
      return digitos.length >= 8 ? `+${digitos}` : null;
    } catch {
      return null;
    }
  }

  async sendMessage(session: string, chatId: string, text: string): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/api/sendText`, {
      method: "POST",
      headers: {
        "X-Api-Key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ session, chatId, text }),
    });
    if (!res.ok) throw new Error(`waha_${res.status}`);
    return res.json();
  }

  async sendMedia(
    session: string,
    chatId: string,
    plan: { endpoint: string; payload: Record<string, unknown> },
  ): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/api/${plan.endpoint}`, {
      method: "POST",
      headers: { "X-Api-Key": this.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ session, chatId, ...plan.payload }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`waha_${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json();
  }
}

/**
 * Traduz erros crus do WAHA numa mensagem que aponta ONDE mexer.
 *
 * A versão anterior mandava TODA falha de rede para a mesma frase — "confirme
 * que o container está no ar" —, inclusive `ENOTFOUND`, que significa o oposto:
 * o endereço configurado não existe, então não há container nenhum a conferir.
 * Em produção isso mandou o dono reiniciar durante semanas um container que
 * nunca havia caído. Reiniciar o que está de pé não conserta um endereço errado,
 * e a frase errada é pior que nenhuma: ela encerra a investigação.
 *
 * Aceita o erro CRU, e não só a mensagem, porque o código real (`ENOTFOUND`,
 * `ECONNREFUSED`) vive na cadeia de `cause` — `err.message` sozinho é sempre
 * "fetch failed". Continua aceitando string para os pontos que já achataram o
 * erro; lá a classificação cai no texto e degrada para "indeterminada", que é a
 * verdade disponível.
 */
export function wahaFriendlyError(erro: unknown): string {
  const falha = classificarFalhaDeAlcance(erro);
  if (falha !== "indeterminada") {
    return explicarFalhaDeAlcance(falha, "o WhatsApp (WAHA)");
  }
  const msg = erro instanceof Error ? erro.message : String(erro ?? "unknown");
  return `Falha na comunicação com o WhatsApp (WAHA): ${msg}`;
}

/**
 * Returns a configured client or null. Null means the WAHA Docker isn't up
 * or the env is using the dev placeholder; the UI must render a banner
 * prompting the user to start it.
 */
export function getWahaClient(): WahaClient | null {
  const url = process.env.WAHA_API_BASE_URL;
  const key = process.env.WAHA_API_KEY;
  if (!url || !key || key === "dev_plaintext_change_me") return null;
  return new WahaClient(url, key);
}
