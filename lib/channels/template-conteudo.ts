/**
 * O CONTEÚDO de uma definição aprovada, legível.
 *
 * ─── Por que existe ────────────────────────────────────────────────────────
 *
 * A lista mostrava só nome, idioma e estado. Ver "APPROVED" sem ver o texto
 * obriga o operador a abrir a plataforma para saber o que a definição diz — e é
 * o texto que ele precisa para escolher qual mandar.
 *
 * ─── E por que os EXEMPLOS têm caso próprio ────────────────────────────────
 *
 * Medido no contrato da plataforma: o corpo aceita `{{n}}`, e o `example` com
 * valores de amostra é o que a revisão exige. Uma definição com variável e SEM
 * exemplo é recusada — e a recusa chega horas depois, sem que ninguém ligue uma
 * coisa à outra.
 *
 * Foi exatamente o que o formulário fazia: deixava digitar `{{1}}` e não
 * coletava o exemplo. Rejeição garantida, por omissão da nossa tela.
 */

type Bruto = Record<string, unknown>;

const obj = (v: unknown): Bruto | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Bruto) : null;
const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

export interface ConteudoDaDefinicao {
  header: { formato: string; texto: string | null } | null;
  body: string | null;
  footer: string | null;
  botoes: { tipo: string; texto: string }[];
  /** Quantos `{{n}}` o corpo declara — o que o envio vai precisar preencher. */
  variaveis: number;
}

/**
 * Lê o payload cru como a plataforma o devolveu.
 *
 * Tolerante a caixa (`BODY` e `body` convivem: a leitura vem da Meta em
 * maiúsculas, a escrita do intermediário em minúsculas) e a campo ausente —
 * uma definição sem rodapé é normal, não erro.
 */
export function lerConteudo(components: unknown): ConteudoDaDefinicao {
  const lista = Array.isArray(components) ? components : [];
  const vazio: ConteudoDaDefinicao = {
    header: null,
    body: null,
    footer: null,
    botoes: [],
    variaveis: 0,
  };

  for (const bruto of lista) {
    const c = obj(bruto);
    if (!c) continue;
    const tipo = (str(c.type) ?? "").toUpperCase();

    if (tipo === "HEADER") {
      vazio.header = {
        formato: (str(c.format) ?? "TEXT").toUpperCase(),
        texto: str(c.text),
      };
    } else if (tipo === "BODY") {
      vazio.body = str(c.text);
    } else if (tipo === "FOOTER") {
      vazio.footer = str(c.text);
    } else if (tipo === "BUTTONS") {
      const bts = Array.isArray(c.buttons) ? c.buttons : [];
      for (const b of bts) {
        const o = obj(b);
        if (!o) continue;
        vazio.botoes.push({
          tipo: (str(o.type) ?? "").toUpperCase(),
          texto: str(o.text) ?? "",
        });
      }
    }
  }

  vazio.variaveis = contarVariaveis(vazio.body ?? "");
  return vazio;
}

/**
 * Quantos `{{n}}` distintos o texto usa.
 *
 * DISTINTOS, e pelo MAIOR índice: um texto que repete `{{1}}` duas vezes pede
 * um valor, não dois — e um que usa `{{1}}` e `{{3}}` pede três, porque a
 * plataforma numera por posição e recusa a lista com buracos.
 */
export function contarVariaveis(texto: string): number {
  const achados = [...texto.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]));
  return achados.length === 0 ? 0 : Math.max(...achados);
}

/**
 * Monta os `components` de uma definição nova, com os exemplos que a revisão
 * exige.
 *
 * `example.body_text` é ARRAY DE ARRAYS — o formato do contrato, um conjunto de
 * amostras por variável. Mandar um array simples é recusado, e a mensagem de
 * erro não diz qual dos dois formatos ela queria.
 */
export function montarComponents(input: {
  body: string;
  footer?: string | null;
  exemplos: string[];
}): unknown[] {
  const n = contarVariaveis(input.body);
  const components: unknown[] = [];

  const corpo: Bruto = { type: "BODY", text: input.body };
  if (n > 0) {
    // Preenche o que faltar com um marcador: o exemplo VAZIO é recusado pela
    // revisão, e um campo em branco esquecido no formulário não pode virar uma
    // recusa que só aparece horas depois.
    const amostras = Array.from({ length: n }, (_, i) => input.exemplos[i]?.trim() || "exemplo");
    corpo.example = { body_text: [amostras] };
  }
  components.push(corpo);

  const rodape = input.footer?.trim();
  if (rodape) components.push({ type: "FOOTER", text: rodape });

  return components;
}
