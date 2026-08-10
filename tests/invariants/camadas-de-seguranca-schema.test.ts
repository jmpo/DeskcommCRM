/**
 * AS CAMADAS QUE CUSTAM DINHEIRO: schema, isolamento, e os TRÊS estados.
 *
 * Roda contra o Postgres efêmero do `scripts/test-db.sh`, com o `baseline.sql`
 * aplicado — o MESMO arquivo que o kit self-host instala. Então este teste
 * também prova que a mudança chegou ao apêndice, e não só às migrations: sem
 * isso, a tela funcionaria no meu banco e a organização de quem instalou o
 * produto não teria onde gravar a escolha.
 *
 * O que se guarda aqui não é lógica — é o que só o banco tem:
 *
 * 1. **A tabela existe com a chave certa.** PK (organization_id, layer): duas
 *    linhas para a mesma camada da mesma organização seriam duas verdades.
 * 2. **RLS isola.** Tabela tenant-aware sem policy é vazamento entre clientes.
 * 3. **`layer` NÃO tem CHECK**, e isso é deliberado (vocabulário aberto): um
 *    clone com valor que este build não conhece quebraria o `update.sh` dele.
 *    O teste afirma a AUSÊNCIA porque alguém "completando" o schema com um CHECK
 *    estaria consertando o que está certo.
 * 4. **A leitura devolve três estados.** É a compatibilidade inteira: sem linha
 *    vale o ambiente, e colapsar isso desligaria as camadas de toda instalação
 *    que as tinha ligadas, no dia do deploy, em silêncio.
 */
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { lerCamadasDaOrg } from "@/lib/agent-engine/guardrails/camadas-da-org";

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 2,
});

const ORG_A = "0be7a70c-0000-4000-8000-000000000001";
const ORG_B = "0be7a70c-0000-4000-8000-000000000002";

beforeAll(async () => {
  for (const [id, slug] of [
    [ORG_A, "org-camadas-a"],
    [ORG_B, "org-camadas-b"],
  ] as const) {
    await pool.query(
      `insert into organizations (id, slug, legal_name, display_name)
       values ($1, $2, 'Org Camadas', 'Org Camadas') on conflict (id) do nothing`,
      [id, slug],
    );
  }
  // Controle positivo: no banco errado a contagem viria zerada e os casos abaixo
  // passariam medindo nada.
  const { rows } = await pool.query<{ n: string }>(
    `select count(*)::text as n from organizations where id in ($1, $2)`,
    [ORG_A, ORG_B],
  );
  if (rows[0]?.n !== "2") throw new Error(`fixture não chegou ao banco da porta ${PORT}`);
});

beforeEach(async () => {
  await pool.query(`delete from org_guardrail_layers where organization_id in ($1, $2)`, [ORG_A, ORG_B]);
});

afterAll(async () => {
  await pool.query(`delete from organizations where id in ($1, $2)`, [ORG_A, ORG_B]);
  await pool.end();
});

describe("schema das camadas de segurança por organização", () => {
  it("a tabela existe e a chave é (organização, camada)", async () => {
    const { rows } = await pool.query<{ cols: string }>(
      `select string_agg(a.attname, ',' order by a.attnum) as cols
         from pg_constraint c
         join unnest(c.conkey) k(attnum) on true
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
        where c.conrelid = 'public.org_guardrail_layers'::regclass and c.contype = 'p'`,
    );
    expect(rows[0]?.cols).toBe("organization_id,layer");
  });

  it("RLS está LIGADA e a policy de isolamento existe", async () => {
    const { rows } = await pool.query<{ rls: boolean; policies: string }>(
      `select c.relrowsecurity as rls,
              coalesce(string_agg(p.polname, ','), '') as policies
         from pg_class c
         left join pg_policy p on p.polrelid = c.oid
        where c.oid = 'public.org_guardrail_layers'::regclass
        group by c.relrowsecurity`,
    );
    expect(rows[0]?.rls, "tabela tenant-aware com RLS desligada é vazamento entre clientes").toBe(true);
    expect(rows[0]?.policies).toContain("tenant_isolation_org_guardrail_layers_all");
  });

  it("`layer` NÃO tem CHECK — vocabulário aberto, de propósito", async () => {
    // A ausência é a asserção. Um CHECK aqui faria o `update.sh` de um clone com
    // valor legado quebrar, e a doutrina de migrations proíbe.
    const { rows } = await pool.query<{ n: string }>(
      `select count(*)::text as n from pg_constraint
        where conrelid = 'public.org_guardrail_layers'::regclass and contype = 'c'`,
    );
    expect(rows[0]?.n).toBe("0");
  });

  it("a mesma camada não pode ter duas verdades na mesma organização", async () => {
    await pool.query(
      `insert into org_guardrail_layers (organization_id, layer, enabled) values ($1, 'jailbreak', true)`,
      [ORG_A],
    );
    await expect(
      pool.query(
        `insert into org_guardrail_layers (organization_id, layer, enabled) values ($1, 'jailbreak', false)`,
        [ORG_A],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it("sem linha, a leitura devolve NÃO-ESCOLHIDO — não `false`", async () => {
    // O caso que garante a compatibilidade: quem já decidiu no `.env` não muda de
    // comportamento no dia em que a migration é aplicada.
    expect(await lerCamadasDaOrg(pool, ORG_A)).toEqual({
      promessa_semantica: null,
      jailbreak: null,
    });
  });

  it("a escolha atravessa, e `false` escolhido não vira `null`", async () => {
    await pool.query(
      `insert into org_guardrail_layers (organization_id, layer, enabled)
       values ($1, 'promessa_semantica', false), ($1, 'jailbreak', true)`,
      [ORG_A],
    );
    expect(await lerCamadasDaOrg(pool, ORG_A)).toEqual({
      promessa_semantica: false,
      jailbreak: true,
    });
  });

  it("a escolha de uma organização não vaza para a outra", async () => {
    await pool.query(
      `insert into org_guardrail_layers (organization_id, layer, enabled) values ($1, 'jailbreak', false)`,
      [ORG_A],
    );
    expect(await lerCamadasDaOrg(pool, ORG_B)).toEqual({
      promessa_semantica: null,
      jailbreak: null,
    });
  });

  it("camada desconhecida na linha é ignorada, não derruba a leitura", async () => {
    // O preço declarado do vocabulário aberto: um clone que voltou de versão tem
    // linha que este build não conhece, e ela não pode quebrar o turno.
    await pool.query(
      `insert into org_guardrail_layers (organization_id, layer, enabled) values ($1, 'camada_do_futuro', true)`,
      [ORG_A],
    );
    expect(await lerCamadasDaOrg(pool, ORG_A)).toEqual({
      promessa_semantica: null,
      jailbreak: null,
    });
  });
});
