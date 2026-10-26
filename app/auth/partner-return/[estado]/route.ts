import { respostaDePonte } from "@/lib/auth/ponte-de-volta";
import { marcaDaSaida } from "@/lib/branding/saida";
import { FORMATO_DO_ESTADO } from "@/lib/channels/estado-da-volta";

/**
 * A VOLTA da página de cadastro do provedor parceiro (conexão por um clique).
 *
 * Chega por navegação de outro site, então o cookie de sessão (Strict) não vem:
 * esta rota é pública e NÃO grava nada. Ela só repassa à tela de Conexões, por
 * uma ponte same-origin (`respostaDePonte`), o que a volta trouxe — e cada
 * valor passa por um formato fixo antes, porque vai parar numa URL nossa. Quem
 * conclui é a tela, autenticada, chamando `POST …/partner/um-clique`, e lá o
 * servidor confere a assinatura do estado e a conta no provedor.
 *
 * O estado vem no CAMINHO, e não na query, porque o provedor ACRESCENTA a query
 * dele (`?connected=…&accountId=…`) ao endereço de volta.
 */
const BASE = "/app/connections?aba=parceiro";
/**
 * Com os dados da volta, o destino é a rota que sabe se a empresa ainda está no
 * onboarding (`/app/connections/volta-do-parceiro`): direto em Conexões, o
 * layout de `/app` mandava quem estava no wizard para `/onboarding` e perdia os
 * parâmetros — a conexão nunca era concluída.
 */
const CONCLUIR = "/app/connections/volta-do-parceiro";
const ID = /^[a-f0-9]{24}$/;
const CODIGO = /^[a-z_]{1,60}$/;

function destino(estado: string, params: URLSearchParams): string {
  if (!FORMATO_DO_ESTADO.test(estado)) return BASE;
  const q = new URLSearchParams({ parceiro_estado: estado });
  const erro = params.get("error");
  const conta = params.get("accountId");
  const perfil = params.get("profileId");
  if (erro !== null) {
    q.set("parceiro_erro", erro && CODIGO.test(erro) ? erro : "whatsapp_error");
  } else if (conta && ID.test(conta) && perfil && ID.test(perfil)) {
    q.set("parceiro_conta", conta);
    q.set("parceiro_perfil", perfil);
  } else {
    return BASE;
  }
  return `${CONCLUIR}?${q.toString()}`;
}

export async function GET(request: Request, { params }: { params: Promise<{ estado: string }> }) {
  const { estado } = await params;
  const alvo = destino(estado, new URL(request.url).searchParams);
  const marca = await marcaDaSaida(null);
  return respostaDePonte(alvo, marca.nome, "Voltando para suas conexões…");
}
