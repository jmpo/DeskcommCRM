/**
 * O número oficial conectado com UM CLIQUE, pela conta do provedor DA INSTALAÇÃO.
 *
 * ─── O que o cliente da instalação não conseguia ────────────────────────────
 *
 * A conexão por credencial (`lib/channels/connect.ts`) pede a chave de API e o
 * id da conta no painel do provedor, e depois manda colar a URL e o segredo do
 * webhook lá. Quem revende a instalação tem a conta do provedor; o cliente dele
 * não tem acesso a ela, e não deveria ter: a chave alcança todos os números.
 *
 * ─── O desenho ──────────────────────────────────────────────────────────────
 *
 *   1. um PERFIL do provedor por organização (`garantirPerfil`). O provedor
 *      aceita um WhatsApp por perfil, e é o perfil que separa uma organização
 *      da outra dentro da mesma conta;
 *   2. a página de cadastro da Meta hospedada pelo próprio provedor
 *      (`urlDaPaginaDeConexao`), com o nome e a cor da marca da instalação;
 *   3. na volta, a conta só vale se estiver NAQUELE perfil
 *      (`contaConectadaNoPerfil`). É o que impede uma volta forjada de prender
 *      à organização um número que não é dela;
 *   4. o webhook registrado pela instalação e FILTRADO à conta
 *      (`garantirWebhook`). Sem o filtro, a assinatura de cada número
 *      receberia os eventos de todos os números da conta da instalação.
 *
 * Tudo aqui fala só com o provedor: quem grava no banco é `connect.ts`.
 */
import { z } from "zod";

import { socialRequest as pedirAoProvedor, SocialError as ErroDoProvedor } from "../social/client";

export { ErroDoProvedor };

/**
 * Os eventos que a assinatura de cada número recebe. É a lista que o número
 * oficial em produção já usa (medido em 20/10/2026): mensagens, desfechos,
 * modelos, reações e o estado do número.
 */
export const EVENTOS_DO_WEBHOOK = [
  "message.received",
  "message.sent",
  "message.delivered",
  "message.read",
  "message.failed",
  "message.edited",
  "message.deleted",
  "reaction.received",
  "account.connected",
  "account.disconnected",
  "whatsapp.number.activated",
  "whatsapp.number.declined",
  "whatsapp.number.suspended",
  "whatsapp.number.reactivated",
  "whatsapp.number.released",
  "whatsapp.number.kyc_submitted",
  "whatsapp.number.verification_required",
  "whatsapp.number.action_required",
  "whatsapp.template.status_updated",
  "whatsapp.template.category_updated",
] as const;

/** Id do provedor: 24 hex. Tudo o que volta pela URL passa por aqui antes de ir a uma chamada. */
export const ID_DO_PROVEDOR = /^[a-f0-9]{24}$/;

/**
 * Nome do perfil: o da organização, e o começo do id para o nome ser único no
 * time (o provedor recusa nome repetido com 409) mesmo com duas organizações
 * chamadas "Loja".
 */
export function nomeDoPerfil(org: { id: string; nome: string }): string {
  const nome = org.nome.trim().replace(/\s+/g, " ").slice(0, 40) || "Organização";
  return `${nome} · ${org.id.slice(0, 8)}`;
}

const perfisSchema = z.object({ profiles: z.array(z.object({ _id: z.string(), name: z.string() })) });

/**
 * O perfil desta organização no provedor: o já gravado, ou um novo.
 *
 * Idempotente pelo NOME: uma primeira tentativa que criou o perfil e morreu
 * antes de a tela receber a resposta faz a segunda receber 409, e aí o perfil
 * é achado na lista em vez de nascer outro.
 */
export async function garantirPerfil(
  chave: string,
  org: { id: string; nome: string; perfilGravado: string | null },
): Promise<string> {
  const perfis = perfisSchema.parse(await pedirAoProvedor(chave, "profiles")).profiles;
  if (org.perfilGravado && perfis.some((p) => p._id === org.perfilGravado)) return org.perfilGravado;
  const nome = nomeDoPerfil(org);
  const existente = perfis.find((p) => p.name === nome);
  if (existente) return existente._id;
  try {
    const criado = z
      .object({ profile: z.object({ _id: z.string() }) })
      .parse(await pedirAoProvedor(chave, "profiles", { name: nome }));
    return criado.profile._id;
  } catch (erro) {
    if (!(erro instanceof ErroDoProvedor && erro.upstreamStatus === 409)) throw erro;
    const achado = perfisSchema
      .parse(await pedirAoProvedor(chave, "profiles"))
      .profiles.find((p) => p.name === nome);
    if (!achado) throw erro;
    return achado._id;
  }
}

export interface PaginaDeConexao {
  profileId: string;
  /** Para onde o provedor devolve o navegador, com `connected`/`error` acrescentados. */
  redirectUrl: string;
  /** O número já está na app WhatsApp Business e continua nela (coexistência). */
  coexistencia: boolean;
  marca: string;
  /** `#RRGGBB`; outro formato fica de fora, porque o provedor recusa a chamada inteira. */
  cor: string | null;
  idioma: string;
}

/** O provedor só conhece estes três idiomas na página hospedada. */
function idiomaDaPagina(idioma: string): "es" | "pt-BR" | "en" {
  const base = idioma.toLowerCase();
  if (base.startsWith("es")) return "es";
  if (base.startsWith("pt")) return "pt-BR";
  return "en";
}

/**
 * A URL da página de cadastro hospedada pelo provedor (`signup=hosted`): ela
 * abre a janela da Meta e conecta o número escolhido. `onboarding` escolhe a
 * tela da Meta: `business_app` (coexistência, pede o QR no celular) ou `api`
 * (número só na nuvem).
 */
export async function urlDaPaginaDeConexao(chave: string, p: PaginaDeConexao): Promise<string> {
  const query = new URLSearchParams({
    profileId: p.profileId,
    redirect_url: p.redirectUrl,
    onboarding: p.coexistencia ? "business_app" : "api",
    signup: "hosted",
    brandName: p.marca.trim().slice(0, 60) || "CRM",
    language: idiomaDaPagina(p.idioma),
  });
  if (p.cor && /^#[0-9a-fA-F]{6}$/.test(p.cor)) query.set("primaryColor", p.cor);
  const { authUrl } = z
    .object({ authUrl: z.string().url() })
    .parse(await pedirAoProvedor(chave, `connect/whatsapp?${query.toString()}`));
  if (!authUrl.startsWith("https://")) throw new ErroDoProvedor("O provedor devolveu um endereço inseguro.");
  return authUrl;
}

const contasSchema = z.object({
  accounts: z.array(
    z.object({
      _id: z.string(),
      platform: z.string(),
      username: z.string().nullish(),
      displayName: z.string().nullish(),
      isActive: z.boolean(),
      profileId: z.union([z.string(), z.object({ _id: z.string() })]),
    }),
  ),
});

export interface ContaConectada {
  accountId: string;
  /** E.164 com `+`, quando o provedor o informa. */
  telefone: string | null;
  nome: string | null;
}

/**
 * A conta que voltou na URL está NESTE perfil, é de WhatsApp e está ativa?
 * `null` quando não: a volta não prova nada sozinha, quem prova é o provedor.
 */
export async function contaConectadaNoPerfil(
  chave: string,
  profileId: string,
  accountId: string,
): Promise<ContaConectada | null> {
  const { accounts } = contasSchema.parse(
    await pedirAoProvedor(chave, `accounts?profileId=${encodeURIComponent(profileId)}`),
  );
  const conta = accounts.find(
    (a) =>
      a._id === accountId &&
      (typeof a.profileId === "string" ? a.profileId : a.profileId._id) === profileId,
  );
  if (!conta || conta.platform !== "whatsapp" || !conta.isActive) return null;
  const digitos = (conta.username ?? "").replace(/\D/g, "");
  return { accountId: conta._id, telefone: digitos ? `+${digitos}` : null, nome: conta.displayName ?? null };
}

const webhooksSchema = z.object({
  webhooks: z.array(z.object({ _id: z.string(), url: z.string(), isActive: z.boolean() })),
});

/**
 * A assinatura de webhook deste número, filtrada à conta. Devolve o id.
 *
 * Reconciliada pela URL, como a das redes sociais: uma tentativa que criou a
 * assinatura e morreu antes de gravar o id não pode virar duas assinaturas
 * (cada evento chegaria em dobro). Achada pela URL, recebe o filtro e é
 * religada; o segredo dela é o mesmo, porque a URL (o token) e o segredo da
 * sessão só mudam juntos.
 */
export async function garantirWebhook(
  chave: string,
  w: { url: string; segredo: string; accountId: string; nome: string },
): Promise<string> {
  const { webhooks } = webhooksSchema.parse(await pedirAoProvedor(chave, "webhooks/settings"));
  const achada = webhooks.find((h) => h.url === w.url);
  if (achada) {
    await pedirAoProvedor(
      chave,
      "webhooks/settings",
      { webhookId: achada._id, accountIds: [w.accountId], isActive: true },
      "PUT",
    );
    return achada._id;
  }
  const criada = z.object({ webhook: z.object({ _id: z.string() }) }).parse(
    await pedirAoProvedor(chave, "webhooks/settings", {
      name: w.nome.slice(0, 50),
      url: w.url,
      secret: w.segredo,
      events: [...EVENTOS_DO_WEBHOOK],
      accountIds: [w.accountId],
      isActive: true,
    }),
  );
  return criada.webhook._id;
}

/** 404 num DELETE é "já saiu": uma nova tentativa tem de convergir. */
async function apagarNoProvedor(chave: string, caminho: string): Promise<void> {
  try {
    await pedirAoProvedor(chave, caminho, undefined, "DELETE");
  } catch (erro) {
    if (!(erro instanceof ErroDoProvedor && erro.upstreamStatus === 404)) throw erro;
  }
}

export async function apagarWebhook(chave: string, webhookId: string): Promise<void> {
  await apagarNoProvedor(chave, `webhooks/settings?webhookId=${encodeURIComponent(webhookId)}`);
}

/** Desconecta o número do provedor: a conta deixa de contar na fatura da instalação. */
export async function desconectarConta(chave: string, accountId: string): Promise<void> {
  await apagarNoProvedor(chave, `accounts/${encodeURIComponent(accountId)}`);
}

/**
 * O motivo que o provedor acrescenta na volta (`?error=`), na língua de quem
 * opera. Desconhecido cai no genérico: o código cru do provedor não ajuda
 * ninguém a decidir o que fazer.
 */
export function motivoDaVolta(codigo: string | null): string {
  switch (codigo) {
    case "connection_cancelled":
      return "A conexão foi cancelada na janela da Meta.";
    case "one_whatsapp_per_profile":
      return "Esta organização já tem um número conectado. Remova a conexão atual antes de conectar outro.";
    case "whatsapp_number_already_connected":
    case "whatsapp_number_pinned_to_profile":
      return "Este número já está conectado em outra conta. Desconecte-o lá antes de conectar aqui.";
    case "payment_required":
      return "A conta do provedor desta instalação precisa de um meio de pagamento. Avise o administrador da instalação.";
    case "session_expired":
      return "A página de conexão expirou. Tente de novo.";
    default:
      return "A Meta não concluiu a conexão. Tente de novo.";
  }
}
