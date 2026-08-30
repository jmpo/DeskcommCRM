/**
 * A BUSCA DE CONTATO PROCURA PELO NOME QUE A TELA MOSTRA.
 *
 * ⚠️ ESTE TESTE NASCEU DE UM TURNO DE AGENTE REAL, não de uma revisão de código.
 * Pedido para marcar um retorno para "Cliente Retorno E2E", o modelo chamou
 * `crm_search_contacts`, recebeu zero resultados para um contato que EXISTE, e
 * desistiu — "pode ser necessário adicionar o cliente ao CRM". A demanda morreria
 * ali, e o motivo era uma coluna faltando no `OR` da busca.
 *
 * Contato que entra pelo WhatsApp nasce só com `display_name` (o pushName do
 * aparelho); `name` fica nulo até alguém editar à mão. A UI inteira prefere
 * `display_name` (ver `resolveContactName`). A busca olhava só `name`, `email` e
 * `phone_number` — ou seja, ignorava justamente o nome que a pessoa lê na tela e
 * digita no campo de busca.
 *
 * O teste é sobre o FILTRO montado, não sobre o resultado do banco: é a decisão
 * que estava errada, e é ela que precisa ficar vigiada.
 */
import { describe, expect, it } from "vitest";

import { listContactsHandler } from "@/app/api/v1/contacts/_handler";

const ORG = "11111111-1111-4111-8111-111111111111";

/** Client mínimo que só guarda o filtro `.or()` que o handler montou. */
function supabaseEspiao() {
  const filtros: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    contains: () => chain,
    or: (expr: string) => {
      filtros.push(expr);
      return chain;
    },
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res),
  };
  return { client: { from: () => chain } as never, filtros };
}

async function filtroDaBusca(termo: string): Promise<string> {
  const { client, filtros } = supabaseEspiao();
  await listContactsHandler(
    client,
    { organization_id: ORG, actor: { type: "user", id: "u-1" }, requestId: "req" },
    { search: termo, limit: 20 },
  );
  return filtros[0] ?? "";
}

describe("busca de contatos", () => {
  it("procura no display_name — o nome que a tela mostra e o WhatsApp preenche", async () => {
    const filtro = await filtroDaBusca("Cliente Retorno");
    expect(filtro).toContain("display_name.ilike.%Cliente Retorno%");
  });

  it("continua procurando nas colunas que já procurava", async () => {
    // A adição não pode custar as outras: quem cadastrou o contato à mão tem
    // `name`, e quem digita telefone espera achar por telefone.
    const filtro = await filtroDaBusca("Maria");
    for (const coluna of ["name.ilike", "email.ilike", "phone_number.ilike"]) {
      expect(filtro).toContain(coluna);
    }
  });

  it("nome com vírgula não injeta condição extra no filtro", async () => {
    // `,` separa condições no DSL do `.or()`. Sem escape, "Silva, Maria" vira
    // duas condições e a busca devolve gente que ninguém pediu.
    const filtro = await filtroDaBusca("Silva, Maria");
    expect(filtro).not.toContain("Silva,");
    expect(filtro).toContain("Silva  Maria");
  });

  it("curinga do LIKE digitado pelo usuário é literal, não coringa", async () => {
    const filtro = await filtroDaBusca("100%");
    expect(filtro).toContain("100\\%");
  });

  it("busca o celular também pela grafia com o nono — senão o cadastro some", async () => {
    // Quem cola +553284793302 tem que achar o contato gravado como +5532984793302.
    const filtro = await filtroDaBusca("3284793302");
    expect(filtro).toContain("phone_number.ilike.%5532984793302%");
  });
});
