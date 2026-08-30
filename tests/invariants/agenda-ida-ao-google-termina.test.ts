import { execFileSync } from "node:child_process";

import { beforeAll, describe, expect, it } from "vitest";

/**
 * A IDA AO GOOGLE COMEÇA — E TERMINA.
 *
 * ═══ O defeito, medido em produção ═══════════════════════════════════════════
 * `agenda-google-push` pedia os pendentes com
 * `.or("google_synced_at.is.null,updated_at.gt.google_synced_at")`. O PostgREST
 * trata o lado DIREITO de `gt.` como VALOR LITERAL, então ele tentava converter
 * a string "google_synced_at" em `timestamptz` e recusava a consulta INTEIRA:
 *
 *   invalid input syntax for type timestamp with time zone: "google_synced_at"
 *
 * um `warn` a cada 5 minutos desde o deploy da v1.7.0, zero linhas lidas. A ida
 * ao Google nunca aconteceu em instalação nenhuma.
 *
 * ═══ Por que o teste unitário existente ficou verde ══════════════════════════
 * `tests/unit/agenda-google-push-worker.test.ts` usa dublê que aceita qualquer
 * string de filtro — ele guarda a CHAMADA, não o EFEITO. Uma string que o
 * Postgres recusa é, para o dublê, indistinguível de uma que ele aceita. É por
 * isso que esta cerca vive aqui, contra Postgres REAL: é o único lugar onde
 * "o filtro é válido" e "o filtro seleciona o que deveria" são a mesma pergunta.
 *
 * ═══ A METADE QUE QUASE NÃO FOI ESCRITA ══════════════════════════════════════
 * Trocar o filtro pela coluna gerada, e só isso, substituiria "nunca empurra"
 * por "empurra PARA SEMPRE" — e o segundo é pior, porque queima a cota da API
 * do Google reenviando o mesmo evento a cada 5 minutos enquanto o log de
 * sucesso parece saudável.
 *
 * A razão são DOIS RELÓGIOS: `updated_at` vem do `now()` do Postgres (trigger
 * `fn_set_updated_at`), e `google_synced_at` vinha do `new Date()` do Node,
 * calculado no worker ANTES de a requisição sair. O do Node é sempre anterior —
 * latência mais desvio de relógio entre contêineres —, então logo depois de uma
 * sincronização bem-sucedida `updated_at > google_synced_at` continuava
 * verdadeiro e a linha voltava à fila.
 *
 * O caso `depois de sincronizar, a linha SAI da fila` é o que prende isso, e ele
 * escreve o carimbo com um instante do PASSADO de propósito: é essa a forma
 * exata do que o worker mandava. Sem o trigger `fn_carimbar_ida_ao_google`, ele
 * reprova.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error(
    "TEST_DB_CONTAINER not set — rode esta suíte via `pnpm test:db` (scripts/test-db.sh)",
  );
}
const containerName: string = container;

function sql(script: string): string {
  return execFileSync(
    "docker",
    [
      "exec", "-i", containerName, "psql", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-tA", "-f", "-",
    ],
    { input: script, encoding: "utf8" },
  ).trim();
}

const ORG = "aaaaaaaa-0200-4000-8000-000000000001";
const DONO = "aaaaaaaa-0200-4000-8000-000000000002";
const TIPO = "aaaaaaaa-0200-4000-8000-000000000003";

/** Um compromisso novo, sempre em estado "nunca foi ao Google". */
function marcar(id: string, quando: string): void {
  sql(`
    insert into public.calendar_appointments
      (id, organization_id, event_type_id, owner_user_id, title, starts_at, ends_at, time_zone, status)
    values ('${id}', '${ORG}', '${TIPO}', '${DONO}', 'Compromisso ${id}',
            '${quando}'::timestamptz, '${quando}'::timestamptz + interval '30 min',
            'America/Sao_Paulo', 'confirmed');
  `);
}

function precisaIr(id: string): boolean {
  return sql(`select needs_google_push from public.calendar_appointments where id = '${id}';`) === "t";
}

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values ('${DONO}', 'dono-0200@deskcomm.test')
      on conflict (id) do nothing;
    insert into public.organizations (id, slug, display_name, legal_name)
      values ('${ORG}', 'org-0200', 'Org 0200', 'Org 0200')
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${DONO}', '${ORG}', 'admin', now())
      on conflict do nothing;
    insert into public.calendar_event_types
      (id, organization_id, name, slug, duration_minutes, default_owner_user_id)
      values ('${TIPO}', '${ORG}', 'Tipo 0200', 'tipo-0200', 30, '${DONO}')
      on conflict (id) do nothing;
    delete from public.calendar_appointments where organization_id = '${ORG}';
  `);
});

describe("needs_google_push: quem entra na fila do Google", () => {
  it("a coluna derivada existe e é GERADA (ninguém a escreve à mão)", () => {
    // Controle do instrumento: sem isto, uma coluna comum de mesmo nome faria
    // todos os casos abaixo passarem por motivo errado — ela seria só um
    // booleano que o teste mesmo preenche.
    const gerada = sql(`
      select is_generated from information_schema.columns
       where table_schema = 'public' and table_name = 'calendar_appointments'
         and column_name = 'needs_google_push';
    `);
    expect(gerada, "needs_google_push não é GENERATED — derivado escrito à mão diverge").toBe("ALWAYS");
  });

  it("compromisso que nunca foi ao Google ENTRA na fila", () => {
    const id = "bbbbbbbb-0200-4000-8000-000000000001";
    marcar(id, "2030-03-10 14:00:00-03");
    expect(precisaIr(id)).toBe(true);
  });

  it("depois de sincronizar, a linha SAI da fila", () => {
    // ⚠️ O CARIMBO VAI COM UM INSTANTE DO PASSADO, e isso é a forma EXATA do que
    // o worker manda: `new Date().toISOString()` do Node é calculado antes de a
    // requisição sair, então chega ao banco já velho. Um teste que escrevesse
    // `now()` aqui mediria um mundo que não existe e ficaria verde sem o trigger.
    const id = "bbbbbbbb-0200-4000-8000-000000000002";
    marcar(id, "2030-03-11 14:00:00-03");
    sql(`
      update public.calendar_appointments
         set google_event_id = 'evt_0200',
             google_synced_at = now() - interval '5 seconds'
       where id = '${id}';
    `);
    expect(
      precisaIr(id),
      "a linha continuou na fila logo depois de sincronizar — é o LAÇO: o worker " +
        "reenviaria o mesmo evento ao Google a cada 5 minutos, para sempre. " +
        "Falta o trigger fn_carimbar_ida_ao_google, que faz os dois lados da " +
        "comparação saírem do mesmo relógio.",
    ).toBe(false);
  });

  it("o carimbo é do BANCO, não de quem escreveu", () => {
    // A propriedade estrutural, dita diretamente: o valor gravado é descartado e
    // trocado pelo `now()` da transação. É o que faz o caso acima valer para
    // qualquer escritor futuro, não só para este worker.
    const id = "bbbbbbbb-0200-4000-8000-000000000003";
    marcar(id, "2030-03-12 14:00:00-03");
    sql(`
      update public.calendar_appointments
         set google_synced_at = '2001-01-01 00:00:00-03'::timestamptz
       where id = '${id}';
    `);
    const ano = sql(`
      select extract(year from google_synced_at)::int
        from public.calendar_appointments where id = '${id}';
    `);
    expect(ano, "o banco aceitou o carimbo de quem escreveu em vez de pôr o dele").not.toBe("2001");
  });

  it("editar depois de sincronizar RECOLOCA na fila", () => {
    // O outro lado, e sem ele a coluna poderia estar sempre falsa e os casos
    // acima passariam: uma alteração de verdade tem de voltar a pedir ida.
    const id = "bbbbbbbb-0200-4000-8000-000000000004";
    marcar(id, "2030-03-13 14:00:00-03");
    sql(`update public.calendar_appointments set google_synced_at = now() where id = '${id}';`);
    expect(precisaIr(id), "a linha nem chegou a sair da fila — o caso anterior é quem cobre isso").toBe(false);

    sql(`update public.calendar_appointments set title = 'Retorno remarcado' where id = '${id}';`);
    expect(
      precisaIr(id),
      "editei o compromisso e ele não voltou para a fila — a mudança nunca chegaria ao Google",
    ).toBe(true);
  });

  it("zerar o carimbo força a re-sincronização (e o trigger não atrapalha)", () => {
    // `NULL` é o pedido explícito de "manda de novo". O trigger só carimba valor
    // NÃO nulo justamente para não engolir esse pedido.
    const id = "bbbbbbbb-0200-4000-8000-000000000005";
    marcar(id, "2030-03-14 14:00:00-03");
    sql(`update public.calendar_appointments set google_synced_at = now() where id = '${id}';`);
    expect(precisaIr(id)).toBe(false);

    sql(`update public.calendar_appointments set google_synced_at = null where id = '${id}';`);
    expect(precisaIr(id), "zerei o carimbo e a linha não voltou para a fila").toBe(true);
  });

  it("o índice parcial do worker existe e casa o recorte que ele lê", () => {
    const achou = sql(`
      select count(*) from pg_indexes
       where schemaname = 'public'
         and indexname = 'calendar_appointments_pendente_no_google_idx';
    `);
    expect(achou, "sem o índice, o worker varre a tabela inteira a cada 5 minutos").toBe("1");
  });
});
