# Handoff — "agente pausado continua assumindo conversa"

> Doc VIVO. Mantido até a tarefa terminar. Toda sessão que retomar isto lê daqui primeiro.

## Relato do dono (2026-08-28)

Na VPS (`ssh hg-vps`, `deskcommcrm-app-1` @ `1.9.1`):

- O agente **publicado** é o **Suporte Deskcomm**.
- Quem **pega as conversas para atender** é o **Atendente Clínica Vitalis**, que está **PAUSADO**.
- Antes, quem estava ativo era o Vitalis. Hipótese do dono: ele "impregnou" — o agente que
  um dia esteve publicado continua assumindo mesmo depois de desativado.
- Suspeita de que o defeito seja **geral**, alcançando o roteador de intenção e a
  **prioridade** entre agentes.

**Resultado esperado:** agente publicado assume a conversa; agente pausado NÃO assume;
o que a UI diz é o que acontece na execução.

## Estado

| Etapa | Status |
|---|---|
| Mapear caminhos de seleção de agente | feito |
| Medir estado real do banco da VPS | feito |
| Causa raiz identificada | **SIM — não é o seletor** |
| Teste que reprova o defeito | feito (vermelho observado) |
| Correção | feita — 6 sítios |
| Prova em tela (Playwright) | em curso |

## O que já se sabe do código (SHA 481c24c4, working tree limpo)

- `lib/agent-engine/agent/agent-config.ts`
  - `loadPublishedAgentConfig(db, org, channelSessionId)` — join `ai_agents` ⋈
    `ai_agent_versions ON v.id = a.published_version_id`, com
    `archived_at is null`, `v.status='published'`, `v.channel_session_id = $2`,
    `order by a.priority desc, a.created_at asc limit 1`.
  - `loadPublishedAgentConfigById(db, org, agentId)` — mesma coisa **sem** o filtro de
    `channel_session_id` (usada pelos membros do Intent Router).
- `app/api/v1/ai/agents/[id]/pause/route.ts` — pausar limpa `published_version_id` e
  marca a versão como `superseded`. Ou seja, no papel, pausar deveria bastar.
- Memória `project_inbox_quem_manda`: existe atribuição de conversa
  (`assignee_kind='ai_agent'`) e o motor já teve o defeito de não lê-la.

## Hipóteses abertas

1. **Atribuição grudada** — a conversa foi atribuída ao Vitalis quando ele era publicado;
   algum caminho do motor honra `conversations.assignee_id` sem reconferir se aquele
   agente ainda está publicado.
2. **Outro seletor** — o dispatcher do CRM (`lib/ai/dispatcher/`) ou o worker
   (`workers/ai-response-worker.ts`) selecionam por critério diferente do loader acima.
3. **Router com membro morto** — `ai_router_members` aponta para agente despublicado e
   `loadPublishedAgentConfigById` (ou o fallback do router) não reprova.
4. **Job antigo na fila** — o turno carrega `agent_id`/`version_id` congelado no payload
   do job em vez de resolver no início do turno.

## Impedimentos registrados

(nada ainda)


---

## MEDIÇÃO NA VPS (2026-08-28, banco `aws-1-us-west-2.pooler.supabase.com`)

Org medida: `988371bf-b118-4090-b4f3-dc07ae9366c9` (Deskcomm Administracao Ltda).
Sessão de canal VIVA: `66491066-1b9f-4e8e-ad9e-91052db0e66b` ("Lia", `WORKING`).

### 1. O seletor de agente está CERTO. Medido, não inferido.

`ai_agents` na org:

| agente | priority | `published_version_id` | arquivado |
|---|---|---|---|
| Suporte DeskcommCRM (`13858061`) | 1000 | **preenchido** (`99ad9c50`, v5) | não |
| Vitoria - Atendente Clinica Vitalis (`726a3eb6`) | 999 | **NULL** | não |

O pause fez o que promete: `published_version_id = null` + versão `superseded`.

Log do worker no turno de hoje (job `bce692bd-1261-450f-a09a-bba834651d6b`):

```
"config do agente publicada em uso" agent_id=13858061-... agent_version_id=99ad9c50-...
                                    model=gpt-5.6-terra router_outcome=no_match
"llm: chamada concluída" purpose=agent_turn origem_da_escolha="agente_publicado"
                         inputTokens=22270
```

**O agente escolhido foi o publicado.** `loadPublishedAgentConfig` e
`loadPublishedAgentConfigById` ambos filtram `published_version_id` + `v.status='published'`
+ `archived_at is null` — um agente pausado não é carregável por nenhum dos dois.

### 2. O sintoma é REAL, e a causa é outra: as camadas por-ORG do prompt

Mesma conversa, mesmo turno, resposta que saiu no WhatsApp às 18:32:52:

> "Oi, Rafael! **Sou a assistente virtual da Vitalis.** Como posso te ajudar hoje?"

Numa conversa **nova** (primeira inbound "i" às 18:32:05) — logo, não é histórico.

`lib/agent-engine/agent/inbound-turn.ts:1317-1340` monta o system prompt de TRÊS camadas:

```ts
const playbook = await loadPlaybook(pool, tenantId,
  agentConfig !== null ? { agentLayer: agentConfig.systemPrompt } : undefined);  // ← POR AGENTE
const skills    = await loadSkills(pool, tenantId);                              // ← POR ORG
const orgMemory = await loadOrgMemory(pool, tenantId);                           // ← POR ORG
const systemWithMemory = composeSystemPrompt({
  playbookPrompt: playbook.prompt, orgMemoryBlock: renderOrgMemory(orgMemory), skillIndex });
```

Trocar o agente publicado troca **uma** das três. As outras duas seguem intactas — e na
VPS as duas são da Clínica Vitalis:

- `org_memory_pointers.version_id = 50c3ce89` → conteúdo em vigor abre com
  *"A Vitalis é uma clínica odontológica especializada em Divinópolis/MG"* e
  *"Quem escreve é chamado de PACIENTE, nunca de cliente ou lead"*.
  O bloco é renderizado com o rótulo **"valem para TODO atendimento"**
  (`org-memory.ts:43`).
- `skill_versions.body` (`e4660130`) → *"Currículo: e-mail contato@clinicavitalis.com.br,
  aos cuidados da Aline"*, *"Este contato NÃO entra no funil comercial"*.

Varredura do banco por `ilike '%vitalis%'` achou resíduo em 25 pares tabela/coluna,
entre eles `skill_versions.body`, `org_memory_versions.content`, `crm_pipelines.name`,
`lead_checkpoints.rolling_summary` (13 linhas).

**É a "impregnação" que o dono descreveu — só que o portador não é o seletor de agente,
são as camadas de contexto que o seletor nem toca.**

### 3. Dois defeitos adjacentes, medidos no mesmo banco

- **`conversations.active_ai_agent_id` aponta para agente despublicado — e isso é
  INERTE.** 3 conversas seguem com `active_ai_agent_id = 726a3eb6` (Vitalis,
  despublicado em 26/08 17:56), e nada limpa o ponteiro no pause.

  **Não é defeito, e a primeira versão deste documento errou ao chamá-lo assim.**
  O sticky só vira desfecho passando por `loadMatchedOrFallback`
  (`resolve-turn-agent.ts:155-171`), que chama `loadPublishedAgentConfigById` —
  cujo inner join com a versão publicada não casa para agente pausado. O resultado
  é `log.warn` + queda para o fallback, coberto por
  `resolve-turn-agent.test.ts:241-256`. E o ponteiro **se auto-cura**: a escrita de
  `inbound-turn.ts:1262-1268` grava o agente que RESOLVEU o turno, não o sticky
  lido. O agente pausado é *consultado*, nunca *executado*.

  Fica registrado porque a tela pode vir a exibir esse campo, e aí o valor obsoleto
  vira mentira visível. Hoje nenhuma tela o lê.
- **Router ATIVO com ZERO membros e sem fallback na sessão viva.**
  `ai_routers 60bebc5a` ("Roteador - CLinica X"), `is_active=t`, 0 membros,
  `fallback_agent_id` NULL. Toda decisão sai `no_match` (15/15 em
  `ai_router_decisions`). Hoje é inócuo — a regra 5 de `resolve-turn-agent.ts` faz
  cair no agente publicado da sessão — mas gasta **uma chamada de classificador por
  turno** (`purpose=intent_router`, medido no log) para não classificar nada.

---

## A CAUSA RAIZ (medida no código, SHA 481c24c4)

O dono estava certo sobre o efeito e a intuição ("impregnou"). O portador não é o
resolvedor do turno — é **`ai_agents.is_active`, uma coluna que a pausa não desliga e
que dois workers ainda usam como critério de "quem atende"**.

### A cadeia, sítio por sítio

1. **Pausar um `mcp_agent` não desliga `is_active`.**
   `app/app/ai/agents/_actions.ts:77`
   ```ts
   // Legacy rag_bot: também flip is_active para refletir no badge.
   if (existing.kind !== "mcp_agent") updates.is_active = false;
   ```
   E a rota REST `app/api/v1/ai/agents/[id]/pause/route.ts` **nunca** escreve
   `is_active`, para nenhum `kind`.

2. **O badge ignora `is_active` para `mcp_agent` — e está certo.**
   `AgentStatusBadge.tsx:27` devolve `published` por `published_version_id`. A tela
   diz a verdade sobre o engine. O problema é que `is_active` continua ligado embaixo,
   sem nada na tela apontando para ele.

3. **O worker legado escolhe agente por `is_active`.**
   `workers/ai-response-worker.ts:642-654`
   ```ts
   .from("ai_agents").select("id, ..., is_active, is_default")
     .eq("organization_id", input.organizationId)
     .eq("is_active", true)
     .order("is_default", { ascending: false })
     .order("created_at", { ascending: true }).limit(1)
   ```
   Sem `archived_at`, sem `published_version_id`, sem `kind`. O mesmo padrão em
   `workers/ai-sentiment-worker.ts:120-128`.

4. **A trava que segura o worker legado é ORG-WIDE.**
   `workers/ai-response-worker.ts:677`: ele só desiste (`skip("engine_owns_reply")`) se
   existir **algum** agente com `published_version_id` na organização inteira.

### O que isso produz

> **Pausar o único agente publicado da organização faz um agente que a tela chama de
> "Rascunho" voltar a responder no WhatsApp** — pelo caminho legado, com o
> `system_prompt` da tabela `ai_agents` (o do cadastro, não o da versão), sem as
> ferramentas, sem os funis e sem os guardrails da versão publicada.

Na VPS isso está armado agora: a org tem `is_active=true` em **dois** agentes —
`13858061` (Suporte DeskcommCRM, publicado) e `fceb2e33` ("Atendente IA", `rag_bot`,
`is_default=true`, **não publicado, tela diz "Rascunho"**). Pausar o Suporte
DeskcommCRM entrega o atendimento ao "Atendente IA".

Prova de que o worker legado está vivo em produção — log de hoje:
```
[ai-response-worker] skip reason=engine_owns_reply conversation_id=ed439beb-...
```
Ele roda em todo inbound. A única coisa que o segura é a existência de um publicado.

### E a tela também mente sobre isso

`app/api/v1/ai/automatico-ativo/route.ts:42` responde "automático ativo" contando
`is_active=true` — a régua que **nenhum** dos dois motores usa. Depois de pausar o
publicado, ela continua dizendo que a IA está atendendo.

### O sintoma que o dono viu (persona da Vitalis) tem causa PRÓPRIA

Ver a seção de medição acima: memória da org + skills são **por organização**, o
prompt do agente é **por agente**, e trocar o publicado troca só a terceira camada.
Os dois defeitos são independentes e os dois precisam de conserto.


---

## O QUE FOI CORRIGIDO (branch `fix/agente-pausado-nao-atende`)

### A régua única: `lib/ai/agents/no-ar.ts` (arquivo novo)

`estadoDoAgente()` devolve `arquivado | no_ar | no_ar_legado | parado`, e dois
predicados saem dela: `agenteAtende()` (responde por ALGUM motor) e
`elegivelParaWorkerLegado()` (o worker antigo pode responder por ele).

Falha FECHADA na ação: exige `kind === "rag_bot"` explícito para o ramo legado, de
modo que um `.select()` que esqueça a coluna não faça o worker responder por um
agente sobre o qual não se sabe nada.

### Os seis sítios

| arquivo | era | virou |
|---|---|---|
| `workers/ai-response-worker.ts` | `.eq("is_active", true).limit(1)` | lista + `.find(elegivelParaWorkerLegado)` |
| `workers/ai-sentiment-worker.ts` | idem | lista + `.find(agenteAtende)` |
| `app/api/v1/ai/automatico-ativo/route.ts` | `count` por `is_active` | `.some(agenteAtende)` |
| `app/api/v1/ai/agents/assignable/route.ts` | `.eq("is_active", true)` | `.filter(agenteAtende)` |
| `app/app/.../AgentStatusBadge.tsx` | régua própria duplicada | delega a `estadoDoAgente` |
| `lib/agent-engine/edge/crm/drain.ts` | portão contava LINHA de membro | conta membro/fallback **publicado** |

O `.limit(1)` saiu do worker de propósito: cortar antes de filtrar faria um
`mcp_agent` pausado — que é `is_default` na instalação que o onboarding cria —
esconder o `rag_bot` legítimo logo abaixo dele.

### Testes

- `tests/unit/agente-pausado-nao-atende.test.ts` (novo, 4 casos) — mede o EFEITO:
  a requisição sai para `api.anthropic.com` ou não. Vermelho observado antes do
  conserto: *"o worker chamou o provider por um agente PAUSADO (destinos:
  api.anthropic.com)"*.
- `tests/invariants/portao-de-capacidade-mede-quem-executa.test.ts` (novo, 7 casos,
  Postgres real) — o portão do drain nas duas direções.
- `AgentStatusBadge.test.ts` — reescrito; duas justificativas que ele carregava
  foram medidas como FALSAS e estão corrigidas no próprio arquivo.

### Sabotagem (prova de que a guarda vigia)

| sabotagem | previsão | medido |
|---|---|---|
| tirar `.find(elegivelParaWorkerLegado)` | 1 falha (só o PAUSADO) | 1 falha ✓ |
| tirar `.is("archived_at", null)` | 0 falhas (régua JS cobre) | 0 falhas ✓ |

A segunda revela que o filtro SQL de `archived_at` é **redundante** — está escrito
no código, para que ninguém o confunda com a guarda.

## Impedimentos encontrados

1. **Suíte quebrou em 19 casos após o conserto** — 4 dublês de teste devolviam
   `maybeSingle()` para `ai_agents` e a consulta virou lista. Resolvido ajustando
   os dublês (incluindo `kind: "rag_bot"`, que eles não declaravam e o banco tem
   como `NOT NULL DEFAULT`). Não houve enfraquecimento: as asserções são as mesmas.
2. **`lib/ai/dispatcher/rate-limit.test.ts` falha em 5 casos localmente** — vermelho
   conhecido e alheio (Redis do `.env.local` fora do ar), documentado no `CLAUDE.md`.
3. **Crase dentro de template literal** — comentário SQL com `` `x` `` fechava a
   template string do TS. Comentários dentro de SQL embutido vão sem crase.
4. **Processo de teste órfão** — um `nohup ... &` dentro de comando já em background
   devolveu "exit 0" do shell enquanto o vitest seguia vivo, e dois runs
   concorreram com o build. Rodar a suíte pelo background do harness, sem `&`.


---

## O QUE FOI INVESTIGADO E **NÃO** É DEFEITO

Seis hipóteses plausíveis caíram sob verificação. Ficam escritas para que a próxima
sessão não gaste tempo nelas de novo:

1. **O resolvedor do turno seleciona agente pausado** — não. `loadPublishedAgentConfig`
   e `loadPublishedAgentConfigById` fazem inner join em `published_version_id` e
   exigem `v.status='published'` + `archived_at is null`. Um agente pausado não é
   carregável por nenhum dos dois. Confirmado no log de produção
   (`origem_da_escolha: "agente_publicado"`).
2. **O sticky da conversa prende a conversa no agente pausado** — não, ver acima.
3. **O job congela `agent_id` no payload** — não. O payload de `inbound_turn` leva só
   ponteiros de CRM (`drain.ts:274-280`); o agente é resolvido no início de cada turno.
4. **`lib/ai/dispatcher/index.ts` seleciona sem conferir publicação** — o código é esse
   mesmo, mas o caminho está **morto**: `dispatchAgents` não tem um único chamador de
   produção, e `app/api/v1/cron/agent-dispatcher/route.ts` nem importa o módulo
   (devolve `{ skipped: true, deprecated: true }`). Idem `lib/ai/runtime/agent.ts:274`.
5. **`duplicate.ts` grava `is_active: true` na cópia** — grava, mas a cópia nunca é a
   escolhida (`order by is_default desc, created_at asc`), e ela é `mcp_agent`, que a
   régua nova recusa para o caminho legado.
6. **`archiveAgentAction` contraria seu próprio comentário** — não contraria: o
   comentário declara o escopo ("para o LEGADO") e a implementação o segue.

## O QUE **NÃO** ESTÁ CONSERTADO (e é do dono decidir)

**A persona da Clínica Vitalis na resposta do Suporte Deskcomm não é bug de código.**
A memória da organização (`/app/ai/memory`) e as skills (`/app/ai/skills`) são
deliberadamente **por organização** — a própria tela diz "Regras e aprendizados que
TODOS os agentes de IA desta organização seguem em qualquer conversa". A org
`988371bf` foi reaproveitada de uma demo de clínica odontológica, e esses dois
acervos continuam falando pela Vitalis, com 9.730 caracteres ativos.

Trocar o agente publicado troca **uma** das três camadas do prompt. As outras duas
são dado do usuário, e apagá-las é decisão dele — não minha.

O que a engenharia deve a isto: a tela do AGENTE não menciona que existem duas
camadas acima do prompt dele. Quem publica um agente vê só o próprio texto. Essa é
uma lacuna de produto real, e está fora deste conserto.

---

## PROVA EM TELA (Playwright, app local em modo produção)

Ambiente: `pnpm build` + `pnpm start` na 3000, Supabase local (`54321/54322`), login
real por senha + TOTP como `e2e-admin@deskcomm.test`.

Cenário montado para reproduzir o mundo real da VPS:

| agente | `kind` | `is_active` | publicado |
|---|---|---|---|
| Atendente Publicado | mcp_agent | **false** (como "Novo agente" grava) | sim |
| Atendente Pausado | mcp_agent | **true** (a pausa não desliga) | não |
| Bot Padrão E2E | rag_bot | true | não |

### Com um agente publicado

- **Tela `/app/ai/agents`:** `Atendente Pausado → Rascunho`,
  `Atendente Publicado → Publicado`, `Bot Padrão E2E → Publicado`.
  (`Bot Padrão E2E` dizia "Rascunho" antes — e atendia.)
- **`GET /ai/agents/assignable`** → `["Atendente Publicado (v1)", "Bot Padrão E2E (v-)"]`.
  Antes: escondia o "Atendente Publicado" (`is_active=false`) e oferecia o
  "Atendente Pausado" (`is_active=true`). Errava nos dois sentidos.
- **Inbox, cabeçalho da conversa:** `Aberta · AU · Automático`.

### Depois de pausar TODOS (pelo caminho que a tela usa)

- **Tela:** os três em `Rascunho`.
- **`assignable`** → `[]`.
- **`automatico-ativo`** → `{ ativo: false }`.
- **Inbox, cabeçalho da mesma conversa:** `Aberta · Sem responsável`.

### A divergência isolada, sobre os MESMOS dados

```
     estado     | regua_ANTIGA (is_active) | regua_NOVA
----------------+--------------------------+------------
 COM publicado  | t                        | t
 TODOS pausados | t   ← a mentira          | f
```

A régua antiga dizia "há automático atendendo" com todos os agentes pausados,
porque o pausado mantém `is_active=true`. É o selo "Automático" na Inbox de uma
organização onde ninguém responde.

## Gates

| gate | resultado |
|---|---|
| `npx tsc --noEmit` | limpo |
| `pnpm lint` | 0 erros (299 warnings pré-existentes) |
| `pnpm test:unit` | **574 de 575 arquivos verdes** — 6403 casos passando |
| `pnpm build` | `BUILD_EXIT=0` |
| `pnpm release:conferir` | fragmento aceito (`1.9.1 + patch = 1.9.2`) |
| `pnpm lint:channels` | ok (60 arquivos de dívida conhecida, nenhum novo) |
| **`pnpm test:db`** | **137 de 137 arquivos, 1050 casos verdes** |

### O invariante novo nasceu vermelho — e o motivo era o fixture, não o portão

Primeira rodada: `6 failed`, todos com `duplicate key ... "ai_agents_name_unique"`.
A constraint é **por organização**, e os sete cenários dividem a mesma org — o
literal `'Agente Portão'` matava o segundo insert em 23505, e seis casos ficavam
vermelhos **sem nunca chegar a exercitar o portão**. Um vermelho que lê como
defeito e é erro de fixture.

Conserto: nome próprio por agente. Controle anexado ao commit —
`git diff | grep -E "^[+-].*(expect|it\()"` devolve **vazio**: nenhuma asserção e
nenhum título de caso mudaram. (O commit precisou de
`DESKCOMM_GOV_INVARIANTS_EDIT=1`: a catraca de `tests/invariants/**` bloqueia
edição de invariante, e está certa em bloquear — a exceção está justificada na
mensagem do commit.)

### Sabotagem do portão (com previsão declarada ANTES de rodar)

Revertido o predicado do drain para o antigo (existência de linha de membro):

| previsão | medido |
|---|---|
| 2 falhas: `MEMBRO está pausado` e `FALLBACK está pausado` | **exatamente essas duas** |

Os outros 5 casos e os 136 arquivos restantes seguiram verdes — a guarda morde
onde deve e só onde deve. `drain.ts` restaurado (diff vazio contra o commit).

A única suíte vermelha é `lib/ai/dispatcher/rate-limit.test.ts` (5 casos) — o
vermelho conhecido e **alheio** que o `CLAUDE.md` documenta: o `.env.local` tem
`UPSTASH_REDIS_REST_URL` apontando para um Redis local que não está de pé.
Conferido que não toquei em `lib/ai/dispatcher/` neste trabalho.

Controle do rodapé contra o grep, como manda o `CLAUDE.md`:
`rodapé: 5 failed | grep contou: 5` — batem.

## INCIDENTE — outra sessão apagou este trabalho do git (recuperado)

Durante a sessão, o commit `8238b8e7` ("docs(release): o fragmento do conserto de
namespace no update.sh (#403)"), feito por **outra sessão no mesmo worktree**,
entrou nesta branch e **deletou do índice**:

```
docs/handoff/agente-pausado-assume-conversa.md   | 210 ---
lib/ai/agents/no-ar.ts                           | 101 ---
tests/unit/agente-pausado-nao-atende.test.ts     | 301 ---
workers/ai-response-worker.ts                    |  30 +-
```

**Nada foi perdido** — os arquivos continuaram no working tree como untracked, e
foram recommitados em `e1533012` com `git commit --only` de lista explícita.

O sintoma que denunciou: `git diff --name-only origin/main...HEAD` devolveu
arquivos que não eram meus (`.gitattributes`, `hostgator-setup-kit/install.sh`) e
**não** devolveu os meus. Quem retomar isto: confira `git log --oneline -3` e
`git worktree list` antes de confiar em qualquer diff, e nunca use `git add -A`
neste worktree — `.gitattributes` e `hostgator-setup-kit/install.sh` seguem
modificados por outra sessão e não devem entrar em commit deste trabalho.

---

## ENTREGA — PR, release e VPS

### PR

**#408** — `fix/pausar-agente-cala-em-todos-os-caminhos` → `main`.

A branch de trabalho original (`fix/agente-pausado-nao-atende`) **não** foi usada
para o PR: ela carregava o commit `8238b8e7` de outra sessão, cujos arquivos
(`.gitattributes`, `hostgator-setup-kit/install.sh`,
`.changes/o-fork-checa-...`) já têm PR próprio — o **#405**. Abrir o PR daquela
branch misturaria dois assuntos e duplicaria o #405. O PR saiu de um worktree
novo criado a partir de `origin/main`, com os 17 arquivos deste trabalho e nada
mais.

### O caminho até a VPS (não é o merge)

A VPS **não** segue a `main`. Ela roda `hostgator-setup-kit/update.sh`, que puxa
imagem **por número de versão**:

```
git tag -l 'v*' --sort=-v:refname | head -1      # o alvo do update.sh
APP_IMAGE=ghcr.io/melgarafael/deskcommcrm:1.9.1  # o que está lá hoje
```

Então merge do #408 **não basta**. A sequência é:

1. merge do #408 na `main`;
2. disparar o workflow `release` (`workflow_dispatch`) → ele lê `.changes/`,
   calcula **v1.9.2** e abre um PR de release;
3. merge do PR de release → o CI cria a tag `v1.9.2` → `publish-image.yml`
   publica as três imagens;
4. na VPS: `bash hostgator-setup-kit/update.sh`.

A tag nasce no CI de propósito (`docs/doctrine/versionamento.md`): tag criada na
máquina de alguém é o ponto onde o número deixa de ser revisável, e **a tag é o
seletor do que cada VPS baixa**.

### Estado da VPS antes do deploy (medido)

| item | valor |
|---|---|
| árvore dona do projeto Docker | `/root/DeskcommCRM` (via label `working_dir`) |
| versão | tag exata `v1.9.1`, commit `9507920c` |
| domínio | responde **307** (redireciona ao login — o esperado) |
| contêineres | `app`, `worker`, `scheduler` todos `healthy` |
| proxy | **Caddy**, não Traefik — o `-f docker-compose.traefik.yml` NÃO se aplica aqui |
| `.update.lock` | resíduo de 27/08 do `agent.sh`; é `flock`, e o `update.sh` não o usa |

O `update.sh` faz backup automático antes e re-aplica `supabase/baseline.sql`
(idempotente). Este PR **não muda schema**, então a re-aplicação é no-op.
