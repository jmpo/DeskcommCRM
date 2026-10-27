import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DICIONARIO } from "@/lib/i18n/dicionario";
import { ESPANHOL_DE_USTED, linhasDeUstedSemUso } from "@/lib/i18n/espanhol-de-usted";

import { tuteioEm } from "./helpers/tuteio";

/**
 * O ESPANHOL DA TELA TRATA POR «USTED» — e a sync com a upstream não desfaz isso calada.
 *
 * Decisão do dono (26/10/2026): quem usa o CRM é tratado de usted. O dicionário
 * da upstream é «tú»; a camada `lib/i18n/espanhol-de-usted.ts` converte por cima
 * (o porquê da camada está no cabeçalho dela). Esta cerca é o que segura a
 * decisão quando uma sincronização traz frase nova da upstream: o PR de sync
 * reprova aqui, com a lista do que chegou em «tú», em vez de a frase ir para a
 * tela do cliente.
 *
 * ─── Como consertar o vermelho de uma sync ─────────────────────────────────
 *
 * - "tuteio na tela": acrescente em `ESPANHOL_DE_USTED` a linha
 *   `"<o texto em tú, exatamente como a mensagem mostra>": "<o mesmo em usted>"`.
 * - "linha sem uso": a upstream mudou ou tirou aquele espanhol. Se o texto novo
 *   também estiver em «tú», ele aparece na outra lista — troque a chave da linha;
 *   senão, apague a linha.
 * - Só entra em `FICA_EM_TU` o que NÃO fala com quem usa o CRM (ver a lista).
 *
 * O detector (formas típicas, e por que o imperativo regular só conta no início
 * da frase) está em `tests/unit/helpers/tuteio.ts`; os casos de controle no fim
 * provam que cada família detecta e que a forma de usted passa.
 */

const RAIZ = join(__dirname, "..", "..");

/**
 * Entradas que ficam em «tú» DE PROPÓSITO, pela chave em português e com o motivo.
 *
 * SÓ entra o que não fala com quem usa o CRM: o que a empresa manda ao cliente
 * final dela, o que é dirigido à IA, a fala do próprio cliente. Esta lista só
 * encolhe — e a entrada que deixou de ter tuteio reprova (ver abaixo).
 */
const FICA_EM_TU: Record<string, string> = {
  "A questão não é ter, é o site trabalhar a favor. Hoje ele afasta cliente em vez de trazer — e no celular o visitante desiste em segundos.": "resposta a objeção que o vendedor diz ao prospecto (lib/prospecting): voz da empresa",
  "Aguarde": "mesmo espanhol («Espera») do substantivo «Espera»: a camada é por texto e trocaria os dois, e sozinho ele se lê como substantivo",
  "Compare com UM cliente que pesquisou, não achou e fechou com o concorrente. O site se paga com o primeiro cliente que trouxer — e dá para começar simples.": "resposta a objeção que o vendedor diz ao prospecto (lib/prospecting): voz da empresa",
  "Continua igual — painel simples para editar o que quiser. A diferença está na base: design exclusivo e estrutura que o Google leva a sério.": "resposta a objeção que o vendedor diz ao prospecto (lib/prospecting): voz da empresa",
  "Ex.: Agradeça o interesse citando o segmento que a pessoa informou, mostre em uma frase como a gente resolve a dificuldade que ela descreveu, e pergunte qual o melhor horário para conversar.": "exemplo de instrução para a IA (prompt)",
  "Exemplo de instrução para os atrasados: na primeira mensagem, só cumprimente e pergunte se é da empresa. Quando a pessoa responder, apresente-se e peça permissão para mostrar o serviço.": "exemplo de instrução para a IA (prompt)",
  "Impede o \"vou pedir para o responsável te ligar\" quando nenhum chamado foi aberto de verdade.": "cita a fala da IA ao cliente final",
  "Instagram alcança quem já segue; o site captura quem pesquisa no Google sem conhecer. Um completa o outro — e o site dá o endereço profissional que passa confiança na hora de fechar.": "resposta a objeção que o vendedor diz ao prospecto (lib/prospecting): voz da empresa",
  "O horário da sua reunião mudou. Agora é": "texto do compromisso ou lembrete que vai ao cliente final pelo WhatsApp (lib/agenda, cron agenda-reminder)",
  "O horário do seu compromisso mudou. Agora é": "texto do compromisso ou lembrete que vai ao cliente final pelo WhatsApp (lib/agenda, cron agenda-reminder)",
  "Oi {{nome}}! Passando pra lembrar: {{titulo}}, {{dia}} às {{hora}}.": "texto do compromisso ou lembrete que vai ao cliente final pelo WhatsApp (lib/agenda, cron agenda-reminder)",
  "Passando pra lembrar do seu compromisso:": "texto do compromisso ou lembrete que vai ao cliente final pelo WhatsApp (lib/agenda, cron agenda-reminder)",
  "Perfeito — e se quiser uma segunda opinião sem compromisso, mando um diagnóstico gratuito do que está pegando para comparar propostas.": "resposta a objeção que o vendedor diz ao prospecto (lib/prospecting): voz da empresa",
  "Qual serviço você procura?": "exemplo de pergunta que a empresa faz no formulário dela (placeholder)",
  "Seu compromisso está marcado para": "texto do compromisso ou lembrete que vai ao cliente final pelo WhatsApp (lib/agenda, cron agenda-reminder)",
  "Sua reunião está marcada para": "texto do compromisso ou lembrete que vai ao cliente final pelo WhatsApp (lib/agenda, cron agenda-reminder)",
  "Sua viagem para {{destino}}": "exemplo de assunto do e-mail que o contato recebe (placeholder da automação)",
  "Você não cuida de nada — textos, fotos, publicação e manutenção por nossa conta. Só uma conversa curta para entender o negócio.": "resposta a objeção que o vendedor diz ao prospecto (lib/prospecting): voz da empresa",
  "Você é um assistente da loja. Responda com clareza e cordialidade…": "exemplo de instrução para a IA (prompt)",
  "Você é um atendente. Responda de forma educada e clara, em pt-BR.": "exemplo de instrução para a IA (prompt)",
};

describe("o espanhol da tela trata por «usted»", () => {
  it("nenhuma entrada do dicionário fala em «tú» com quem usa o CRM", () => {
    const comTuteio = Object.entries(DICIONARIO)
      .filter(([chave]) => !Object.hasOwn(FICA_EM_TU, chave))
      .map(([chave, linha]) => ({ chave, es: linha.es ?? "", formas: tuteioEm(linha.es ?? "", chave) }))
      .filter(({ formas }) => formas.length > 0);
    expect(
      comTuteio.map(({ es, formas }) => `${formas.join(" · ")}\n    "${es}"`),
      'Tuteio na tela. Conserto: uma linha em lib/i18n/espanhol-de-usted.ts, "<este texto>": "<o mesmo em usted>".',
    ).toEqual([]);
  });

  it("toda linha da camada ainda casa com um texto do dicionário", () => {
    expect(
      linhasDeUstedSemUso(),
      "Linha sem uso: a upstream mudou ou tirou este espanhol. Troque a chave pelo texto novo, ou apague a linha.",
    ).toEqual([]);
  });

  it("a camada não perde placeholder, marca nem pontuação de borda", () => {
    // O que o código interpola (`{n}`, `{{nome}}`) e a marcação; dentro de `<…>`
    // e de URL de exemplo o texto é prosa («con su secreto», «su-gateway»), e
    // só a quantidade de sinais conta.
    const marcas = (texto: string) =>
      [
        ...(texto.match(/\{\{?[^{}]*\}?\}|\*\*|\n/g) ?? []).sort(),
        `<${texto.split("<").length}>${texto.split(">").length}`,
        `url${(texto.match(/https?:\/\//g) ?? []).length}`,
      ].join("§");
    // Fragmento de frase (" — escríbalo así: ") vive colado em outro: o espaço da borda é dele.
    const bordas = (texto: string) => `${/^\s*/.exec(texto)![0]}|${/\s*$/.exec(texto)![0]}`;
    const quebradas = Object.entries(ESPANHOL_DE_USTED).filter(
      ([tu, usted]) =>
        marcas(tu) !== marcas(usted) ||
        bordas(tu) !== bordas(usted) ||
        /[.:!?…]\s*$/.test(tu) !== /[.:!?…]\s*$/.test(usted),
    );
    expect(quebradas.map(([tu, usted]) => `"${tu}"\n    → "${usted}"`)).toEqual([]);
  });

  it("a camada não tem linha que não muda nada", () => {
    // O tuteio que sobrou no valor é medido pelo primeiro caso, no dicionário já com a camada.
    expect(Object.entries(ESPANHOL_DE_USTED).filter(([tu, usted]) => tu === usted)).toEqual([]);
  });

  it("FICA_EM_TU só tem entrada que existe e que ainda está em «tú»", () => {
    const sobrando = Object.keys(FICA_EM_TU).filter(
      (chave) => !Object.hasOwn(DICIONARIO, chave) || tuteioEm(DICIONARIO[chave]?.es ?? "", chave).length === 0,
    );
    expect(sobrando, "Tire da lista: a entrada sumiu ou já não tem tuteio.").toEqual([]);
  });

  it("a página offline do aviso (service worker) também trata por usted", () => {
    const sw = readFileSync(join(RAIZ, "public/notify-sw.js"), "utf-8");
    const bloco = (codigo: string) => sw.match(new RegExp(`\\n {2}${codigo}: \\{([\\s\\S]*?)\\n {2}\\},`))?.[1];
    const es = bloco("es");
    const pt = bloco("pt");
    expect(es && pt, "os blocos de TEXTOS_OFFLINE mudaram de forma — ajuste esta cerca").toBeTruthy();
    expect(tuteioEm(es!, pt!)).toEqual([]);
  });
});

describe("o detector de tuteio (casos de controle)", () => {
  // [espanhol, chave em português] — o imperativo regular só é medido com a chave.
  it.each([
    ["Tienes {dias} días de prueba gratis para conocer todo.", "Você tem {dias} dias de teste grátis."],
    ["Falta confirmar tu correo.", "Falta confirmar o seu e-mail."],
    ["Abre el enlace que te enviamos.", "Abra o link que enviamos."],
    ["Elige la conversación que recibirá este mensaje.", "Escolha a conversa que vai receber esta mensagem."],
    ["No pude cargar los datos. Inténtalo de nuevo.", "Não consegui carregar. Tente de novo."],
    ["Asegúrate de que el número esté conectado.", "Garanta que o número esteja conectado."],
    ["Esta cita no está disponible para ti.", "Este compromisso não está disponível para você."],
    ["Estamos aquí para ayudarte.", "Estamos aqui para ajudar você."],
    ["Si no estás seguro, elige la primera.", "Se não tem certeza, escolha a primeira."],
    ["Cuando creaste la cuenta.", "Quando você criou a conta."],
    ["Haz clic en Guardar.", "Clique em Salvar."],
    ["Revisa los datos de la conexión.", "Confira os dados da conexão."],
    ["No se pudo copiar — selecciona el token de arriba.", "Não foi possível copiar — selecione o token acima."],
    ["Datos completados. Revísalos antes de crear.", "Dados preenchidos. Revise antes de criar."],
    ["¿Ya podés entrar?", "Você já consegue entrar?"],
  ])("detecta «%s»", (es, pt) => {
    expect(tuteioEm(es, pt)).not.toEqual([]);
  });

  it.each([
    ["Usted tiene {dias} días de prueba gratis para conocer todo.", "Você tem {dias} dias de teste grátis."],
    ["Falta confirmar su correo.", "Falta confirmar o seu e-mail."],
    ["Abra el enlace que le enviamos.", "Abra o link que enviamos."],
    ["Elija la conversación que recibirá este mensaje.", "Escolha a conversa que vai receber esta mensagem."],
    ["No pude cargar los datos. Inténtelo de nuevo.", "Não consegui carregar. Tente de novo."],
    ["Asegúrese de que el número esté conectado.", "Garanta que o número esteja conectado."],
    ["Esta cita no está disponible para usted.", "Este compromisso não está disponível para você."],
    ["Estamos aquí para ayudarle.", "Estamos aqui para ajudar você."],
    ["Haga clic en Guardar.", "Clique em Salvar."],
    ["Revise los datos de la conexión.", "Confira os dados da conexão."],
    ["Datos completados. Revíselos antes de crear.", "Dados preenchidos. Revise antes de criar."],
    // 3ª pessoa que tem a forma do imperativo de tú: o português diz que é descrição.
    ["Revisa atenciones ya concluidas y evalúa cuáles fueron buenas.", "Revisa atendimentos já concluídos e julga quais foram bons."],
    ["Lee la conversación y sugiere en qué etapa está el cliente.", "Lê a conversa e sugere em que etapa o cliente está."],
    ["La reserva sigue pendiente.", "A reserva segue pendente."],
    ["El agente revisa las conversaciones y aparte reporta el importe.", "O agente revisa as conversas e à parte informa o valor."],
    ["Cada parte del sistema tiene su suerte, su transporte y su soporte.", "Cada parte do sistema tem sua sorte."],
    ["Cada cliente se convierte en una tarjeta.", "Cada cliente vira um cartão."],
    ["Escríbalo así: 1.200,00", "Escreva assim: 1.200,00"],
    ["Área de TI", "Área de TI"],
  ])("deixa passar «%s»", (es, pt) => {
    expect(tuteioEm(es, pt)).toEqual([]);
  });
});
