/**
 * OS EFEITOS QUE TRANSFORMAM UMA MENSAGEM EM TRABALHO.
 *
 * ─── Por que este arquivo existe ────────────────────────────────────────────
 *
 * Gravar a mensagem é só metade da ingestão. A outra metade é o que o CRM FAZ
 * com ela: respeitar quem pediu para sair, abrir a demanda no funil e acordar o
 * agente. Esses três efeitos moravam dentro de `lib/waha/ingest.ts`, e por isso
 * só aconteciam no canal por QR — medido em produção:
 *
 *   ai_agent.dispatch_requested   QR 806   oficial 0
 *   leads a partir da conversa    QR  19   oficial 1  (em 28 conversas)
 *   contatos bloqueados por STOP           0 em 101
 *
 * A pessoa que escrevia para o número oficial entrava no CRM e parava ali. Sem
 * erro, sem log, sem aviso — que é o pior modo de falhar, porque ninguém
 * procura o que não reclama.
 *
 * ─── A ORDEM é a regra, não um detalhe de implementação ─────────────────────
 *
 * Os três rodam em sequência e a sequência carrega significado:
 *
 *   1. opt-out  — grava `is_blocked` ANTES do lead;
 *   2. lead     — `garantirLeadDaConversa` RELÊ o contato e recusa criar card
 *                 para bloqueado. Inverter 1 e 2 faz quem acabou de pedir para
 *                 sair virar oportunidade nova no funil;
 *   3. despacho — o turno do agente resolve o lead ativo do contato. Emitir
 *                 antes do passo 2 faria o primeiro turno rodar sem lead.
 *
 * Trocar a ordem não quebra teste de tipo nem derruba nada em runtime: quebra
 * em silêncio, semanas depois, num card que não devia existir. Por isso está
 * escrito aqui e vigiado por `tests/unit/pos-entrada-*.test.ts`.
 *
 * ─── Nada aqui pode derrubar a ingestão ─────────────────────────────────────
 *
 * A mensagem do cliente JÁ está gravada quando esta função roda. Uma exceção
 * que suba daqui viraria 500 para o provider, e ele reenviaria tudo — trocaria
 * um efeito faltando por uma tempestade de reentregas. Cada passo falha para
 * dentro, com log, e o seguinte roda mesmo assim.
 */
import { audit } from "@/lib/audit";
import { garantirLeadDaConversa } from "@/lib/leads/nascimento-do-lead";
import { logger } from "@/lib/logger";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * As palavras que significam "não me escreva mais".
 *
 * Mora aqui, e não em cada ingest, porque o vocabulário do opt-out é regra de
 * negócio (e de LGPD) do produto inteiro — não característica de um transporte.
 * Uma cópia por canal diverge na primeira vez que alguém acrescentar um termo.
 *
 * ─── Por que NÃO é `\b`, que é o que estava aqui antes ─────────────────────
 *
 * Porque em JavaScript `\b` é ASCII: a fronteira de palavra é `[A-Za-z0-9_]`, e
 * qualquer letra acentuada conta como NÃO-palavra. O efeito, na língua em que
 * os clientes escrevem:
 *
 *   "amanhã ele sairá"      → `\bSAIR\b` CASA, porque o "á" vira fronteira
 *   "pararão as obras"      → `\bPARAR\b` CASA, pelo mesmo motivo
 *
 * Ou seja, a versão anterior bloqueava em silêncio quem nunca pediu para sair —
 * e o contato deixava de receber sem que ninguém soubesse por quê. O falso
 * positivo é o pior dos dois erros possíveis aqui: quem pede para sair e não é
 * atendido reclama de novo; quem é bloqueado sem pedir simplesmente some.
 *
 * As lookarounds com `\p{L}\p{N}` fazem a fronteira ser Unicode: "PARAR" solto
 * casa, "pararão" não. Foi um teste deste arquivo que pegou isso — o defeito
 * vinha do canal por QR e ia ser copiado para o canal oficial.
 */
const PALAVRAS = "STOP|PARAR|SAIR|UNSUBSCRIBE|BAJA|CANCELAR";

export const STOP_RX = new RegExp(
  `(?<![\\p{L}\\p{N}])(${PALAVRAS})(?![\\p{L}\\p{N}])`,
  "iu",
);

/**
 * ─── Por que a palavra solta NÃO basta, e o que resolve ────────────────────
 *
 * Medido na base do dono, com o canal oficial no ar:
 *
 *   "Baja"                              → era o que a plantilla PEDIA
 *   "quiero dar de baja la suscripcion" → inequívoco
 *   "Doy de baja la pauta?"             → pergunta sobre PAUSAR O ANÚNCIO dele
 *
 * Os três contêm "baja". Bloquear os três tiraria as mensagens de um cliente
 * que só fez uma pergunta — e o falso positivo é o erro caro aqui: quem pede
 * para sair e não é atendido reclama de novo; quem é bloqueado sem pedir
 * simplesmente some, e ninguém descobre.
 *
 * Então a regra tem dois níveis:
 *
 *   1. o texto É o pedido — a mensagem inteira é a palavra, com pontuação e
 *      saudação toleradas ("BAJA", "baja.", "Baja por favor");
 *   2. ou traz uma frase que não admite outra leitura ("dar de baja",
 *      "no quiero recibir", "no me escriban más").
 *
 * O resto — menção solta no meio de uma frase longa — NÃO bloqueia: vira aviso
 * para um humano decidir. É a diferença entre atender o pedido e adivinhar.
 */
const FRASES_INEQUIVOCAS = new RegExp(
  [
    // espanhol
    "dar de baja",
    "darme de baja",
    "no quiero recibir",
    "no deseo recibir",
    "no me escrib",
    "me desuscrib",
    "desuscribir",
    "quiero salir de la lista",
    // português — "parar de receber" entrou porque o teste anterior o cobria e
    // a primeira versão desta função o rebaixou para "talvez" sem querer: é
    // pedido inequívoco, e deixá-lo de fora seria trocar um falso positivo por
    // um falso NEGATIVO, que é justamente o defeito que este arquivo conserta.
    "parar de receber",
    "quero parar de",
    "nao quero receber",
    "não quero receber",
    "quero sair da lista",
    "remover meu contato",
    "me tira da lista",
    "me tire da lista",
  ].join("|"),
  "iu",
);

/** Só o pedido, tolerando pontuação e uma cortesia curta em volta. */
const SO_O_PEDIDO = new RegExp(
  `^[\\s\\p{P}]*(${PALAVRAS})[\\s\\p{P}]*(por favor|pf|please|obrigad[oa]|gracias)?[\\s\\p{P}]*$`,
  "iu",
);

export type LeituraDoOptOut = "pediu" | "talvez" | "nao";

/**
 * O cliente pediu para sair?
 *
 * `"pediu"`  → bloqueia. `"talvez"` → NÃO bloqueia, mas alguém precisa olhar.
 * `"nao"`    → segue a vida.
 */
export function lerPedidoDeSaida(texto: string | null): LeituraDoOptOut {
  const t = (texto ?? "").trim();
  if (!t) return "nao";
  if (SO_O_PEDIDO.test(t)) return "pediu";
  if (FRASES_INEQUIVOCAS.test(t)) return "pediu";
  // A palavra aparece, mas embrulhada em outra coisa. Não dá para afirmar.
  if (STOP_RX.test(t)) return "talvez";
  return "nao";
}

export interface EntradaDeMensagem {
  organizationId: string;
  contactId: string;
  conversationId: string;
  /**
   * `null` quando a linha não nasceu agora (reentrega).
   *
   * Sem id não há o que despachar: o agente precisa da mensagem que disparou o
   * turno, e inventar um id faria o worker buscar uma linha inexistente.
   */
  messageId: string | null;
  channelSessionId: string;
  /** O texto que o cliente escreveu — é onde se procura o pedido de saída. */
  texto: string | null;
  /** Nome exibido pelo canal, quando houver. Serve para batizar o card novo. */
  nomeDoContato: string | null;
  /** Correlaciona a linha de auditoria com a request que a originou. */
  requestId?: string;
  /**
   * Rótulo da origem, só para `metadata` e log.
   *
   * Não é decisão: nenhum passo abaixo ramifica por este valor. Serve para que,
   * lendo o `event_log` meses depois, se saiba por onde a mensagem entrou.
   */
  origem: string;
}

/**
 * Roda os três efeitos, em ordem, para uma mensagem de ENTRADA recém-gravada.
 *
 * Só para `inbound`: um envio nosso (ou feito do celular do operador) não pede
 * para sair, não abre demanda e não acorda o agente.
 */
export async function aplicarEfeitosPosEntrada(
  admin: Admin,
  entrada: EntradaDeMensagem,
): Promise<void> {
  await aplicarOptOut(admin, entrada);
  await abrirDemanda(admin, entrada);
  await pedirDespachoDoAgente(admin, entrada);
}

/**
 * 1 · Quem pediu para sair, sai.
 *
 * O update é incondicional (não filtra por `is_blocked` atual) de propósito:
 * regravar `true` sobre `true` é barato, e a linha de auditoria de cada pedido
 * é justamente o que prova, depois, que o pedido chegou e foi respeitado.
 */
async function aplicarOptOut(admin: Admin, entrada: EntradaDeMensagem): Promise<void> {
  const leitura = lerPedidoDeSaida(entrada.texto);

  // Menção ambígua: NÃO bloqueia e não fica calado. Bloquear seria decidir por
  // uma pessoa que talvez só tenha feito uma pergunta; calar seria perder o
  // pedido de quem realmente quis sair. Vira item na Central, para um humano.
  if (leitura === "talvez") {
    await avisarPedidoAmbiguo(admin, entrada);
    return;
  }
  if (leitura !== "pediu") return;

  try {
    const agora = new Date().toISOString();
    const { error } = await admin
      .from("contacts")
      .update({ is_blocked: true, blocked_reason: "stop_keyword", blocked_at: agora })
      .eq("organization_id", entrada.organizationId)
      .eq("id", entrada.contactId);

    if (error) {
      // Falhar em silêncio aqui é o pior desfecho possível do arquivo inteiro:
      // o cliente pediu para sair, o sistema não gravou, e a campanha segue
      // escrevendo. Por isso é `error` e não `warn`.
      logger.error("pos-entrada: opt-out NAO gravado — o contato segue recebendo", {
        organization_id: entrada.organizationId,
        contact_id: entrada.contactId,
        origem: entrada.origem,
        detail: error.message.slice(0, 160),
      });
      return;
    }

    await audit({
      action: "contact.blocked",
      organizationId: entrada.organizationId,
      resourceType: "contact",
      requestId: entrada.requestId,
      metadata: { reason: "stop_keyword", contact_id: entrada.contactId, origem: entrada.origem },
    });
  } catch (err) {
    logger.error("pos-entrada: opt-out NAO gravado — o contato segue recebendo", {
      organization_id: entrada.organizationId,
      contact_id: entrada.contactId,
      origem: entrada.origem,
      detail: err instanceof Error ? err.message.slice(0, 160) : "desconhecido",
    });
  }
}

/**
 * 2 · A conversa vira demanda no funil.
 *
 * `garantirLeadDaConversa` é idempotente por contato e já recusa contato
 * bloqueado — por isso o passo 1 vem antes.
 */
async function abrirDemanda(admin: Admin, entrada: EntradaDeMensagem): Promise<void> {
  try {
    const nascimento = await garantirLeadDaConversa(admin, {
      organizationId: entrada.organizationId,
      contactId: entrada.contactId,
      conversationId: entrada.conversationId,
      nomeDoContato: entrada.nomeDoContato,
    });

    // Os DOIS desfechos viram log. Sem a linha do "não criou", o silêncio de
    // "já existia" e o de "a organização não tem funil configurado" têm a mesma
    // cara — e o segundo é falha de configuração que alguém precisa ver.
    logger.info(nascimento.criado ? "pos-entrada: lead criado" : "pos-entrada: lead nao criado", {
      organization_id: entrada.organizationId,
      conversation_id: entrada.conversationId,
      origem: entrada.origem,
      ...(nascimento.criado ? { lead_id: nascimento.leadId } : { motivo: nascimento.motivo }),
    });
  } catch (err) {
    logger.error("pos-entrada: nascimento do lead falhou (a mensagem entra assim mesmo)", {
      organization_id: entrada.organizationId,
      conversation_id: entrada.conversationId,
      origem: entrada.origem,
      error: err instanceof Error ? err.message.slice(0, 120) : "unknown",
    });
  }
}

/**
 * 3 · Acorda o agente.
 *
 * Emitir o evento NÃO faz o assistente responder: o consumidor só abre turno se
 * a organização tiver versão publicada apontando para esta sessão. Sem versão
 * publicada, o evento é gravado e nada acontece — que é o estado de quem atende
 * à mão. O que este passo conserta é a cañería, não a decisão de ligar o robô.
 *
 * O payload é o MESMO dos dois canais, campo a campo. Um payload por canal
 * faria o consumidor adivinhar de quem veio — e o consumidor é um só
 * (`lib/agent-engine/edge/crm/drain.ts`).
 */
async function pedirDespachoDoAgente(admin: Admin, entrada: EntradaDeMensagem): Promise<void> {
  if (!entrada.messageId) return;

  const { error } = await admin.rpc("emit_event" as never, {
    p_event_type: "ai_agent.dispatch_requested",
    p_entity_kind: "message",
    p_entity_id: entrada.messageId,
    p_payload: {
      organization_id: entrada.organizationId,
      conversation_id: entrada.conversationId,
      contact_id: entrada.contactId,
      channel_session_id: entrada.channelSessionId,
      inbound_message_id: entrada.messageId,
    },
    p_metadata: { source: entrada.origem, request_id: entrada.requestId },
    p_organization_id: entrada.organizationId,
  } as never);

  if (error) {
    logger.warn("pos-entrada: emit ai_agent.dispatch_requested falhou", {
      organization_id: entrada.organizationId,
      message_id: entrada.messageId,
      origem: entrada.origem,
      detail: error.message.slice(0, 160),
    });
  }
}

/**
 * "Talvez o cliente tenha pedido para sair" — e ninguém pode decidir sozinho.
 *
 * O dedup é por título: enquanto o item estiver aberto, novas menções do mesmo
 * contato não empilham. Uma Central com dez avisos do mesmo caso é uma Central
 * que ninguém lê.
 *
 * `other` como kind porque é o escape declarado do vocabulário — um kind novo
 * exigiria migration, e o valor aqui está em NÃO perder o pedido, não em
 * classificá-lo com precisão. O título diz o que é.
 */
async function avisarPedidoAmbiguo(admin: Admin, entrada: EntradaDeMensagem): Promise<void> {
  const titulo = "Alguém pode ter pedido para não receber mais mensagens";
  try {
    const { data: jaAberto } = await admin
      .from("agent_inbox_items")
      .select("id")
      .eq("organization_id", entrada.organizationId)
      .eq("kind", "other")
      .eq("title", titulo)
      .eq("ref_id", entrada.contactId)
      .eq("status", "open")
      .limit(1)
      .maybeSingle();
    if (jaAberto) return;

    await admin.from("agent_inbox_items").insert({
      organization_id: entrada.organizationId,
      kind: "other",
      severity: "warn",
      title: titulo,
      body:
        `A mensagem menciona uma palavra de saída, mas dentro de uma frase que ` +
        `admite outra leitura — pode ser uma pergunta, não um pedido. ` +
        `Abra a conversa e decida: se for pedido, bloqueie o contato pela ficha. ` +
        `NÃO bloqueei sozinho porque tirar as mensagens de quem não pediu é o erro ` +
        `mais caro dos dois: quem pede e não é atendido reclama de novo, quem é ` +
        `bloqueado sem pedir simplesmente some.\n\n` +
        `Mensagem: "${(entrada.texto ?? "").slice(0, 200)}"`,
      ref_kind: "contact",
      ref_id: entrada.contactId,
    });
  } catch (err) {
    logger.warn("pos-entrada: aviso de pedido ambíguo falhou", {
      organization_id: entrada.organizationId,
      contact_id: entrada.contactId,
      detail: err instanceof Error ? err.message.slice(0, 160) : "desconhecido",
    });
  }
}
