/**
 * Os textos das telas que a equipe usa todo dia.
 *
 * ─── A regra de ouro deste arquivo ─────────────────────────────────────────
 *
 * A CHAVE é o texto em português. Não `inbox.filtro.todas`, não `INBOX_ALL`.
 *
 * Duas razões, e as duas doem quando se descobre tarde:
 *
 *   1. Quem lê o componente vê a frase, não um código. `t("Todas as tags")`
 *      continua legível; `t("inbox.tags.all")` obriga a abrir outro arquivo
 *      para saber o que a tela diz.
 *   2. Falta de tradução DEGRADA para português em vez de mostrar a chave. Um
 *      `t("Assumir")` sem entrada em espanhol devolve "Assumir" — feio, mas
 *      compreensível. Com chave simbólica devolveria `inbox.claim`, que não é
 *      nada para ninguém.
 *
 * ─── Parcial, e de propósito ───────────────────────────────────────────────
 *
 * Só as telas do dia a dia. Traduzir as 229 telas de uma vez é um projeto, e um
 * projeto entregue pela metade deixa a interface em dois idiomas ao mesmo
 * tempo. O que não está aqui aparece em português, que é o comportamento de
 * antes desta feature — nunca pior.
 */
import type { Idioma } from "./idiomas";

/** `pt-BR` não aparece: é a chave. Só o que DIFERE precisa de linha. */
type Traducoes = Record<string, Partial<Record<Exclude<Idioma, "pt-BR">, string>>>;

export const DICIONARIO: Traducoes = {
  // ─── Cabeçalhos de grupo da barra lateral ───
  //
  // ⚠️ NUNCA TIVERAM TRADUÇÃO, e o defeito era invisível: `Sidebar.tsx:83` já
  // chamava `t(group.label)`, então o espanhol recebia os cabeçalhos em
  // português e nada ficava vermelho — `traduzir()` devolve a chave ausente
  // como está. Achado pelo cruzamento novo entre DICIONARIO e NAV_GROUPS.
  Atendimento: { es: "Atención" },
  CRM: { es: "CRM" },
  "Agente de IA": { es: "Agente de IA" },
  Canais: { es: "Canales" },
  Análise: { es: "Análisis" },
  Organização: { es: "Organización" },

  // ─── Navegação (a barra lateral, presente em toda tela) ───
  Inbox: { es: "Inbox" },
  Radar: { es: "Radar" },
  "Respostas rápidas": { es: "Respuestas rápidas" },
  Contatos: { es: "Contactos" },
  // A CHAVE É O TEXTO PT-BR, então renomear um rótulo no registro de navegação
  // sem mexer aqui NÃO quebra teste nenhum — degrada em silêncio: `traduzir()`
  // devolve a chave ausente como português e o espanhol da barra lateral some.
  // "Kanban" saiu do menu (a tela virou "Funis"); "Etapas do funil" é o nome novo
  // da tela de configuração, que antes disputava "Funis" com ela.
  Funis: { es: "Embudos" },
  "Etapas do funil": { es: "Etapas del embudo" },
  Agentes: { es: "Agentes" },
  "Follow-ups": { es: "Seguimientos" },
  Roteadores: { es: "Enrutadores" },
  "Ver tudo em IA": { es: "Ver todo en IA" },
  Conexões: { es: "Conexiones" },
  Webhooks: { es: "Webhooks" },
  Desempenho: { es: "Rendimiento" },
  "Evolução da IA": { es: "Evolución de la IA" },
  "Audit Log": { es: "Registro de auditoría" },
  Configurações: { es: "Configuración" },
  // ── citação (responder "em cima") ─────────────────────────────────────────
  "Cancelar resposta": { es: "Cancelar respuesta" },
  // A faixa da citação: quem escreveu a mensagem citada.
  Cliente: { es: "Cliente" },
  Você: { es: "Tú" },
  "(sem texto)": { es: "(sin texto)" },

  // ── Editor do agente (EPIC-13) — as três abas ─────────────────────────────
  "Conversa com o cliente": { es: "Conversa con el cliente" },
  "Organiza o sistema": { es: "Organiza el sistema" },
  "Confere antes de enviar": { es: "Verifica antes de enviar" },

  // ── Editor do agente — títulos de seção ───────────────────────────────────
  "Quem é este agente": { es: "Quién es este agente" },
  "As instruções dele": { es: "Sus instrucciones" },
  "A inteligência que ele usa": { es: "La inteligencia que usa" },
  "Empresa de inteligência artificial": { es: "Empresa de inteligencia artificial" },
  "Por qual número ele atende": { es: "Por qué número atiende" },
  "Número conectado": { es: "Número conectado" },
  "Quando ele entra em ação": { es: "Cuándo entra en acción" },
  "Estilo de resposta": { es: "Estilo de respuesta" },
  "O que o agente pode fazer": { es: "Qué puede hacer el agente" },
  "Passar para uma pessoa": { es: "Pasar a una persona" },
  "Pedir ajuda sem sair da conversa": { es: "Pedir ayuda sin salir de la conversación" },
  "Freios de segurança": { es: "Frenos de seguridad" },
  "Follow-up": { es: "Seguimiento" },

  // ── Capacidades (pacotes) ─────────────────────────────────────────────────
  "Atender e responder": { es: "Atender y responder" },
  "Vender e mover o funil": { es: "Vender y mover el embudo" },
  "Não perder o cliente": { es: "No perder al cliente" },
  "Passar para um humano": { es: "Pasar a un humano" },
  "Organizar a operação": { es: "Organizar la operación" },
  "Aprender e evoluir": { es: "Aprender y evolucionar" },
  "Só consulta": { es: "Solo consulta" },
  "Altera dados": { es: "Modifica datos" },
  "Efeito que não dá para desfazer": { es: "Efecto que no se puede deshacer" },

  // ── Os dez freios — rótulo ────────────────────────────────────────────────
  "Respeitar quem pediu para parar": { es: "Respetar a quien pidió parar" },
  "Respeitar dados apagados e a base legal": { es: "Respetar datos borrados y la base legal" },
  "Segurar o ritmo de envio": { es: "Controlar el ritmo de envío" },
  "Respeitar a janela do WhatsApp": { es: "Respetar la ventana de WhatsApp" },
  "Variar o texto das mensagens iguais": { es: "Variar el texto de los mensajes iguales" },
  "Não prometer preço ou prazo por conta própria": { es: "No prometer precio ni plazo por cuenta propia" },
  "Conferir promessas em texto livre": { es: "Verificar promesas en texto libre" },
  "Não prometer atendimento humano que não existe": { es: "No prometer atención humana que no existe" },
  "Não falar a nossa língua com o seu cliente": { es: "No hablar nuestra jerga con tu cliente" },
  "Dizer que é um assistente quando perguntam": { es: "Decir que es un asistente cuando le preguntan" },
  "Detectar tentativa de manipular o assistente": { es: "Detectar intentos de manipular al asistente" },

  // ── Os dez freios — o que protege ─────────────────────────────────────────
  "Se a pessoa respondeu STOP, SAIR ou pediu para não receber mais, nada é enviado a ela.":
    { es: "Si la persona respondió STOP, BAJA o pidió no recibir más, no se le envía nada." },
  "Contato anonimizado a pedido não recebe mensagem, e prospecção sem base legal não sai.":
    { es: "Un contacto anonimizado a pedido no recibe mensajes, y la prospección sin base legal no sale." },
  "Espaça as mensagens para o seu número não parecer robô e ser bloqueado pelo WhatsApp.":
    { es: "Espacia los mensajes para que tu número no parezca un robot y sea bloqueado por WhatsApp." },
  "Fora da janela de 24 horas, só modelo aprovado sai — é o que o próprio WhatsApp permite.":
    { es: "Fuera de la ventana de 24 horas solo sale plantilla aprobada — es lo que el propio WhatsApp permite." },
  "Evita mandar a mesma frase idêntica para muita gente, que é o padrão que denuncia disparo em massa.":
    { es: "Evita mandar la misma frase idéntica a mucha gente, que es el patrón que delata el envío masivo." },
  "Barra a mensagem em que o assistente inventa desconto, valor ou data de entrega.":
    { es: "Frena el mensaje en que el asistente inventa un descuento, un precio o una fecha de entrega." },
  "Uma segunda leitura, feita por um modelo, para pegar a promessa escrita de um jeito que a regra fixa não reconhece.":
    { es: "Una segunda lectura, hecha por un modelo, para atrapar la promesa escrita de una forma que la regla fija no reconoce." },
  "Barra nome de ferramenta, nome de tabela e código de erro na mensagem que o cliente lê.":
    { es: "Frena nombres de herramientas, de tablas y códigos de error en el mensaje que lee el cliente." },
  "Se o cliente pergunta se está falando com um robô, a resposta não pode enganar.":
    { es: "Si el cliente pregunta si habla con un robot, la respuesta no puede engañar." },
  "Lê a mensagem que chega e reconhece quem está tentando fazer o assistente ignorar as suas instruções.":
    { es: "Lee el mensaje que llega y reconoce a quien intenta hacer que el asistente ignore sus instrucciones." },

  // ── Os dez freios — por que não se desliga ────────────────────────────────
  "Quem pediu para parar tem o direito de ser deixado em paz — e insistir é infração, não estratégia.":
    { es: "Quien pidió parar tiene derecho a que lo dejen en paz — insistir es infracción, no estrategia." },
  "É obrigação legal. Apagar dados é irreversível por desenho, e escrever para quem foi apagado desfaria isso.":
    { es: "Es obligación legal. Borrar datos es irreversible por diseño, y escribirle a quien fue borrado lo desharía." },
  "É o que impede seu número de ser bloqueado — e o número é o seu negócio.":
    { es: "Es lo que impide que bloqueen tu número — y el número es tu negocio." },
  "Quem impõe é o WhatsApp, não nós. Desligar aqui não libera nada: a mensagem seria recusada lá, ou cobrada.":
    { es: "Lo impone WhatsApp, no nosotros. Apagarlo acá no libera nada: el mensaje sería rechazado allá, o cobrado." },
  "Texto idêntico em massa é o gatilho de spam do WhatsApp — mesmo risco do ritmo de envio.":
    { es: "Texto idéntico en masa es el disparador de spam de WhatsApp — el mismo riesgo que el ritmo de envío." },
  "Uma promessa escrita obriga o seu negócio. A conferência é uma regra fixa, não custa nada e não tem troca a oferecer.":
    { es: "Una promesa escrita obliga a tu negocio. La verificación es una regla fija, no cuesta nada y no hay nada que negociar." },
  "É promessa que só você pode cumprir, e o cliente fica esperando. Regra fixa, sem custo.":
    { es: "Es una promesa que solo vos podés cumplir, y el cliente queda esperando. Regla fija, sin costo." },
  "É a conferência que derrubou o vazamento medido de 30% para zero. Desligar reabre exatamente o defeito que ela fechou.":
    { es: "Es la verificación que bajó la fuga medida del 30% a cero. Apagarla reabre exactamente el defecto que cerró." },
  "Esconder que é um assistente é enganar o cliente.":
    { es: "Ocultar que es un asistente es engañar al cliente." },
  Recolher: { es: "Contraer" },
  Buscar: { es: "Buscar" },

  // ─── Inbox: filtros e lista ───
  "Buscar mensagens…": { es: "Buscar mensajes…" },
  "Todos os números": { es: "Todos los números" },
  "Todas as tags": { es: "Todas las etiquetas" },
  "Apenas não lidos": { es: "Solo no leídos" },
  Fila: { es: "Cola" },
  Minhas: { es: "Mías" },
  Todas: { es: "Todas" },
  Fechadas: { es: "Cerradas" },
  IA: { es: "IA" },
  "Sem mensagens": { es: "Sin mensajes" },
  "Nenhuma conversa": { es: "Ninguna conversación" },

  // ─── Inbox: cabeçalho e ações da conversa ───
  Assumir: { es: "Asumir" },
  Liberar: { es: "Liberar" },
  Transferir: { es: "Transferir" },
  Lembrar: { es: "Recordar" },
  Fechar: { es: "Cerrar" },
  "Devolver ao automático": { es: "Devolver al automático" },
  Aberta: { es: "Abierta" },
  Fechada: { es: "Cerrada" },
  "Em atendimento": { es: "En atención" },
  "Aguardando atendente": { es: "Esperando agente" },
  "Automático pausado": { es: "Automático pausado" },
  "Ver contato": { es: "Ver contacto" },

  // ─── Inbox: composer ───
  Responder: { es: "Responder" },
  "Nota interna": { es: "Nota interna" },
  "Escreva uma mensagem…": { es: "Escribí un mensaje…" },
  "Escreva uma nota interna… (só o time vê)": {
    es: "Escribí una nota interna… (solo la ve el equipo)",
  },
  Enviar: { es: "Enviar" },
  "Enviar modelo": { es: "Enviar plantilla" },
  "Escolha um modelo aprovado…": { es: "Elegí una plantilla aprobada…" },

  // ─── Painel do contato ───
  CONTATO: { es: "CONTACTO" },
  "TAGS DA CONVERSA": { es: "ETIQUETAS DE LA CONVERSACIÓN" },
  "DEMANDAS ABERTAS": { es: "PEDIDOS ABIERTOS" },
  "LEADS RECENTES": { es: "LEADS RECIENTES" },
  "PEDIDOS RECENTES": { es: "PEDIDOS RECIENTES" },
  ATIVIDADE: { es: "ACTIVIDAD" },
  "Sem tags.": { es: "Sin etiquetas." },
  "Sem leads.": { es: "Sin leads." },
  "Sem pedidos.": { es: "Sin pedidos." },
  "Sem atividade.": { es: "Sin actividad." },
  "Nova tag…": { es: "Nueva etiqueta…" },
  "Sem próximo passo definido": { es: "Sin próximo paso definido" },
  "Marcar próximo passo": { es: "Marcar próximo paso" },
  Lead: { es: "Lead" },
  Tag: { es: "Etiqueta" },

  // ─── Kanban ───
  "Apenas atrasados": { es: "Solo atrasados" },
  "Sem responsável": { es: "Sin responsable" },
  "Editar campos": { es: "Editar campos" },
  "Linha do tempo": { es: "Línea de tiempo" },
  "DADOS DO NEGÓCIO": { es: "DATOS DEL NEGOCIO" },
  Título: { es: "Título" },
  Descrição: { es: "Descripción" },
  "Fechamento previsto": { es: "Cierre previsto" },
  "Tags (separadas por vírgula)": { es: "Etiquetas (separadas por coma)" },
  Salvar: { es: "Guardar" },
  vazio: { es: "vacío" },
  "Abrir conversa no Inbox": { es: "Abrir conversación en el Inbox" },

  // ─── Contatos ───
  "Buscar contatos…": { es: "Buscar contactos…" },
  Nome: { es: "Nombre" },
  Telefone: { es: "Teléfono" },
  "Nenhum contato": { es: "Ningún contacto" },
  Bloqueado: { es: "Bloqueado" },

  // ─── Conexões ───
  "Números por QR": { es: "Números por QR" },
  "API Oficial (Meta)": { es: "API Oficial (Meta)" },
  "Provedor parceiro": { es: "Proveedor asociado" },
  Conexão: { es: "Conexión" },
  "Modelos do parceiro": { es: "Plantillas del asociado" },
  "Templates da Meta": { es: "Plantillas de Meta" },
  Sincronizar: { es: "Sincronizar" },
  "Criar modelo": { es: "Crear plantilla" },
  Cancelar: { es: "Cancelar" },
  "Enviar para revisão": { es: "Enviar a revisión" },
  Reconectar: { es: "Reconectar" },
  Conectar: { es: "Conectar" },
  Desconectar: { es: "Desconectar" },
  "Fuso horário da janela": { es: "Huso horario de la ventana" },

  // ─── Estados e avisos que aparecem em várias telas ───
  "Carregando…": { es: "Cargando…" },
  "Nenhum resultado": { es: "Ningún resultado" },
  Erro: { es: "Error" },
  Excluir: { es: "Eliminar" },
  Editar: { es: "Editar" },
  Voltar: { es: "Volver" },
};

/**
 * Traduz, ou devolve o próprio texto.
 *
 * Nunca lança e nunca devolve vazio: um texto sem tradução aparece em
 * português, que é exatamente o comportamento de antes desta feature. Uma
 * tradução parcial não pode deixar a tela PIOR do que estava.
 */
export function traduzir(texto: string, idioma: Idioma): string {
  if (idioma === "pt-BR") return texto;
  return DICIONARIO[texto]?.[idioma] ?? texto;
}
