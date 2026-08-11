/**
 * O idioma da interface — o mínimo que faz a escolha SIGNIFICAR alguma coisa.
 *
 * ─── O que existia antes ───────────────────────────────────────────────────
 *
 * Um seletor de idioma no perfil, salvo em `user_metadata.locale`, que NINGUÉM
 * lia. Medido: nenhuma biblioteca de i18n instalada, nenhuma pasta de tradução,
 * nenhum consumidor do campo. Escolher "English (US)" não mudava uma letra.
 *
 * Isso é pior que não ter a opção: o operador escolhe, nada acontece, e ele
 * conclui que o sistema está quebrado — a mesma classe do rodapé que mostra uma
 * versão que não é a que roda.
 *
 * ─── Por que dicionário próprio, e não uma biblioteca ──────────────────────
 *
 * As bibliotecas de i18n do App Router pedem o idioma no CAMINHO da URL
 * (`/es/app/inbox`), o que mexeria em TODA rota do produto — links salvos,
 * webhooks, redirects, testes e2e. Risco enorme para uma tradução parcial.
 *
 * Aqui o idioma vem de quem está logado e o texto é resolvido em memória. Nada
 * de rota muda, e a tradução pode crescer tela a tela sem nenhuma migração.
 *
 * ─── Parcial de propósito, e honesto sobre isso ────────────────────────────
 *
 * São 1.239 textos em 229 arquivos. Traduzir tudo de uma vez é um projeto, e
 * um projeto entregue pela metade deixa a tela em dois idiomas ao mesmo tempo.
 * A decisão do dono foi começar pelo que a equipe usa todo dia — inbox, kanban,
 * contatos, conexões — e o resto segue em português até fazer falta.
 */

export const IDIOMAS = ["pt-BR", "es"] as const;
export type Idioma = (typeof IDIOMAS)[number];

export const IDIOMA_PADRAO: Idioma = "pt-BR";

/**
 * O que veio do perfil é um idioma que sabemos servir?
 *
 * Fecha para o padrão em vez de confiar: o campo aceita qualquer string desde
 * antes desta feature (o seletor já ofereceu `en-US`, que nunca teve tradução),
 * e um valor desconhecido chegando ao dicionário devolveria a CHAVE na tela.
 */
export function normalizarIdioma(bruto: string | null | undefined): Idioma {
  return (IDIOMAS as readonly string[]).includes(bruto ?? "")
    ? (bruto as Idioma)
    : IDIOMA_PADRAO;
}
