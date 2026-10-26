/**
 * O RASCUNHO DE AGENTE PODE NASCER SEM NÚMERO — E CONTINUA SEM PODER ATENDER.
 *
 * A migration 0239 tirou o `not null` de `ai_agent_versions.channel_session_id`
 * porque numa instalação nova não existe UMA linha em `channel_sessions` (o
 * aparelho é pareado outro dia, com o celular na mão) e o editor exigia o número
 * para SALVAR — o dono escrevia o prompt do atendente e não conseguia guardá-lo.
 *
 * Afrouxar uma restrição é a mudança de schema mais fácil de fazer e a mais fácil
 * de fazer errado: a pergunta que fica é se o que a restrição PROTEGIA continua
 * protegido por outra coisa. A prosa da migration afirma que sim, e nomeia quem
 * protege — `fn_publish_ai_agent_version`, que procura o canal por
 * `where s.id = v_version.channel_session_id` e levanta `channel_session_not_found`
 * quando não acha linha (um id nulo não acha nenhuma).
 *
 * Este arquivo cobra essa afirmação no banco de verdade, nos dois sentidos: o
 * nulo ENTRA como rascunho, o nulo NÃO PUBLICA, e escolher o número depois
 * publica a MESMA versão — o rascunho sem número é um estado de espera, não um
 * beco sem saída.
 */
import pg from "pg";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect } from "vitest";
import { seedGov } from "./gov-helpers";
import { replyFixture } from "../support/autonomia-fixture";

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
  max: 5,
});

beforeAll(() => seedGov());
afterAll(() => pool.end());

/**
 * Um agente sem nenhuma versão publicada e com UM rascunho cujo número está em
 * branco — o retrato de quem acabou de instalar e ainda não pareou o WhatsApp.
 */
async function rascunhoSemNumero() {
  const f = await replyFixture(pool);
  await pool.query("update ai_agents set published_version_id=null where id=$1", [f.agent]);
  await pool.query("delete from ai_agent_versions where agent_id=$1", [f.agent]);

  // O modelo sai do catálogo do próprio baseline: publicar confere
  // `ai_models`, e um id inventado reprovaria por `model_not_found` — um verde
  // (ou um vermelho) que não fala do número.
  const modelo = (
    await pool.query(
      "select model_id from ai_models where provider='anthropic' and deprecated_at is null order by model_id limit 1",
    )
  ).rows[0]?.model_id as string | undefined;
  expect(modelo, "catálogo `ai_models` sem modelo anthropic vivo no baseline").toBeTruthy();

  const version = randomUUID();
  await pool.query(
    `insert into ai_agent_versions
       (id,organization_id,agent_id,version_number,system_prompt,provider,model,channel_session_id,status)
     values ($1,$2,$3,1,'Atenda quem chegar.','anthropic',$4,null,'draft')`,
    [version, f.org, f.agent, modelo],
  );
  return { ...f, version, modelo };
}

it("o rascunho ENTRA com o número em branco — era isto que o `not null` impedia", async () => {
  const f = await rascunhoSemNumero();
  const linha = (
    await pool.query(
      "select status, channel_session_id, system_prompt from ai_agent_versions where id=$1",
      [f.version],
    )
  ).rows[0];
  expect(linha.channel_session_id).toBeNull();
  expect(linha.status).toBe("draft");
  // O que o dono escreveu está guardado — o defeito de origem era exatamente
  // não conseguir guardar isto.
  expect(linha.system_prompt).toBe("Atenda quem chegar.");
});

it("publicar sem número é RECUSADO, e o agente não fica com versão publicada", async () => {
  const f = await rascunhoSemNumero();
  await expect(
    pool.query("select * from fn_publish_ai_agent_version($1,$2,$3,true)", [
      f.org,
      f.agent,
      f.version,
    ]),
  ).rejects.toThrow("channel_session_not_found");

  const depois = (
    await pool.query(
      `select a.published_version_id, v.status
         from ai_agents a join ai_agent_versions v on v.id=$2
        where a.id=$1`,
      [f.agent, f.version],
    )
  ).rows[0];
  expect(depois.published_version_id).toBeNull();
  expect(depois.status).toBe("draft");
});

it("escolhido o número e conectado, a MESMA versão publica — o rascunho é espera, não beco", async () => {
  const f = await rascunhoSemNumero();
  await pool.query("update channel_sessions set status='WORKING' where id=$1", [f.channel]);
  await pool.query("update ai_agent_versions set channel_session_id=$2 where id=$1", [
    f.version,
    f.channel,
  ]);

  const publicada = (
    await pool.query("select * from fn_publish_ai_agent_version($1,$2,$3,true)", [
      f.org,
      f.agent,
      f.version,
    ])
  ).rows[0];
  expect(publicada.version_id).toBe(f.version);

  const depois = (
    await pool.query(
      `select a.published_version_id, v.status
         from ai_agents a join ai_agent_versions v on v.id=$2
        where a.id=$1`,
      [f.agent, f.version],
    )
  ).rows[0];
  expect(depois.published_version_id).toBe(f.version);
  expect(depois.status).toBe("published");
});

it("permite publicar especialista ligado ao roteador inativo no canal WORKING, sem número próprio", async () => {
  const f = await rascunhoSemNumero();
  await pool.query("update channel_sessions set status='WORKING' where id=$1", [f.channel]);
  const router = randomUUID();
  await pool.query(
    "insert into ai_routers(id,organization_id,name,channel_session_id,is_active) values($1,$2,'Squad', $3,false)",
    [router, f.org, f.channel],
  );
  await pool.query(
    "insert into ai_router_members(organization_id,router_id,agent_id,intent_name,intent_description) values($1,$2,$3,'refin','Refinanciamento')",
    [f.org, router, f.agent],
  );
  const resultado = (await pool.query(
    "select * from fn_publish_ai_agent_version($1,$2,$3,true)",
    [f.org, f.agent, f.version],
  )).rows[0];
  expect(resultado.version_id).toBe(f.version);
  expect((await pool.query(
    "select channel_session_id,status from ai_agent_versions where id=$1",
    [f.version],
  )).rows[0]).toMatchObject({ channel_session_id: null, status: "published" });
  expect((await pool.query("select is_active from ai_routers where id=$1", [router])).rows[0].is_active)
    .toBe(false);
});

it("não publica membro de roteador cujo canal está desconectado", async () => {
  const f = await rascunhoSemNumero();
  await pool.query("update channel_sessions set status='STOPPED' where id=$1", [f.channel]);
  const router = randomUUID();
  await pool.query(
    "insert into ai_routers(id,organization_id,name,channel_session_id,is_active) values($1,$2,'Squad desligado',$3,false)",
    [router, f.org, f.channel],
  );
  await pool.query(
    "insert into ai_router_members(organization_id,router_id,agent_id,intent_name,intent_description) values($1,$2,$3,'port','Portabilidade')",
    [f.org, router, f.agent],
  );
  await expect(pool.query(
    "select * from fn_publish_ai_agent_version($1,$2,$3,true)",
    [f.org, f.agent, f.version],
  )).rejects.toThrow("channel_session_offline");
});

/**
 * O RASCUNHO DO ONBOARDING de quem pulou o telefone (QA de 26/10/2026), e por
 * que `publishFirstVersion` publica SEM pedir a procedência depois de apontar o
 * canal: `trg_agent_provisioning_origin` zera `provisioning_origin` em todo
 * UPDATE que muda conteúdo — o canal inclusive. Pedir "onboarding" depois disso
 * é recusado; quem confere a procedência é o `where` do próprio UPDATE.
 * Medido pela tela antes deste caso existir: o agente nunca entrava no ar.
 */
it("rascunho do onboarding: apontar o canal ZERA a procedência; publicar sem pedi-la passa", async () => {
  const f = await rascunhoSemNumero();
  await pool.query("delete from ai_agent_versions where id=$1", [f.version]);
  const version = randomUUID();
  await pool.query(
    `insert into ai_agent_versions
       (id,organization_id,agent_id,version_number,system_prompt,provider,model,channel_session_id,status,provisioning_origin)
     values ($1,$2,$3,1,'Atiendes a los clientes.','anthropic',$4,null,'draft','onboarding')`,
    [version, f.org, f.agent, f.modelo],
  );
  await pool.query("update channel_sessions set status='WORKING' where id=$1", [f.channel]);

  // O UPDATE condicionado à procedência — o mesmo `where` de `publishFirstVersion`.
  const apontada = await pool.query(
    `update ai_agent_versions set channel_session_id=$2
      where id=$1 and status='draft' and provisioning_origin='onboarding' and channel_session_id is null
      returning provisioning_origin`,
    [version, f.channel],
  );
  expect(apontada.rowCount).toBe(1);
  expect(apontada.rows[0].provisioning_origin, "o gatilho zera a procedência no UPDATE").toBeNull();

  await expect(
    pool.query("select * from fn_publish_ai_agent_version($1,$2,$3,true,'onboarding')", [
      f.org,
      f.agent,
      version,
    ]),
  ).rejects.toThrow("existing_version_requires_review");

  const publicada = (
    await pool.query("select * from fn_publish_ai_agent_version($1,$2,$3,true)", [f.org, f.agent, version])
  ).rows[0];
  expect(publicada.version_id).toBe(version);
});
