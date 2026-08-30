/**
 * As ferramentas de AGENDA — a IA consulta horário e (adiante) marca compromisso.
 *
 * ⚠️ FACHADA FINA. Nenhuma regra nasce aqui: o cálculo é de
 * `lib/agenda/horarios-livres.ts` e a coleta é de `lib/agenda/consulta.ts` — a
 * MESMA que `GET /api/v1/agenda/horarios-livres` usa. Duas coletas dariam à IA e
 * à tela respostas diferentes sobre o mesmo horário, e o sintoma seria a IA
 * oferecendo um horário que a tela não mostra.
 *
 * ⚠️ COMPROMISSO NÃO É RETORNO, e o catálogo tem as duas famílias com os MESMOS
 * verbos (`crm_schedule_followup` × marcar consulta). A `description` de cada
 * lado abre pelo discriminante — *a outra pessoa combinou e sabe?* e *isso ocupa
 * o tempo de alguém?* — antes de dizer o que a ferramenta faz. Contrato inteiro
 * em `cal-briefings/CONTRATO-MCP-agenda.md`.
 *
 * ⚠️ `ctx.supabase` É SERVICE ROLE e bypassa a RLS: `horariosLivresDaOrg` recebe
 * `ctx.organizationId` e filtra `organization_id` em toda query. Está escrito lá
 * dentro, e é o que separa esta chamada de um vazamento entre organizações.
 */
import { z } from "zod";

import {
  horariosLivresDaOrg,
  idDoTipoPorSlug,
  listaAgendamentos,
  MAXIMO_DE_DIAS,
} from "@/lib/agenda/consulta";
import {
  alterarAgendamentoHandler,
  cancelarAgendamentoHandler,
  marcarAgendamentoHandler,
} from "@/app/api/v1/agenda/agendamentos/_handler";
import { ApiError } from "@/lib/api/types";
import { SITUACOES_DO_AGENDAMENTO } from "@/lib/agenda/tipos";
import type { McpToolDefinition } from "@/lib/mcp/types";

/** Teto do horizonte pedido — espelha o da rota, e o excesso é erro de chamada. */
const DIAS_PADRAO = 14;

const horariosLivresShape = {
  event_type_slug: z
    .string()
    .min(1)
    .describe("o identificador legível do tipo de atendimento (ex.: 'consulta-inicial')"),
  /**
   * ⚠️ O MODELO NÃO SABE QUE DIA É HOJE — medido neste repo, num turno real: pedido
   * "daqui a três dias", ele mandou a data do treino dele. Por isso o caminho
   * PADRÃO é relativo, e a data absoluta é a exceção de quem realmente a conhece.
   * Mesma decisão de `crm_schedule_followup` (`lib/mcp/tools/retencao.ts`).
   */
  dias_a_frente: z
    .number()
    .int()
    .min(1)
    .max(MAXIMO_DE_DIAS)
    .optional()
    .describe(`quantos dias olhar a partir de agora (padrão ${DIAS_PADRAO}). Use ESTE campo se você não sabe a data de hoje.`),
  de: z.string().datetime({ offset: true }).optional(),
  ate: z.string().datetime({ offset: true }).optional(),
  owner_user_id: z.string().uuid().optional(),
};

export const crmFindFreeSlots: McpToolDefinition<typeof horariosLivresShape> = {
  name: "crm_find_free_slots",
  description:
    "Mostra os horários livres de um tipo de atendimento, já considerando a jornada de trabalho " +
    "do atendente, folgas, o que ele já tem marcado e a agenda externa dele. " +
    "Use ANTES de oferecer horário ao cliente: oferecer um horário que não existe e depois voltar " +
    "atrás é pior do que demorar um instante a mais para responder. " +
    "QUANDO: informe `dias_a_frente` (a partir de agora — ex.: 7 para a próxima semana). " +
    "SE VOCÊ NÃO SABE QUE DIA É HOJE, USE `dias_a_frente` — não tente montar `de`/`ate`. " +
    "Lista vazia NÃO é erro e NÃO significa que a agenda está cheia: leia `publicou_horarios`. " +
    "Se ele for false, o atendente ainda não publicou os horários dele — não invente horários e " +
    "não diga que está lotado; avise que alguém da equipe confirma. " +
    "Se `fuso_suposto` for true, o fuso da agenda não foi escolhido por ninguém, veio do padrão: " +
    "ofereça o horário pedindo confirmação em vez de afirmar.",
  inputSchema: horariosLivresShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    const agora = new Date();
    const de = input.de ? new Date(input.de) : agora;
    const ate = input.ate
      ? new Date(input.ate)
      : new Date(de.getTime() + (input.dias_a_frente ?? DIAS_PADRAO) * 86_400_000);

    if (ate.getTime() <= de.getTime()) {
      return {
        horarios: [],
        motivo: "periodo_invalido",
        mensagem: "o fim do período precisa ser depois do começo. Use `dias_a_frente` se não souber a data de hoje.",
      };
    }
    if (ate.getTime() - de.getTime() > MAXIMO_DE_DIAS * 86_400_000) {
      return {
        horarios: [],
        motivo: "periodo_longo_demais",
        mensagem: `o período não pode passar de ${MAXIMO_DE_DIAS} dias. Peça um intervalo menor.`,
      };
    }

    const consulta = await horariosLivresDaOrg(ctx.supabase, ctx.organizationId, {
      eventTypeSlug: input.event_type_slug,
      ownerUserId: input.owner_user_id ?? null,
      de,
      ate,
      agora,
    });

    // Recusa de NEGÓCIO volta como RESPOSTA, nunca exceção: exceção mata o turno
    // e o assistente emudece na frente do cliente (`repo-mcp.md` §7.5).
    if (!consulta.ok) {
      return {
        horarios: [],
        motivo: consulta.codigo,
        // A face do CLIENTE, nunca a do operador: `motivoParaOperador` nomeia
        // campo e pessoa, e o modelo repassa o que recebe (DECISÃO 20).
        mensagem: consulta.motivoParaCliente,
      };
    }

    return {
      horarios: consulta.slots.map((s) => ({
        inicio: s.inicio.toISOString(),
        fim: s.fim.toISOString(),
      })),
      fuso_da_regra: consulta.fusoDaRegra,
      /** false = o atendente NÃO publicou jornada. Diferente de "sem vaga" (DECISÃO 1.1). */
      publicou_horarios: consulta.publicouHorarios,
      /** true = o fuso veio do padrão, ninguém escolheu (DECISÃO 20.2). */
      fuso_suposto: consulta.fusoSuposto,
      /** Agendas externas que não estão saudáveis: o horário pode estar defasado. */
      fontes_defasadas: consulta.fontesDefasadas,
    };
  },
};


const listarShape = {
  contact_id: z.string().uuid().optional(),
  lead_id: z.string().uuid().optional(),
  dia: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("um dia específico, no formato AAAA-MM-DD"),
  owner_user_id: z.string().uuid().optional(),
  /**
   * ⚠️ A constante, NUNCA os literais. `SITUACOES_DO_AGENDAMENTO` é a fonte
   * (`lib/agenda/tipos.ts`), e o invariante `vocabulario-banco-x-typescript` existe
   * para impedir a terceira lista. Escrevi `scheduled|done|cancelled` no contrato antes
   * de ler a fonte, e estava errado nos três.
   */
  situacao: z.enum(SITUACOES_DO_AGENDAMENTO).optional(),
  limite: z.number().int().min(1).max(50).optional(),
};

export const crmListAppointments: McpToolDefinition<typeof listarShape> = {
  name: "crm_list_appointments",
  description:
    "Lista os compromissos com HORA MARCADA de um cliente, ou de um dia da equipe, com a " +
    "situação de cada um. Informe pelo menos um recorte: contact_id, lead_id, dia ou " +
    "owner_user_id — sem recorte a chamada é recusada, porque varrer a agenda inteira não " +
    "responde pergunta nenhuma. " +
    "NÃO CONFUNDA COM `crm_list_followups`, que lista os RETORNOS — as vezes em que nós " +
    "decidimos voltar a falar, sem nada combinado com o cliente. Aqui é o que foi combinado " +
    "COM ele e ocupa o tempo de um atendente. O mesmo cliente pode ter os dois. " +
    "USE ANTES DE MARCAR e antes de cobrar: cliente que já tem consulta marcada não deve " +
    "receber oferta de horário como se não tivesse, nem ser cobrado como se estivesse parado.",
  inputSchema: listarShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    const r = await listaAgendamentos(ctx.supabase, ctx.organizationId, {
      contactId: input.contact_id ?? null,
      leadId: input.lead_id ?? null,
      dia: input.dia ?? null,
      ownerUserId: input.owner_user_id ?? null,
      situacao: input.situacao ?? null,
      limite: input.limite ?? 20,
    });

    // Recusa de negócio é RESPOSTA, e a face que sai é a do CLIENTE (DECISÃO 20).
    if (!r.ok) {
      return { compromissos: [], motivo: r.codigo, mensagem: r.motivoParaCliente };
    }

    return {
      compromissos: r.agendamentos.map((a) => ({
        id: a.id,
        titulo: a.titulo,
        inicio: a.iniciaEm,
        fim: a.terminaEm,
        fuso: a.fuso,
        situacao: a.situacao,
        contato_id: a.contatoId,
        atendente_id: a.donoId,
      })),
    };
  },
};


// ─────────────────────────────────────────────────────────────────────────────
// AS ESCRITAS
//
// ⚠️ OS HANDLERS LANÇAM `ApiError`, E EXCEÇÃO MATA O TURNO. Numa rota HTTP isso é
// certo — o wrapper traduz em status. Numa ferramenta MCP não: exceção sobe pela
// ponte e o assistente EMUDECE na frente do cliente, no meio de uma conversa sobre
// marcar consulta. Por isso toda escrita aqui captura e devolve `{ motivo, mensagem }`,
// que é a regra do repo para limite de negócio (`pesquisa/repo-mcp.md` §7.5).
//
// A tradução é por CÓDIGO, e o texto é a face do CLIENTE: o `message` do ApiError é
// escrito para o operador e pode nomear campo e pessoa (DECISÃO 20).
// ─────────────────────────────────────────────────────────────────────────────

/** O que o modelo ouve em cada recusa — e cada uma diz o que FAZER, não só o que não deu. */
const ENSINO_POR_CODIGO: Record<string, string> = {
  agenda_horario_indisponivel:
    "esse horário acabou de ficar indisponível. Chame `crm_find_free_slots` de novo e ofereça um dos horários que voltarem.",
  agenda_fora_da_jornada:
    "esse horário está fora do expediente do atendente. Chame `crm_find_free_slots` e ofereça um dos que ele devolver — não insista no horário pedido.",
  agenda_tipo_desativado:
    "esse tipo de atendimento não está sendo agendado agora. Pergunte que outro atendimento serve, ou avise que alguém da equipe confirma.",
  agenda_sem_responsavel:
    "esse atendimento ainda não tem responsável definido. Não invente horários: avise que alguém da equipe confirma.",
  agenda_disponibilidade_invalida:
    "não consigo ler a agenda desse atendente agora. Não ofereça horários e não diga que está sem vaga — avise que alguém da equipe confirma.",
  agenda_ja_cancelado:
    "esse compromisso já estava desmarcado. Não é erro: siga sem desmarcar de novo.",
  not_found: "não encontrei esse compromisso. Confirme com `crm_list_appointments` antes de tentar de novo.",
  internal_error: "não consegui completar agora. Avise que alguém da equipe confirma, e não repita a tentativa.",
};

/** Captura o `ApiError` do handler e devolve recusa de NEGÓCIO, nunca exceção. */
async function semDerrubarOTurno<T>(
  chave: string,
  fn: () => Promise<T>,
): Promise<T | { [k: string]: unknown; motivo: string; mensagem: string }> {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof ApiError)) throw e; // infra sobe: não é limite de negócio.
    return {
      [chave]: false,
      motivo: e.code,
      mensagem:
        ENSINO_POR_CODIGO[e.code] ??
        "não consegui completar agora. Avise que alguém da equipe confirma o horário.",
    };
  }
}

const marcarShape = {
  event_type_slug: z.string().min(1).describe("o identificador legível do tipo de atendimento"),
  starts_at: z.string().datetime({ offset: true }).describe("o instante exato do início, vindo de `crm_find_free_slots`"),
  contact_id: z.string().uuid().describe("quem vai ser atendido"),
  owner_user_id: z.string().uuid().optional(),
  title: z.string().min(1).max(200).optional(),
  notes: z.string().max(2000).optional(),
};

export const crmBookAppointment: McpToolDefinition<typeof marcarShape> = {
  name: "crm_book_appointment",
  description:
    "Marca um compromisso com HORA COMBINADA entre o cliente e um atendente — consulta, sessão, " +
    "visita, reunião. Use quando o cliente ESCOLHEU um horário e vai comparecer: isto reserva o " +
    "tempo de uma pessoa da equipe, e o cliente conta com ele. " +
    "NÃO use para 'voltar a falar com o cliente depois' — isso é retorno, e a ferramenta é " +
    "`crm_schedule_followup`. A diferença: aqui as DUAS partes combinaram e alguém vai esperar; " +
    "lá é decisão interna nossa e o cliente não sabe de nada. " +
    "Chame `crm_find_free_slots` ANTES e use um `starts_at` que veio de lá — marcar em horário que " +
    "não está livre é recusado, e a recusa manda você consultar de novo.",
  inputSchema: marcarShape,
  category: "write",
  requiresRole: "ai_operator",
  requiresScope: "mcp:write",
  handler: async (input, ctx) =>
    semDerrubarOTurno("marcado", async () => {
      const tipo = await idDoTipoPorSlug(ctx.supabase, ctx.organizationId, input.event_type_slug);
      if (!tipo) {
        return {
          marcado: false,
          motivo: "tipo_desconhecido",
          mensagem: `não existe atendimento chamado "${input.event_type_slug}". Pergunte que tipo de atendimento a pessoa quer.`,
        };
      }
      const r = await marcarAgendamentoHandler(
        ctx.supabase,
        { organization_id: ctx.organizationId, actor: ctx.actor, requestId: ctx.requestId },
        {
          event_type_id: tipo.id,
          starts_at: input.starts_at,
          contact_id: input.contact_id,
          ...(input.owner_user_id ? { owner_user_id: input.owner_user_id } : {}),
          ...(input.title ? { title: input.title } : {}),
          ...(input.notes ? { notes: input.notes } : {}),
        },
      );
      return { marcado: true, compromisso: r };
    }),
};

const remarcarShape = {
  appointment_id: z.string().uuid(),
  new_starts_at: z.string().datetime({ offset: true }).describe("o novo início, vindo de `crm_find_free_slots`"),
  notes: z.string().max(2000).optional(),
};

export const crmRescheduleAppointment: McpToolDefinition<typeof remarcarShape> = {
  name: "crm_reschedule_appointment",
  description:
    "Move um compromisso já marcado para outro horário, mantendo o mesmo cliente e o mesmo tipo. " +
    "Use quando o cliente pediu para mudar o dia ou a hora. " +
    "REMARCAR NÃO É CANCELAR E MARCAR DE NOVO: é o MESMO compromisso mudando de hora, o histórico " +
    "continua um só e o lembrete é refeito sozinho. Se você cancelar e marcar, o cliente recebe " +
    "dois avisos contraditórios e a linha do tempo dele passa a contar que ele desistiu e voltou — " +
    "o que não aconteceu. " +
    "Confirme o horário novo com `crm_find_free_slots` antes: horário indisponível é recusado.",
  inputSchema: remarcarShape,
  category: "write",
  requiresRole: "ai_operator",
  requiresScope: "mcp:write",
  handler: async (input, ctx) =>
    semDerrubarOTurno("remarcado", async () => {
      const r = await alterarAgendamentoHandler(
        ctx.supabase,
        { organization_id: ctx.organizationId, actor: ctx.actor, requestId: ctx.requestId },
        {
          id: input.appointment_id,
          starts_at: input.new_starts_at,
          ...(input.notes ? { notes: input.notes } : {}),
        },
      );
      return { remarcado: true, compromisso: r };
    }),
};

const cancelarShape = {
  appointment_id: z.string().uuid(),
  /**
   * OBRIGATÓRIO, e não é burocracia: é o que a equipe lê ao ver o horário vago.
   * Se você não tiver de onde tirar, escreva o que o cliente disse — melhor uma
   * frase sua que um campo vazio.
   */
  reason: z.string().min(3).max(500),
};

export const crmCancelAppointment: McpToolDefinition<typeof cancelarShape> = {
  name: "crm_cancel_appointment",
  description:
    "Desmarca um compromisso que ainda não aconteceu e LIBERA o horário para outra pessoa. " +
    "Use quando o cliente avisou que não vem, ou pediu para desmarcar. " +
    "NÃO use para 'não preciso mais falar com esse cliente' — isso é `crm_cancel_followup`. " +
    "NÃO use para remarcar: se o cliente quer outro dia, use `crm_reschedule_appointment`; " +
    "cancelar solta o horário e ele pode ser tomado por outro cliente em segundos, e isso não " +
    "dá para desfazer. " +
    "Informe `reason` — é o que a equipe vai ler ao ver o horário vago.",
  inputSchema: cancelarShape,
  category: "write",
  requiresRole: "ai_operator",
  requiresScope: "mcp:write",
  handler: async (input, ctx) =>
    semDerrubarOTurno("cancelado", async () => {
      const r = await cancelarAgendamentoHandler(
        ctx.supabase,
        { organization_id: ctx.organizationId, actor: ctx.actor, requestId: ctx.requestId },
        { id: input.appointment_id, reason: input.reason },
      );
      return { cancelado: true, compromisso: r };
    }),
};
