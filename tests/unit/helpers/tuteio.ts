/**
 * O DETECTOR DE TUTEIO do espanhol da tela — usado pela cerca
 * `tests/unit/i18n-espanhol-trata-por-usted.test.ts`.
 *
 * Mede formas típicas, não gramática: pronomes e possessivos de «tú», verbos em
 * 2ª pessoa que não se confundem com a 3ª, enclíticos de imperativo e o voseo.
 * O imperativo regular de «tú» («Revisa», «Conecta») é IGUAL à 3ª pessoa do
 * presente, e a 3ª pessoa é como o produto descreve as próprias funções
 * («Revisa atenciones ya concluidas…»): por isso ele só conta no INÍCIO de
 * frase e com os verbos da lista abaixo. Os casos de controle da cerca provam
 * que cada família detecta e que a forma de usted passa.
 *
 * Só depende de si mesmo (nada de pacote nem de módulo do produto): a cerca que
 * o importa fica na seleção de `pnpm cercas`.
 */

/** Fronteira de palavra que entende acento (o `\b` do JS não entende). */
const LETRA = String.raw`\p{L}\p{N}_`;
const palavra = (alternativas: string, flags = "iu") =>
  new RegExp(String.raw`(?<![${LETRA}])(?:${alternativas})(?![${LETRA}])`, flags);

/** Início de frase: começo do texto ou depois de pontuação que abre frase. */
const INICIO = String.raw`(?:^|[.!?:;…\n—(«“"¿¡]\s*|\s—\s)`;

/** Usted dos verbos em -er/-ir com enclítico: terminam como o tú dos verbos em -ar. */
const USTED_ER_IR = [
  "escríbalo|escríbala|escríbalos|escríbalas|escríbanos|escríbale|pídale|pídalo|pídasela|pídaselo",
  "ábralo|ábrala|ábralos|súbalo|súbala|súbalos|elíjalo|elíjala|léalo|léala|léalos|compártalo",
  "compártala|cúmplala|restrínjala|suspéndalo|omítalo|defínalo|defínala|resuélvalo|asúmala",
  "asúmalo|muévalo|muévala|vuélvalo|póngalo|póngale|póngala|hágalo|hágala|dígale|dígame",
  "téngalo|téngala|tráigalo|sígalo|sígala|añádalo|añádala|recíbalo|descríbalo|descríbala",
  "inclúyalo|inclúyala|corríjalo|corríjala|escójalo|escójala|sepárelas|elíjalas|elíjalos",
  "ábralas|súbalas|léalas|cuéntenos|cuénteme|díganos|pregúntele|permítale|añádalos",
  "viértalo|conviértalo|conviértala|distribúyalo|reconózcalo|ofrézcale|conózcalo|introdúzcalo",
  "tradúzcalo|redúzcalo|reprodúzcalo|sustitúyalo|devuélvalo|devuélvala|envuélvalo|bárralo",
].join("|");

export const FORMAS: { familia: string; padrao: RegExp }[] = [
  { familia: "pronome tú/ti/contigo", padrao: palavra("tú|contigo") },
  // `ti` só em minúscula: «TI» é a sigla de tecnologia da informação.
  { familia: "pronome ti", padrao: palavra("ti", "u") },
  { familia: "possessivo tu/tus/tuyo", padrao: palavra("tu|tus|tuyo|tuya|tuyos|tuyas") },
  { familia: "pronome te", padrao: palavra("te") },
  {
    familia: "verbo em 2ª pessoa",
    padrao: palavra(
      [
        // presente (fora: «activas», «completas», «llenas», «marcas», «cargas», «guardas», «pegas»
        // e «sales», que também são adjetivo ou substantivo)
        "tienes|puedes|quieres|necesitas|debes|sabes|estás|eres|haces|prefieres|deseas|ves|vas|das",
        "sigues|recibes|envías|usas|has|vuelves|pierdes|encuentras|escribes|eliges|cambias|creas",
        "crees|desactivas|conectas|configuras|intentas|olvidas|abres|cierras|decides|revisas|entras",
        "confirmas|borras|apruebas|dejas|registras|instalas|comparas|buscas|explicas|envías|confías",
        "cobras|mantienes|avisas|ofreces|validas|ingresas|defines|arrastras|contratas|informas",
        "publicas|adoptas|subes|indicas|reemplazas|corres|habilitas|distribuyes|restringes",
        "respondes|quedas|atiendes|apuntas|mandas|sospechas|comprometes|alojas|consigues|editas",
        "reconoces|accedes|autorizas|pones|conoces|reutilizas|vendes|administras|dedicas|continúas",
        "contactas|tomas|piensas|llegas|logras|ganas|pagas|programas|recuerdas|eliminas",
        // subjuntivo
        "quieras|puedas|tengas|necesites|uses|olvides|cierres|hagas|elijas|vuelvas|sepas|estés|seas",
        "prefieras|desees|escribas|envíes|recibas|pierdas|intentes|cambies|borres|elimines|actives",
        "desactives|conectes|configures|guardes|salgas|vayas|pongas|dejes|toques|marques|hayas|veas",
        "inicies|decidas|revises|compartas|autorices|pegues|registres|termines|apruebes|habilites",
        "publiques|tomes|interpretes|reactives|pidas|contrates|actúes|programes|confíes|verifiques",
        "liberes|prepares|definas|subas|fueras|completes|agregues|edites|crees|actualices|leas",
        // imperfeito e condicional
        "ibas|estabas|tenías|querías|podías|habías|decidías|intentabas|mirabas|esperabas",
        "tendrías|podrías|deberías|querrías|preferirías|harías|explicarías|probarías|hablarías",
      ].join("|"),
    ),
  },
  // Futuro e pretérito de «tú» têm terminação própria («podrás», «creaste», «definiste»); fora
  // as palavras que só terminam igual.
  {
    familia: "futuro de tú",
    padrao: palavra(String.raw`(?!(?:atrás|detrás)(?![${LETRA}]))\p{L}{2,}rás`),
  },
  {
    familia: "pretérito de tú",
    padrao: palavra(
      String.raw`(?!(?:contraste|desgaste|engaste|traste|existe|coexiste|preexiste|insiste|consiste|resiste|asiste|persiste|subsiste|desiste|viste|reviste|chiste|despiste|triste)(?![${LETRA}]))\p{L}{2,}(?:aste|iste)`,
    ),
  },
  {
    familia: "imperativo ou enclítico de tú",
    padrao: palavra(
      [
        "haz|hazlo|pon|ponlo|ponle|ten|tenlo|mantén|obtén|dale|dime|dímelo|sal",
        // enclíticos de verbos em -er/-ir (os de -ar a regra genérica abaixo pega)
        "escríbelo|escríbela|pídele|pídelo|pídeselo|ábrelo|ábrela|súbelo|súbela|elígelo|elígela",
        "léelo|léela|compártelo|compártela|cúmplela|cúmplelo|restríngela|suspéndelo|omítelo",
        "defínelo|defínela|resuélvelo|asúmela|asúmelo|muévelo|muévela|vuélvelo|elimínalo",
        "cuéntanos|cuéntame|escríbenos|escríbeme|avísanos|avísame|llámanos|contáctanos",
      ].join("|"),
    ),
  },
  // Enclítico no imperativo de «tú» dos verbos em -ar: «Inténtalo», «Revísalos», «Reconéctalo».
  // O de usted troca o «a» por «e» («Inténtelo»); quem acaba igual é o de usted dos verbos em
  // -er/-ir («Escríbalo», «Pídale»), e é essa lista que fica de fora.
  {
    familia: "enclítico de imperativo de tú (-ar)",
    padrao: palavra(
      String.raw`(?!(?:${USTED_ER_IR})(?![${LETRA}]))\p{L}*[áéíóú]\p{L}*a(?:lo|la|los|las|le|les|me|nos|selo|sela|selos|selas)`,
    ),
  },
  // Reflexivo de imperativo: «asegúrate», «regístrate», «suscríbete». O de usted acaba em «-ese».
  { familia: "imperativo reflexivo de tú", padrao: palavra(String.raw`\p{L}*[áéíóú]\p{L}*(?:ate|ete)`) },
  // Infinitivo e gerúndio com «te»: «para conectarte», «ayudándote». O de usted leva «se»/«le».
  {
    familia: "infinitivo ou gerúndio com te",
    padrao: palavra(
      // As palavras que acabam em «-arte/-erte» sem serem verbo: «aparte», «comparte» (3ª pessoa), «suerte»…
      String.raw`(?!(?:aparte|comparte|reparte|contraparte|departe|estandarte|baluarte|descarte|encarte|suerte|fuerte|muerte|inerte)(?![${LETRA}]))\p{L}{2,}(?:ar|(?<![iu])er|ir|ár|ér|ír)te|\p{L}+(?:ándote|iéndote|éndote)`,
    ),
  },
  {
    familia: "voseo",
    padrao: palavra(
      [
        "vos|tenés|podés|querés|sabés|hacés|necesitás|pasás|fijate|mirá|confirmá|revisá|tocá",
        "usá|conectá|ingresá|completá|esperá|intentá|probá|andá|cambiá|elegí|abrí|escribí",
        "cambiala|eliminala|cambialo|eliminalo|elegilo|elegila",
      ].join("|"),
    ),
  },
];

/**
 * O imperativo regular de «tú» é a 3ª pessoa do presente («Revisa los datos» é
 * ordem; «Revisa atenciones ya concluidas» é a descrição de uma função). Quem
 * desempata é a CHAVE em português, que é o texto original: lá a ordem a
 * «você» tem forma própria («Revise», «Confira», «Escolha») e a descrição não
 * («Revisa», «Confere», «Escolhe»). O imperativo só conta quando as duas frases
 * na mesma posição começam por ordem.
 */
const IMPERATIVO_ES = [
  "Elige|Escoge|Selecciona|Marca|Desmarca|Revisa|Verifica|Comprueba|Consulta|Busca|Encuentra",
  "Mira|Observa|Lee|Escribe|Ingresa|Introduce|Indica|Informa|Llena|Rellena|Completa|Espera",
  "Vuelve|Intenta|Reintenta|Prueba|Recarga|Actualiza|Usa|Utiliza|Abre|Cierra|Toca|Pulsa|Presiona",
  "Agrega|Añade|Incluye|Crea|Genera|Copia|Pega|Guarda|Cambia|Ajusta|Edita|Renombra|Elimina",
  "Borra|Quita|Saca|Envía|Reenvía|Manda|Sube|Descarga|Instala|Conecta|Desconecta|Reconecta",
  "Vincula|Activa|Desactiva|Reactiva|Habilita|Deshabilita|Enciende|Apaga|Confirma|Acepta",
  "Aprueba|Rechaza|Descarta|Cancela|Avisa|Contacta|Habla|Llama|Pide|Solicita|Pregunta|Responde",
  "Sigue|Continúa|Reinicia|Limpia|Recuerda|Desbloquea|Corrige|Asigna|Mueve|Arrastra|Suelta",
  "Define|Configura|Entra|Accede|Inicia|Empieza|Comienza|Termina|Finaliza|Importa|Exporta",
  "Publica|Comparte|Describe|Explica|Evita|Deja|Pasa|Lleva|Cuenta|Organiza|Paga|Registra",
  "Escanea|Abre|Repite|Renueva|Sincroniza|Autoriza|Programa|Agenda|Muestra|Ten|Pon|Haz|Di|Ve",
].join("|");

const IMPERATIVO_PT = [
  "Escolha|Selecione|Marque|Desmarque|Revise|Verifique|Confira|Cheque|Consulte|Busque|Procure",
  "Pesquise|Encontre|Veja|Olhe|Observe|Leia|Escreva|Digite|Informe|Insira|Indique|Preencha",
  "Complete|Aguarde|Espere|Volte|Retorne|Tente|Experimente|Recarregue|Atualize|Use",
  "Utilize|Abra|Feche|Toque|Clique|Pressione|Aperte|Adicione|Acrescente|Inclua|Crie|Gere|Copie",
  "Cole|Salve|Guarde|Troque|Mude|Altere|Ajuste|Edite|Renomeie|Exclua|Apague|Remova|Tire",
  "Envie|Mande|Reenvie|Suba|Carregue|Baixe|Instale|Conecte|Desconecte|Reconecte|Vincule|Ative",
  "Desative|Reative|Religue|Ligue|Desligue|Habilite|Desabilite|Confirme|Aceite|Aprove|Recuse",
  "Rejeite|Descarte|Cancele|Avise|Contate|Fale|Chame|Peça|Solicite|Pergunte|Responda|Siga",
  "Continue|Reinicie|Limpe|Lembre|Desbloqueie|Corrija|Atribua|Mova|Arraste|Solte|Defina",
  "Configure|Acesse|Inicie|Comece|Termine|Finalize|Importe|Exporte|Publique|Compartilhe",
  "Descreva|Explique|Evite|Deixe|Passe|Conte|Organize|Pague|Cadastre|Registre|Escaneie",
  "Repita|Renove|Sincronize|Autorize|Programe|Agende|Mostre|Tenha|Ponha|Coloque|Faça|Diga|Vá",
  "Mantenha|Obtenha|Dê|Garanta|Certifique-se|Lembre-se",
].join("|");

// Onde a frase termina, e onde começa uma oração dentro dela («Después, abre…», «y pega…»).
const FIM_DE_FRASE = /[.!?:;…]\s+|\n|\s—\s/gu;
const FIM_DE_ORACAO = /[.!?:;…]\s+|\n|\s[–—]\s+|,\s+|\s(?:y|e|o|ou)\s+/giu;
// Parêntese e aspas ficam de fora: lá dentro mora rótulo de botão e aparte em 3ª pessoa
// («(empieza con whsec_)», «“Revisa antes de enviar”»).
const ABRE_ORDEM = String.raw`(?:^|[.!?:;…\n¿¡]\s*|\s[–—]\s+|,\s+|\s(?:y|e|o|ou)\s+)`;
const ordem = (verbos: string) => new RegExp(String.raw`${ABRE_ORDEM}(?:${verbos})(?![${LETRA}])`, "giu");
const ORDEM_ES = ordem(IMPERATIVO_ES);
const ORDEM_PT = ordem(IMPERATIVO_PT);

interface Ordens {
  frases: Set<number>;
  oracoes: Set<number>;
  totalDeFrases: number;
  totalDeOracoes: number;
  achado: string;
}

/** Em que frases e orações (0, 1, 2…) uma ordem abre o trecho. */
function ordensEm(texto: string, padrao: RegExp): Ordens {
  const fins = (re: RegExp) => [...texto.matchAll(re)].map((m) => m.index! + m[0].length);
  const fimDeFrase = fins(FIM_DE_FRASE);
  const fimDeOracao = fins(FIM_DE_ORACAO);
  const ordens: Ordens = {
    frases: new Set(),
    oracoes: new Set(),
    totalDeFrases: fimDeFrase.length + 1,
    totalDeOracoes: fimDeOracao.length + 1,
    achado: "",
  };
  for (const m of texto.matchAll(padrao)) {
    const verbo = m.index! + m[0].length;
    ordens.frases.add(fimDeFrase.filter((fim) => fim < verbo).length);
    ordens.oracoes.add(fimDeOracao.filter((fim) => fim < verbo).length);
    ordens.achado ||= m[0].trim();
  }
  return ordens;
}

const cruza = (a: Set<number>, b: Set<number>) => [...a].some((i) => b.has(i));

/** O espanhol abre frase (ou oração) com ordem de «tú» onde o português abre com ordem a «você»? */
function imperativoDeTu(es: string, pt: string): string | null {
  const noEs = ordensEm(es, ORDEM_ES);
  if (noEs.frases.size === 0) return null;
  const noPt = ordensEm(pt, ORDEM_PT);
  if (noPt.frases.size === 0) return null;
  // As duas línguas cortadas igual: a ordem tem de estar no MESMO pedaço dos dois lados.
  if (noEs.totalDeOracoes === noPt.totalDeOracoes) return cruza(noEs.oracoes, noPt.oracoes) ? noEs.achado : null;
  if (noEs.totalDeFrases === noPt.totalDeFrases) return cruza(noEs.frases, noPt.frases) ? noEs.achado : null;
  return noEs.achado;
}

/**
 * As formas de tuteio que o texto tem (vazio = trata por usted ou não fala com ninguém).
 *
 * `pt` é a chave do dicionário — o original em português. Sem ele, o imperativo
 * regular de «tú» não é medido (só as outras famílias).
 */
export function tuteioEm(texto: string, pt?: string): string[] {
  const achados: string[] = [];
  for (const { familia, padrao } of FORMAS) {
    const m = padrao.exec(texto);
    if (m) achados.push(`${familia}: «${m[0].trim()}»`);
  }
  const ordem = pt === undefined ? null : imperativoDeTu(texto, pt);
  if (ordem) achados.push(`imperativo de tú no início da frase: «${ordem}»`);
  return achados;
}
