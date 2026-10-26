/**
 * O prompt do primeiro funcionário — o que o passo "Treinar" escreve — no
 * idioma da EMPRESA.
 *
 * ─── Por que saiu de `createDefaultAgent.ts` ───────────────────────────────
 *
 * Os corpos eram só em português ("Você atende os clientes de…"), e numa
 * empresa de Assunção o agente nascia instruído em português. O modelo responde
 * na língua do cliente, mas um prompt em outra língua puxa a resposta para ela
 * — e o dono, que abre o editor para ajustar, lê um texto que não escreveu nem
 * entende. Morar aqui também deixa a regra testável: arquivo `"use server"` só
 * pode exportar funções assíncronas.
 *
 * Os corpos recebem o nome do negócio E o ramo: um funcionário que sabe onde
 * trabalha é o mínimo de quem foi contratado. Quem não respondeu o ramo recebe a
 * versão sem ele, e não uma inventada.
 */
import type { Idioma } from "@/lib/i18n/idiomas";
import type { PromptTemplate } from "@/lib/schemas/onboarding";

/**
 * "Loja de roupas, que é: venda de roupa fitness." — sem a pontuação final do
 * que a pessoa digitou. Com ela, o corpo seguinte ("…fitness.. Fale de forma…")
 * saía com ponto duplo (QA de 26/10/2026).
 */
export function ondeTrabalha(negocio: string, oQueFaz: string | undefined, idioma: Idioma): string {
  const ramo = oQueFaz?.trim().replace(/[\s.!?;:,…]+$/u, "") ?? "";
  if (!ramo) return negocio;
  return idioma === "es" ? `${negocio}, que es: ${ramo}` : `${negocio}, que é: ${ramo}`;
}

const CORPOS: Record<Idioma, Record<PromptTemplate, (onde: string) => string>> = {
  "pt-BR": {
    ecommerce_friendly: (n) =>
      `Você atende os clientes de ${n}. Fale de forma calorosa e próxima, como alguém que gosta de ajudar. Cumprimente, entenda o que a pessoa precisa e ofereça opções claras. Confirme os detalhes antes de agir.`,
    ecommerce_professional: (n) =>
      `Você atende os clientes de ${n}. Fale de forma objetiva, cordial e profissional. Vá direto ao ponto, sem parecer frio, e sempre termine indicando o próximo passo.`,
    support_minimal: (n) =>
      `Você atende os clientes de ${n}. Responda em frases curtas, peça apenas o que for necessário e chame uma pessoa do time assim que a dúvida sair do seu alcance.`,
  },
  es: {
    ecommerce_friendly: (n) =>
      `Atiendes a los clientes de ${n}. Habla de forma cálida y cercana, como alguien a quien le gusta ayudar. Saluda, entiende lo que la persona necesita y ofrece opciones claras. Confirma los detalles antes de actuar.`,
    ecommerce_professional: (n) =>
      `Atiendes a los clientes de ${n}. Habla de forma objetiva, cordial y profesional. Ve directo al punto, sin sonar frío, y termina siempre indicando el siguiente paso.`,
    support_minimal: (n) =>
      `Atiendes a los clientes de ${n}. Responde con frases cortas, pide solo lo necesario y llama a una persona del equipo en cuanto la duda salga de tu alcance.`,
  },
};

export function promptDoOnboarding(
  modelo: PromptTemplate,
  negocio: string,
  oQueFaz: string | undefined,
  idioma: Idioma,
): string {
  return CORPOS[idioma][modelo](ondeTrabalha(negocio, oQueFaz, idioma));
}

/**
 * As palavras que fazem o agente chamar uma pessoa — `ai_agent_versions.
 * handoff_keywords`. O default da coluna é português ("falar com humano",
 * "atendente", "pessoa real"): um cliente que escreve "quiero hablar con una
 * persona" não casava com nenhuma. `null` = o default da coluna (pt-BR, como
 * sempre foi).
 */
export function palavrasDePassagemDoIdioma(idioma: Idioma): string[] | null {
  return idioma === "es"
    ? ["hablar con una persona", "hablar con alguien", "asesor", "persona real"]
    : null;
}
