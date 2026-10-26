/**
 * OS QUADROS PRONTOS, POR TIPO DE NEGÓCIO.
 *
 * Existem por duas razões, e a segunda é a que importa mais:
 *
 * 1. São o PLANO B. Quando a chave de IA não está no lugar, não tem saldo, ou o
 *    provedor devolve algo que não vira funil, o passo continua entregando um
 *    quadro que faz sentido — em vez de devolver a pessoa ao funil de
 *    e-commerce que o gatilho semeou. Falhar fechado na ação, aberto na
 *    informação: a tela diz que a sugestão não veio e mostra os prontos.
 *
 * 2. São a RÉGUA. É contra estes exemplos que a sugestão da IA é pedida e
 *    comparada. Sem um alvo concreto, "sugira um funil" devolve cinco colunas
 *    com nomes de manual de vendas ("Prospecção", "MQL", "Fundo de funil") que
 *    não são o que o dono de uma clínica chama as coisas.
 *
 * ⚠️ TODA ETAPA CARREGA O PASSO. Um pacote que só desse os nomes trocaria um
 * quadro errado por um quadro certo e igualmente parado — ver o cabeçalho de
 * `proposta-de-funil.ts` para a medição.
 */
import type { PropostaDeFunil } from "@/lib/onboarding/proposta-de-funil";
import type { Idioma } from "@/lib/i18n/idiomas";

export interface PacoteDeFunil {
  id: string;
  /**
   * Como o dono reconhece o próprio negócio nesta lista. Não é o nome do nicho
   * no material de marketing ("vertical de saúde") — é o que ele responderia se
   * alguém perguntasse o que ele faz.
   */
  comoSeApresenta: string;
  proposta: PropostaDeFunil;
}

export const PACOTES: readonly PacoteDeFunil[] = [
  {
    id: "clinica",
    comoSeApresenta: "Clínica, consultório ou salão",
    proposta: {
      nome: "Agendamentos",
      etapas: [
        { nome: "Novo contato", passo: "new" },
        { nome: "Já respondi", passo: "contacted" },
        { nome: "Entendendo o caso", passo: "qualifying" },
        { nome: "Quer agendar", passo: "qualified" },
        { nome: "Escolhendo horário", passo: "negotiating" },
        { nome: "Consulta marcada", passo: "won" },
        { nome: "Não vai marcar", passo: "lost" },
      ],
    },
  },
  {
    id: "imobiliaria",
    comoSeApresenta: "Imobiliária ou corretor",
    proposta: {
      nome: "Interessados",
      etapas: [
        { nome: "Novo interessado", passo: "new" },
        { nome: "Já respondi", passo: "contacted" },
        { nome: "Entendendo o que procura", passo: "qualifying" },
        { nome: "Sei o que oferecer", passo: "qualified" },
        { nome: "Visitando imóveis", passo: "negotiating" },
        { nome: "Fechou negócio", passo: "won" },
        { nome: "Desistiu", passo: "lost" },
      ],
    },
  },
  {
    id: "servicos",
    comoSeApresenta: "Serviços, agência ou obra",
    proposta: {
      nome: "Orçamentos",
      etapas: [
        { nome: "Pedido novo", passo: "new" },
        { nome: "Já respondi", passo: "contacted" },
        { nome: "Entendendo o projeto", passo: "qualifying" },
        { nome: "Orçamento enviado", passo: "qualified" },
        { nome: "Negociando", passo: "negotiating" },
        { nome: "Fechou", passo: "won" },
        { nome: "Não fechou", passo: "lost" },
      ],
    },
  },
  {
    id: "curso",
    comoSeApresenta: "Curso, mentoria ou infoproduto",
    proposta: {
      nome: "Matrículas",
      etapas: [
        { nome: "Novo interessado", passo: "new" },
        { nome: "Já respondi", passo: "contacted" },
        { nome: "Tirando dúvidas", passo: "qualifying" },
        { nome: "Quer entrar", passo: "qualified" },
        { nome: "Fechando condições", passo: "negotiating" },
        { nome: "Matriculado", passo: "won" },
        { nome: "Desistiu", passo: "lost" },
      ],
    },
  },
  {
    id: "loja",
    comoSeApresenta: "Loja — online ou de rua",
    proposta: {
      nome: "Vendas",
      etapas: [
        { nome: "Novo contato", passo: "new" },
        { nome: "Já respondi", passo: "contacted" },
        { nome: "Escolhendo o produto", passo: "qualifying" },
        { nome: "Vai levar", passo: "qualified" },
        { nome: "Aguardando pagamento", passo: "negotiating" },
        { nome: "Pedido pago", passo: "won" },
        { nome: "Não comprou", passo: "lost" },
      ],
    },
  },
  {
    id: "generico",
    // Último de propósito: quem não se reconhece em nenhum dos outros já leu
    // todos antes de chegar aqui.
    comoSeApresenta: "Outro tipo de negócio",
    proposta: {
      nome: "Clientes",
      etapas: [
        { nome: "Novo contato", passo: "new" },
        { nome: "Já respondi", passo: "contacted" },
        { nome: "Entendendo a necessidade", passo: "qualifying" },
        { nome: "Proposta enviada", passo: "qualified" },
        { nome: "Negociando", passo: "negotiating" },
        { nome: "Fechou", passo: "won" },
        { nome: "Não fechou", passo: "lost" },
      ],
    },
  },
] as const;

/**
 * O pacote de último recurso.
 *
 * Existe como CONSTANTE e não como `PACOTES[0]` porque quem chama precisa de uma
 * garantia de que sempre há um: um índice fixo numa lista editável é a promessa
 * que se quebra na primeira reordenação, e o desfecho seria uma tela de
 * onboarding com `undefined` no lugar do quadro.
 */
export const PACOTE_PADRAO: PacoteDeFunil =
  PACOTES.find((p) => p.id === "generico") ??
  (() => {
    throw new Error("PACOTES sem o pacote genérico — ele é o último recurso do passo do funil");
  })();

/**
 * Os nomes dos quadros prontos em espanhol — o que a tela mostra e o que se
 * GRAVA como nome de coluna numa empresa que fala espanhol.
 *
 * ─── Por que aqui, e não no dicionário da interface ─────────────────────────
 *
 * Estes nomes não são rótulo de tela: viram DADO (`crm_stages.name`) quando a
 * pessoa clica em "Usar este quadro", e também são o exemplo que a sugestão da
 * IA recebe. As duas pontas — a tela (cliente) e o pedido à IA (servidor) —
 * precisam do MESMO texto, e um mapa ao lado dos pacotes é a fonte única. No
 * QA de 26/10/2026 uma empresa de Assunção escolheu "Loja" e recebeu "Novo
 * contato", "Vai levar", "Pedido pago".
 */
const NOMES_EM_ESPANHOL: Record<string, string> = {
  Agendamentos: "Turnos",
  Interessados: "Interesados",
  "Orçamentos": "Presupuestos",
  "Matrículas": "Inscripciones",
  Vendas: "Ventas",
  Clientes: "Clientes",
  "Novo contato": "Nuevo contacto",
  "Já respondi": "Ya respondí",
  "Entendendo o caso": "Entendiendo el caso",
  "Quer agendar": "Quiere agendar",
  "Escolhendo horário": "Eligiendo horario",
  "Consulta marcada": "Turno agendado",
  "Não vai marcar": "No va a agendar",
  "Novo interessado": "Nuevo interesado",
  "Entendendo o que procura": "Entendiendo qué busca",
  "Sei o que oferecer": "Sé qué ofrecer",
  "Visitando imóveis": "Visitando inmuebles",
  "Fechou negócio": "Cerró el negocio",
  Desistiu: "Desistió",
  "Pedido novo": "Pedido nuevo",
  "Entendendo o projeto": "Entendiendo el proyecto",
  "Orçamento enviado": "Presupuesto enviado",
  Negociando: "Negociando",
  Fechou: "Cerró",
  "Não fechou": "No cerró",
  "Tirando dúvidas": "Respondiendo dudas",
  "Quer entrar": "Quiere inscribirse",
  "Fechando condições": "Cerrando condiciones",
  Matriculado: "Inscripto",
  "Escolhendo o produto": "Eligiendo el producto",
  "Vai levar": "Lo va a llevar",
  "Aguardando pagamento": "Esperando el pago",
  "Pedido pago": "Pedido pagado",
  "Não comprou": "No compró",
  "Entendendo a necessidade": "Entendiendo la necesidad",
  "Proposta enviada": "Propuesta enviada",
};

/** O nome no idioma pedido; o português é a própria chave. */
export function nomeDoPacoteNoIdioma(nome: string, idioma: Idioma): string {
  return idioma === "es" ? (NOMES_EM_ESPANHOL[nome] ?? nome) : nome;
}

/** A proposta de um pacote pronto, com quadro e colunas no idioma da empresa. */
export function propostaNoIdioma(proposta: PropostaDeFunil, idioma: Idioma): PropostaDeFunil {
  return {
    nome: nomeDoPacoteNoIdioma(proposta.nome, idioma),
    etapas: proposta.etapas.map((e) => ({ ...e, nome: nomeDoPacoteNoIdioma(e.nome, idioma) })),
  };
}

/** Todos os nomes que os pacotes usam — para o teste cobrar que nenhum ficou sem tradução. */
export function nomesDosPacotes(): string[] {
  return PACOTES.flatMap((p) => [p.proposta.nome, ...p.proposta.etapas.map((e) => e.nome)]);
}

/** Tem tradução para TODOS os nomes? Exportado para o teste. */
export function nomeTemEspanhol(nome: string): boolean {
  return nome in NOMES_EM_ESPANHOL;
}
