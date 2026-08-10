/**
 * COMO SE CHAMA ESTA PESSOA NA TELA — uma decisão, um lugar.
 *
 * ═══ POR QUE CENTRALIZAR ═══
 *
 * A mesma cadeia `display_name || name || phone_number || <literal>` estava
 * copiada em **seis** arquivos, com **quatro** finais diferentes (`Sem nome`,
 * `Contato sem nome`, `—`, `—`) e duas variações de conteúdo: a ficha do contato
 * e a tabela de contatos **não usavam o telefone**, então quem tinha número mas
 * não tinha nome aparecia como "Sem nome" numa tela e com o número em outra.
 *
 * Seis cópias não divergem por descuido — divergem porque cada tela nova
 * reescreve a cadeia do jeito que parece certo naquele arquivo. A sétima ia
 * nascer com um quinto final.
 *
 * ═══ A REGRA QUE NENHUMA DELAS TINHA ═══
 *
 * **Identificador técnico não é nome de gente.** `Contato 543134@lid` esteve na
 * tela do atendente da produção; o produtor daquela string morreu, mas o dado
 * ficou, e o passo seguinte da spec 17 vai LER o nome do contato para escrever o
 * título do card no kanban — sem esta guarda, o resíduo vaza para o quadro.
 *
 * E o consumidor não é só humano: `lib/ai/render-system-prompt.ts` põe o nome do
 * contato no prompt do modelo. Um rótulo técnico ali é a mesma doença que a spec
 * 16 mediu em 30% dos turnos — vocabulário de máquina chegando ao cliente.
 */

/** O que qualquer tela precisa saber para chamar alguém pelo nome. */
export interface ContatoNomeavel {
  display_name?: string | null;
  name?: string | null;
  phone_number?: string | null;
}

/** Quando não há nada apresentável. Um literal, não quatro. */
export const SEM_NOME = "Sem nome";

/**
 * Cheira a identificador de máquina?
 *
 * Conservador de propósito: recusar um nome legítimo é pior que deixar passar um
 * técnico, porque o primeiro apaga a identidade de uma pessoa real. Por isso as
 * âncoras — `Contato 5431` sai, `Contato Comercial da Loja` fica.
 */
export function ehIdentificadorTecnico(valor: string): boolean {
  const v = valor.trim();
  if (v === "") return true;
  // Sufixos de endereçamento do WhatsApp em qualquer posição.
  if (/@(lid|c\.us|s\.whatsapp\.net|g\.us)\b/i.test(v)) return true;
  // O rótulo que o código antigo inventava: "Contato " + dígitos, e só isso.
  if (/^contato\s+\d+$/i.test(v)) return true;
  // Só dígitos e longo demais para ser apelido — é id, não nome. Telefone
  // formatado (com +, espaço ou hífen) NÃO cai aqui: ele é um rótulo útil e tem
  // caminho próprio abaixo.
  if (/^\d{9,}$/.test(v)) return true;
  return false;
}

/**
 * O rótulo. Primeiro o que uma pessoa escolheu, depois o que o canal informou,
 * depois o número — e só então a admissão de que não se sabe o nome.
 *
 * O telefone NÃO é reformatado: ele já é gravado em E.164 e é o mesmo texto que
 * o atendente copia para ligar ou buscar. Embelezá-lo aqui mudaria um rótulo
 * visível sem que ninguém tenha pedido.
 */
export function rotuloDoContato(c: ContatoNomeavel | null | undefined): string {
  if (!c) return SEM_NOME;

  const candidatos = [c.display_name, c.name];
  for (const bruto of candidatos) {
    const v = (bruto ?? "").trim();
    if (v !== "" && !ehIdentificadorTecnico(v)) return v;
  }

  const tel = (c.phone_number ?? "").trim();
  // O telefone escapa da recusa acima de propósito: "5531988887777" é
  // identificador para a regra de nome, e é informação ÚTIL para quem atende —
  // muito melhor que "Sem nome".
  if (tel !== "") return tel;

  return SEM_NOME;
}
