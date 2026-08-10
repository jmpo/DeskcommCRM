/**
 * Índice de Atrito — montagem dos pares eficiência/dano (spec 17; doutrina
 * `docs/doctrine/sistema-vivo/03-medida-do-proposito.md` §3.3).
 *
 * A regra que este módulo EXISTE para materializar: toda medida que empurra o
 * sistema a fazer mais de alguma coisa é publicada junto da medida que denuncia
 * o custo dessa coisa — mesmo painel, mesmo destaque. Separadas, a de eficiência
 * vence sempre, porque é a que sobe. Por isso o formato de saída é o PAR, e não
 * uma lista de números: a tela não consegue renderizar uma eficiência sozinha
 * sem violar o tipo.
 *
 * Guardado por `tests/unit/atrito-par-eficiencia-dano.test.ts`, que reprova par
 * sem dano — o gate mecânico da doutrina, não um comentário pedindo cuidado.
 *
 * ⚠️ AUSÊNCIA DE DADO É `null`, NUNCA `0`. Denominador zero devolve null e a
 * tela mostra "—". Um zero aqui viraria "0% de contorno" numa org sem nenhum
 * envio — a frase tranquilizadora que a falta de medição não autoriza.
 */

/** Shape cru devolvido por `fn_atrito_metrics` (migrations 0133 + 0134). */
export interface AtritoRaw {
  escopo: {
    demandas: number; de: string; ate: string;
    abandono_horas: number; repeticao_min: number; espera_horas: number;
    demandas_com_caso: number; demandas_abertas: number; denominador: string;
  };
  cliente: {
    turnos_p50: number | null;
    turnos_p90: number | null;
    insistencia_media: number | null;
    insistencia_max: number | null;
    pedidos_de_humano: number;
    descadastros: number;
    abandonos: number;
    conversas_com_fala_nossa: number;
    reperguntas: number;
    perguntas_com_resposta: number;
    esperas_caladas: number;
    esperas_medidas: number;
    espera_resposta_p90_s: number | null;
  };
  empresa: {
    intervencoes_por_demanda: number | null;
    espera_humana_p50_s: number | null;
    espera_humana_p90_s: number | null;
    retrabalho: number;
    vetos: number;
    execucoes_medidas: number;
    envios_por_ia: number;
    envios_humano_no_sistema: number;
    envios_humano_fora: number;
    demandas_sem_proximo_passo: number;
  };
  eficiencia: { ganhos: number; perdidos: number };
}

export type Unidade = "contagem" | "segundos" | "razao" | "media";

export interface Medida {
  chave: string;
  rotulo: string;
  valor: number | null;
  unidade: Unidade;
  /** Ressalva que viaja COM o número — proxy, escopo parcial, régua. */
  nota?: string;
}

export interface Par {
  chave: string;
  titulo: string;
  /** O que o sistema é empurrado a maximizar. */
  eficiencia: Medida;
  /** O custo disso. Nunca vazio — o teste reprova. */
  danos: Medida[];
}

/** Régua do abandono. Default conservador: 72h de silêncio no WhatsApp já é fim. */
export const ABANDONO_HORAS_DEFAULT = 72;
const ABANDONO_HORAS_MIN = 1;
const ABANDONO_HORAS_MAX = 24 * 90;

/**
 * Leitura DEFENSIVA de settings->'atrito' (jsonb livre): valor fora da faixa,
 * de tipo errado ou ausente cai no default. Régua inválida não pode derrubar o
 * painel — e não pode virar `NaN` no rótulo que a tela exibe.
 *
 * ⚠️ O `typeof` vem ANTES do `Number()` de propósito. `Number(true)` é `1`, que
 * é inteiro e cai dentro da faixa — um `true` no jsonb passaria como "abandono
 * após 1h" e o painel acusaria abandono em massa, com aparência de dado. Pego
 * por `tests/unit/atrito-par-eficiencia-dano.test.ts`, não por revisão.
 * `Number([])` é `0` e `Number([5])` é `5` pelo mesmo caminho.
 */
export function lerAbandonoHoras(settings: unknown): number {
  const s = settings as { atrito?: { abandono_horas?: unknown } } | null | undefined;
  const cru = s?.atrito?.abandono_horas;
  if (typeof cru !== "number" && typeof cru !== "string") return ABANDONO_HORAS_DEFAULT;
  const bruto = Number(cru);
  if (!Number.isFinite(bruto) || !Number.isInteger(bruto)) return ABANDONO_HORAS_DEFAULT;
  if (bruto < ABANDONO_HORAS_MIN || bruto > ABANDONO_HORAS_MAX) return ABANDONO_HORAS_DEFAULT;
  return bruto;
}

/** Divisão que devolve null em vez de mentir com 0. */
export function razao(numerador: number, denominador: number): number | null {
  if (!Number.isFinite(numerador) || !Number.isFinite(denominador)) return null;
  if (denominador <= 0) return null;
  return numerador / denominador;
}

/**
 * Quanto das respostas saiu do agente, sobre TODAS as saídas (IA + humano no
 * sistema + humano fora dele). Incluir o `external_device` no denominador é o
 * que impede a automação de parecer alta numa org onde o time responde pelo
 * celular: ali a IA não absorveu, ela apenas não foi usada.
 */
export function taxaDeAutomacao(e: AtritoRaw["empresa"]): number | null {
  return razao(e.envios_por_ia, e.envios_por_ia + e.envios_humano_no_sistema + e.envios_humano_fora);
}

/**
 * Das respostas dadas por gente, quantas saíram POR FORA do sistema.
 * Mede quantas vezes o operador contornou a própria ferramenta — o sinal de
 * atrito da empresa mais honesto que existe, porque ninguém o reporta.
 */
export function taxaDeContorno(e: AtritoRaw["empresa"]): number | null {
  return razao(e.envios_humano_fora, e.envios_humano_no_sistema + e.envios_humano_fora);
}

/**
 * Das conversas em que O SISTEMA FALOU, quantas terminaram no silêncio.
 * Denominador é "conversas em que falamos", não o total: 12 abandonos não diz
 * nada sem saber se é 12 de 15 ou 12 de 1200.
 */
export function taxaDeAbandono(c: AtritoRaw["cliente"]): number | null {
  return razao(c.abandonos, c.conversas_com_fala_nossa);
}

/**
 * Das perguntas que TIVERAM resposta nossa, quantas a pessoa teve de refazer.
 * É um PISO: a camada lexical só pega repergunta quase literal (limiar 0.7,
 * calibrado para zero falso positivo). Reformulação com outro vocabulário
 * escapa — ver o cabeçalho da migration 0135.
 */
export function taxaDeRepergunta(c: AtritoRaw["cliente"]): number | null {
  return razao(c.reperguntas, c.perguntas_com_resposta);
}

/** Das falas do cliente que tiveram resposta, quantas esperaram calado demais. */
export function taxaDeEsperaCalada(c: AtritoRaw["cliente"]): number | null {
  return razao(c.esperas_caladas, c.esperas_medidas);
}

/** Vetos por execução medida — quanto o sistema precisou ser contido de si. */
export function vetosPorExecucao(e: AtritoRaw["empresa"]): number | null {
  return razao(e.vetos, e.execucoes_medidas);
}

const ESCOPO_PARCIAL = "Sobre as demandas encerradas no período.";

export function montarPares(raw: AtritoRaw): Par[] {
  const { cliente, empresa, eficiencia, escopo } = raw;

  return [
    {
      chave: "conversao",
      titulo: "Conversão",
      eficiencia: {
        chave: "ganhos",
        rotulo: "Negócios ganhos",
        valor: eficiencia.ganhos,
        unidade: "contagem",
      },
      danos: [
        {
          chave: "turnos_p50",
          rotulo: "Turnos até o desfecho (mediana)",
          valor: cliente.turnos_p50,
          unidade: "media",
          nota: ESCOPO_PARCIAL,
        },
        {
          chave: "insistencia_media",
          rotulo: "Insistência do agente (média de retornos)",
          valor: cliente.insistencia_media,
          unidade: "media",
          nota: `Quantas vezes o agente voltou ao cliente por conta própria. Medido sobre as ${escopo.demandas_com_caso} demandas que passaram por atendimento humano.`,
        },
        // O MÁXIMO ao lado da média, e não no lugar dela. A spec 17 nasceu do
        // agente que insiste seis vezes: numa base de 40 demandas, seis retornos
        // num único cliente somem na média e é justamente esse caso que precisa
        // aparecer. Publicar só a média reintroduziria o defeito pelo lado da
        // exibição — o sistema mediria o dano e a tela o esconderia.
        {
          chave: "insistencia_max",
          rotulo: "Insistência no pior caso",
          valor: cliente.insistencia_max,
          unidade: "contagem",
          nota: "O cliente que mais recebeu retornos. A média esconde o exagero pontual.",
        },
        {
          chave: "descadastros",
          rotulo: "Descadastros no período",
          valor: cliente.descadastros,
          unidade: "contagem",
          nota: "Atrito máximo: a pessoa pediu para sair.",
        },
        // ABANDONO é irmão do descadastro e muito mais comum: em vez de pedir
        // para sair, a pessoa simplesmente para de responder. Não gera ticket,
        // não gera nota baixa, não aparece em lugar nenhum — e é a perda que
        // mais acontece. A régua vem do payload para o rótulo não mentir.
        {
          chave: "taxa_de_abandono",
          rotulo: `Conversas que morreram no silêncio (após ${escopo.abandono_horas}h)`,
          valor: taxaDeAbandono(cliente),
          unidade: "razao",
          nota: `${cliente.abandonos} de ${cliente.conversas_com_fala_nossa} conversas em que falamos: a pessoa não respondeu e ninguém encerrou.`,
        },
      ],
    },
    {
      chave: "automacao",
      titulo: "Automação",
      eficiencia: {
        chave: "taxa_automacao",
        rotulo: "Respostas dadas pelo agente",
        valor: taxaDeAutomacao(empresa),
        unidade: "razao",
      },
      danos: [
        {
          chave: "pedidos_de_humano",
          rotulo: "Passagens para humano",
          valor: cliente.pedidos_de_humano,
          unidade: "contagem",
          nota: "Confiança perdida na automação.",
        },
        {
          chave: "taxa_de_contorno",
          rotulo: "Respostas humanas fora do sistema",
          valor: taxaDeContorno(empresa),
          unidade: "razao",
          nota: "O time respondeu pelo celular, contornando a ferramenta.",
        },
        // O agente respondeu — e a pessoa teve de perguntar de novo. É o dano
        // direto da automação: responder não é resolver.
        {
          chave: "taxa_de_repergunta",
          rotulo: "Perguntas que a pessoa teve de repetir",
          valor: taxaDeRepergunta(cliente),
          unidade: "razao",
          nota: `Piso: ${cliente.reperguntas} de ${cliente.perguntas_com_resposta}. Conta só a repergunta quase literal — reformulada com outras palavras escapa desta medida.`,
        },
      ],
    },
    {
      chave: "custo_humano",
      titulo: "Custo humano",
      eficiencia: {
        chave: "demandas",
        rotulo: "Demandas encerradas",
        valor: escopo.demandas,
        unidade: "contagem",
        nota: ESCOPO_PARCIAL,
      },
      danos: [
        {
          chave: "intervencoes_por_demanda",
          rotulo: "Intervenções humanas por demanda",
          valor: empresa.intervencoes_por_demanda,
          unidade: "media",
        },
        {
          chave: "espera_humana_p50_s",
          rotulo: "Espera na fila humana (mediana)",
          valor: empresa.espera_humana_p50_s,
          unidade: "segundos",
        },
        {
          chave: "espera_humana_p90_s",
          rotulo: "Espera na fila humana (p90)",
          valor: empresa.espera_humana_p90_s,
          unidade: "segundos",
          // Mediana e p90 iguais denunciam base pequena, não uma fila homogênea.
          // Sem dizer isso, dois números idênticos lado a lado leem-se como bug.
          nota:
            empresa.espera_humana_p50_s !== null &&
            empresa.espera_humana_p50_s === empresa.espera_humana_p90_s
              ? "Igual à mediana: há poucas esperas medidas no período para os dois se separarem."
              : "O p90 é a experiência de quem espera mais — a mediana a esconde.",
        },
        // O INVARIANTE 4 como número: demanda aberta sem próximo passo é o
        // vazamento que a doutrina inteira combate — e vazamento que ninguém vê
        // é o pior tipo. Antes da entidade de demanda isto não era enumerável.
        {
          chave: "demandas_sem_proximo_passo",
          rotulo: "Demandas abertas sem próximo passo",
          valor: empresa.demandas_sem_proximo_passo,
          unidade: "contagem",
          nota: `De ${escopo.demandas_abertas} abertas agora. Cada uma é alguém esperando sem que nada esteja marcado para acontecer.`,
        },
        {
          chave: "retrabalho",
          rotulo: "Demandas que precisaram subir de nível",
          valor: empresa.retrabalho,
          unidade: "contagem",
        },
        // Espera COMUNICADA custa uma fração da espera calada. Esta mede a
        // calada: a pessoa falou e ficou sem nenhuma palavra nossa.
        {
          chave: "taxa_de_espera_calada",
          rotulo: `Esperas sem nenhuma resposta por mais de ${escopo.espera_horas}h`,
          valor: taxaDeEsperaCalada(cliente),
          unidade: "razao",
          nota: `${cliente.esperas_caladas} de ${cliente.esperas_medidas} falas do cliente. Quem sabe que vai esperar, espera; quem não sabe, desiste.`,
        },
      ],
    },
    {
      chave: "contencao",
      titulo: "Contenção",
      eficiencia: {
        chave: "envios_por_ia",
        rotulo: "Mensagens enviadas pelo agente",
        valor: empresa.envios_por_ia,
        unidade: "contagem",
      },
      danos: [
        {
          chave: "vetos_por_execucao",
          rotulo: "Vetos por execução",
          valor: vetosPorExecucao(empresa),
          unidade: "media",
          nota: "Quanto o sistema precisou ser contido de si mesmo antes de falar.",
        },
      ],
    },
  ];
}

/** Formatação para tela. `null` é "—" — nunca "0". */
export function formatarMedida(m: Medida): string {
  if (m.valor === null || !Number.isFinite(m.valor)) return "—";
  switch (m.unidade) {
    case "razao":
      return `${(m.valor * 100).toFixed(1)}%`;
    case "segundos":
      return formatarDuracao(m.valor);
    case "media":
      return m.valor.toFixed(1);
    case "contagem":
      return String(Math.round(m.valor));
  }
}

export function formatarDuracao(segundos: number): string {
  const s = Math.round(segundos);
  if (s < 60) return `${s}s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const restoMin = min % 60;
  return restoMin === 0 ? `${h}h` : `${h}h ${restoMin}min`;
}
