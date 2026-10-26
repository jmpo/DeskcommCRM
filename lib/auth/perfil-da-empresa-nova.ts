/**
 * Com que idioma, fuso, moeda e país uma empresa nasce no cadastro aberto.
 *
 * ─── O defeito, medido em produção (QA de 26/10/2026) ──────────────────────
 *
 * Uma pessoa de Assunção abria `/signup` em espanhol (o `Accept-Language` do
 * navegador decide a tela pública), confirmava o e-mail — e caía num wizard
 * inteiro em português. `signUp` não guardava o idioma de quem se cadastrava, e
 * a organização nascia com os DEFAULTS da coluna: `pt-BR`, `America/Sao_Paulo`,
 * `BRL`, sem país. O funil semeado ("Carrinho abandonado"), o prompt do agente
 * ("Você atende…") e as palavras de passagem para uma pessoa vinham junto, em
 * português, para um cliente que não lê português.
 *
 * ─── A regra ───────────────────────────────────────────────────────────────
 *
 * O idioma é o da tela em que a pessoa se cadastrou (o que ela leu e aceitou),
 * com o `Accept-Language` como segunda pista. Em `pt-BR`, NADA muda: a empresa
 * nasce com os defaults da coluna, exatamente como antes — a instalação da
 * upstream é brasileira, e mudar o nascimento de quem já funciona não está em
 * jogo aqui. Fora do `pt-BR`, o país sai do fuso do NAVEGADOR (o sinal mais
 * fiel de onde a pessoa está) e, na falta dele, da região do `Accept-Language`
 * (`es-PY` → `PY`); do país saem o fuso padrão e a moeda.
 *
 * ─── Por que o país pode NÃO ser gravado ───────────────────────────────────
 *
 * `organizations.country` é a régua do documento do contato, da lei citada no
 * PDF de acesso do titular e do calendário de prazos (`lib/legal/perfil-do-pais`).
 * Só entra país com perfil REVISADO: `gravarDadosCadastrais` recusa salvar
 * Configurações › Empresa com país sem perfil ("País sem perfil revisado: PY").
 * Gravar `PY` no nascimento deixaria a empresa sem conseguir salvar a própria
 * tela de cadastro. Por isso o país só é gravado quando há perfil revisado para
 * ele; o resto (idioma, fuso, moeda) não depende disso. Quando o perfil do
 * Paraguai existir, ele passa a ser gravado sem mudar esta função.
 *
 * Pura de propósito: quem a chama decide de onde vêm as pistas (metadados do
 * cadastro, URL de volta do Google, cabeçalho), e o teste a mede sem banco.
 */
import { paisesOferecidos } from "@/lib/legal/perfil-do-pais";
import { normalizarIdioma, parseAcceptLanguage, type Idioma } from "@/lib/i18n/idiomas";
import { MOEDAS_SERVIDAS, type MoedaServida } from "@/lib/money";
import { FUSOS_OFERECIDOS, fusoValido } from "@/lib/tempo/fusos";

/** As pistas que o cadastro tem de quem está chegando. Todas não confiáveis. */
export interface PistasDoCadastro {
  /** O idioma em que a tela de cadastro foi desenhada (`es`, `pt-BR`). */
  idioma?: string | null;
  /** `Intl.DateTimeFormat().resolvedOptions().timeZone` do navegador. */
  fuso?: string | null;
  /** O cabeçalho `Accept-Language` cru. */
  acceptLanguage?: string | null;
}

/** As colunas de `organizations` que o nascimento grava. Ausente = default da coluna. */
export interface PerfilDaEmpresaNova {
  locale: Idioma;
  timezone?: string;
  currency?: MoedaServida;
  country?: string;
}

/** O país de cada fuso oferecido. Fuso fora da lista não indica país nenhum. */
const PAIS_DO_FUSO: Record<string, string> = {
  "America/Asuncion": "PY",
  "America/Argentina/Buenos_Aires": "AR",
  "America/Montevideo": "UY",
  "America/Santiago": "CL",
  "America/La_Paz": "BO",
  "America/Lima": "PE",
  "America/Bogota": "CO",
  "America/Guayaquil": "EC",
  "America/Mexico_City": "MX",
  "Europe/Madrid": "ES",
  "America/New_York": "US",
  "America/Los_Angeles": "US",
};

/** O fuso de quem só disse o país (pela região do `Accept-Language`). */
const FUSO_DO_PAIS: Record<string, string> = {
  PY: "America/Asuncion",
  AR: "America/Argentina/Buenos_Aires",
  UY: "America/Montevideo",
  CL: "America/Santiago",
  BO: "America/La_Paz",
  PE: "America/Lima",
  CO: "America/Bogota",
  EC: "America/Guayaquil",
  MX: "America/Mexico_City",
  ES: "Europe/Madrid",
};

/**
 * A moeda do país, quando o produto sabe servi-la (`MOEDAS_SERVIDAS`). País cuja
 * moeda não é servida (o peso argentino, por exemplo) fica no default da coluna
 * — trocar por uma moeda que o país não usa seria inventar.
 */
const MOEDA_DO_PAIS: Record<string, string> = {
  PY: "PYG",
  MX: "MXN",
  EC: "USD",
  US: "USD",
  ES: "EUR",
};

/** `es-PY` → `PY`. Só a PRIMEIRA etiqueta com região, na ordem do navegador. */
function regiaoDoAcceptLanguage(header: string | null | undefined): string | null {
  if (!header) return null;
  for (const parte of header.split(",")) {
    const tag = parte.trim().split(";")[0]?.trim() ?? "";
    const regiao = tag.split("-")[1];
    if (regiao && /^[A-Za-z]{2}$/.test(regiao)) return regiao.toUpperCase();
  }
  return null;
}

export function perfilDaEmpresaNova(pistas: PistasDoCadastro): PerfilDaEmpresaNova {
  // A tela vence o cabeçalho: é o idioma que a pessoa LEU ao aceitar os termos.
  const daTela = pistasParaGuardar({ idioma: pistas.idioma }).idioma ?? null;
  const locale = normalizarIdioma(daTela ?? parseAcceptLanguage(pistas.acceptLanguage));

  // O caminho da upstream, intacto: a empresa brasileira nasce como sempre nasceu.
  if (locale === "pt-BR") return { locale };

  const fusoBruto = pistas.fuso?.trim() ?? "";
  // Só um fuso que as telas de configuração conseguem MOSTRAR: fora da lista, o
  // <select> de Configurações exibiria São Paulo enquanto a coluna guarda outro.
  const fusoDoNavegador =
    fusoBruto !== "" &&
    fusoValido(fusoBruto) &&
    FUSOS_OFERECIDOS.some((f) => f.codigo === fusoBruto)
      ? fusoBruto
      : null;

  const pais =
    (fusoDoNavegador ? PAIS_DO_FUSO[fusoDoNavegador] : undefined) ??
    regiaoDoAcceptLanguage(pistas.acceptLanguage) ??
    null;

  const timezone = fusoDoNavegador ?? (pais ? FUSO_DO_PAIS[pais] : undefined);
  const moeda = pais ? MOEDA_DO_PAIS[pais] : undefined;
  const currency =
    moeda && (MOEDAS_SERVIDAS as readonly string[]).includes(moeda)
      ? (moeda as MoedaServida)
      : undefined;
  const country = pais && paisesOferecidos().some((p) => p.codigo === pais) ? pais : undefined;

  return {
    locale,
    ...(timezone ? { timezone } : {}),
    ...(currency ? { currency } : {}),
    ...(country ? { country } : {}),
  };
}

/**
 * As pistas que o `signUp` guarda no `user_metadata` para o provisionamento ler
 * no `/auth/confirm`. Chaves PRÓPRIAS, e não `locale`/`timezone`: essas duas são
 * a preferência PESSOAL da pessoa (`lib/auth/server.ts`), e gravá-las no cadastro
 * faria a escolha do idioma da empresa, depois, não alcançar quem a criou.
 */
export const CHAVE_IDIOMA_DO_CADASTRO = "idioma_do_cadastro";
export const CHAVE_FUSO_DO_CADASTRO = "fuso_do_cadastro";

/** Saneia as pistas antes de irem para o `user_metadata` (ou para a URL do Google). */
export function pistasParaGuardar(bruto: { idioma?: unknown; fuso?: unknown }): {
  idioma?: Idioma;
  fuso?: string;
} {
  const idioma =
    typeof bruto.idioma === "string" && normalizarIdioma(bruto.idioma) === bruto.idioma
      ? (bruto.idioma as Idioma)
      : undefined;
  const fuso =
    typeof bruto.fuso === "string" && bruto.fuso.length <= 64 && fusoValido(bruto.fuso)
      ? bruto.fuso
      : undefined;
  return { ...(idioma ? { idioma } : {}), ...(fuso ? { fuso } : {}) };
}
