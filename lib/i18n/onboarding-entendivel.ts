/**
 * Os textos do onboarding entendível para quem se cadastra fora do Brasil
 * (QA de 26/10/2026, cliente do Paraguai): reenviar a confirmação, o número
 * oficial por um clique, a faixa do primeiro número, os dias de teste.
 *
 * Num arquivo à parte, como `agenda-servicos.ts`, para não disputar linhas com
 * o dicionário grande. Mesmo contrato: a chave é o português; o espanhol segue
 * o tom do dicionário (segunda pessoa "tú": "Elige", "Inténtalo") — a escolha
 * do dicionário vence a do rioplatense "vos" para a tela não mudar de tom no
 * meio do wizard. Na TELA deste fork o espanhol sai de usted: a camada
 * `espanhol-de-usted.ts` converte estas frases como as do dicionário, então
 * aqui segue o «tú» de origem. O inglês das mesmas chaves está em `traducoes/en.json`.
 *
 * ⚠️ Este arquivo entra na cadeia do dicionário, que é lida pela seleção de
 * `pnpm cercas` (`vitest.cercas.ts`): citar um global do navegador aqui — até
 * dentro de uma frase — tira o guarda de i18n da seleção.
 */
type Linha = Record<string, { es: string }>;

export const TEXTOS_ONBOARDING_ENTENDIVEL: Linha = {
  // Confirmação do e-mail (login e tela "Confirme seu e-mail").
  "Pronto: se este e-mail tem cadastro pendente, um novo link acabou de sair.": {
    es: "Listo: si este correo tiene un registro pendiente, acaba de salir un enlace nuevo.",
  },
  "Não conseguimos enviar o e-mail, porque o envio de e-mails desta instalação não está configurado. Avise quem administra o sistema.":
    {
      es: "No pudimos enviar el correo porque el envío de correos de esta instalación no está configurado. Avisa a quien administra el sistema.",
    },
  "Confira o e-mail digitado.": { es: "Revisa el correo que escribiste." },
  "Não chegou? Procure também no spam ou em Promoções — às vezes ele cai lá.": {
    es: "¿No llegó? Busca también en spam o en Promociones: a veces cae ahí.",
  },
  "Reenviando…": { es: "Reenviando…" },
  "Reenviar e-mail de confirmação": { es: "Reenviar correo de confirmación" },
  "Falta confirmar o seu e-mail. Abra o link que enviamos quando você criou a conta.": {
    es: "Falta confirmar tu correo. Abre el enlace que te enviamos cuando creaste la cuenta.",
  },
  "Você tem {dias} dias de teste grátis para conhecer tudo.": {
    es: "Tienes {dias} días de prueba gratis para conocer todo.",
  },

  // O passo do telefone e o cartão do número oficial.
  "Já conectei em outro lugar": { es: "Ya lo conecté en otro lugar" },
  "WhatsApp Business oficial (recomendado)": { es: "WhatsApp Business oficial (recomendado)" },
  "O número oficial da sua empresa, conectado com o Facebook da empresa em uns 10 minutos. Sem chaves nem configuração técnica — e dá para continuar usando o app no celular.":
    {
      es: "El número oficial de tu empresa, conectado con el Facebook de la empresa en unos 10 minutos. Sin claves ni configuración técnica, y puedes seguir usando la app en el celular.",
    },
  "Se não tem certeza, escolha a primeira: é a oficial, e funciona com o app WhatsApp Business que você já usa.":
    {
      es: "Si no estás seguro, elige la primera: es la oficial y funciona con la app WhatsApp Business que ya usas.",
    },
  "Antes de começar, tenha em mãos:": { es: "Antes de empezar, ten a mano:" },
  "Um Facebook com acesso de administrador ao portfólio da sua empresa na Meta (Meta Business). Se ainda não tem, dá para criar na hora.":
    {
      es: "Un Facebook con acceso de administrador al portafolio de tu empresa en Meta (Meta Business). Si todavía no lo tienes, puedes crearlo en el momento.",
    },
  "O app WhatsApp Business (não o WhatsApp comum) atualizado, e o celular do número na mão.": {
    es: "La app WhatsApp Business (no el WhatsApp común) actualizada, y el celular del número en la mano.",
  },
  "Uns 10 minutos.": { es: "Unos 10 minutos." },
  "A Meta cobra à parte os modelos de mensagem que você enviar.": {
    es: "Meta cobra aparte las plantillas de mensaje que envíes.",
  },
  "WhatsApp conectado. Seu agente já está atendendo por este número.": {
    es: "WhatsApp conectado. Tu agente ya está atendiendo por este número.",
  },
  "O número oficial da sua empresa no WhatsApp Business. As mensagens entram e saem por aqui, e os modelos aprovados pela Meta são os da sua conta.":
    {
      es: "El número oficial de tu empresa en WhatsApp Business. Los mensajes entran y salen por aquí, y las plantillas aprobadas por Meta son las de tu cuenta.",
    },
  "Abre uma janela da Meta: você entra com o Facebook da empresa, escolhe o número e confirma. O recebimento das mensagens fica configurado sozinho.":
    {
      es: "Se abre una ventana de Meta: entras con el Facebook de la empresa, eliges el número y confirmas. La recepción de los mensajes queda configurada sola.",
    },
  "Coexistência: você continua respondendo pelo app no celular, e as conversas também aparecem aqui. A Meta mostra um QR para escanear com o app.":
    {
      es: "Coexistencia: sigues respondiendo desde la app en el celular, y las conversaciones también aparecen aquí. Meta muestra un QR para escanear con la app.",
    },
  "Atende só por aqui, sem o app no celular.": {
    es: "Atiende solo por aquí, sin la app en el celular.",
  },
  "Recebimento de mensagens": { es: "Recepción de mensajes" },
  "Configurado automaticamente: as mensagens deste número chegam aqui.": {
    es: "Configurado automáticamente: los mensajes de este número llegan aquí.",
  },

  // A faixa do primeiro número (topo de /app).
  "Pronto: seu agente já está atendendo pelo seu número.": {
    es: "Listo: tu agente ya está atendiendo por tu número.",
  },
  "Não consegui ativar o agente daqui. Abra IA › Agentes para revisar e publicar.": {
    es: "No pude activar el agente desde aquí. Abre IA › Agentes para revisarlo y publicarlo.",
  },
  "Seu WhatsApp ainda não está conectado: sem número, nenhuma conversa chega e seu agente não atende.":
    {
      es: "Tu WhatsApp todavía no está conectado: sin número no llega ninguna conversación y tu agente no atiende.",
    },
  "Seu agente": { es: "Tu agente" },
  "está pronto, mas ainda não está atendendo pelo seu número.": {
    es: "está listo, pero todavía no atiende por tu número.",
  },
  "Ativar agora": { es: "Activar ahora" },

  // O fim do wizard e o ensaio.
  "Ele já foi treinado. Falta o número: conecte o WhatsApp e ele começa a atender.": {
    es: "Ya está entrenado. Falta el número: conecta el WhatsApp y empieza a atender.",
  },
  "Sem número, nenhuma conversa chega até ele. Leva poucos minutos.": {
    es: "Sin número no le llega ninguna conversación. Lleva pocos minutos.",
  },
  "ainda não está no ar: ele começa a atender quando você conectar o WhatsApp. O ensaio funciona do mesmo jeito.":
    {
      es: "todavía no está atendiendo: empieza cuando conectes el WhatsApp. El ensayo funciona igual.",
    },
  "Oi! Vocês atendem hoje? Queria saber o preço.": {
    es: "¡Hola! ¿Atienden hoy? Quería saber el precio.",
  },
  "Atendente IA": { es: "Asistente IA" },

  // A recusa do ensaio (rota de teste da versão): a tela de "Ver ele atender"
  // a mostra como motivo, e ela saía em português no wizard em espanhol.
  "Não foi possível executar o teste. Confira modelo, credencial e materiais do agente.": {
    es: "No se pudo ejecutar la prueba. Revisa el modelo, la credencial y los materiales del agente.",
  },

  // As boas-vindas de quem criou a conta (não de quem instalou o servidor).
  "Você tem {dias} dias grátis, até {data}.": { es: "Tienes {dias} días gratis, hasta el {data}." },
  "Sua conta está criada.": { es: "Tu cuenta está creada." },
  "Em poucos passos: o nome do seu negócio, o WhatsApp por onde ele atende, como ele fala e onde organiza os clientes. Dá para pular e voltar depois.":
    {
      es: "En pocos pasos: el nombre de tu negocio, el WhatsApp por donde atiende, cómo habla y dónde organiza a los clientes. Puedes saltar pasos y volver después.",
    },

  // Os fusos da América hispânica no "Onde você atende".
  Assunção: { es: "Asunción" },
  Montevidéu: { es: "Montevideo" },
  "Quito e Guayaquil": { es: "Quito y Guayaquil" },
  "Cidade do México": { es: "Ciudad de México" },

  // Plano e cobrança de empresa que não opera em reais.
  "Para contratar um plano, fale com quem administra o sistema.": {
    es: "Para contratar un plan, habla con quien administra el sistema.",
  },
  "Grátis até {data}": { es: "Gratis hasta el {data}" },

  // O passo "Treinar" e o indicador do celular.
  "E sempre segue estas regras": { es: "Y siempre cumple estas reglas" },
  "Passo {n} de {total}": { es: "Paso {n} de {total}" },
};
