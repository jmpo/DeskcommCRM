# A ponte entre agendamento, follow-up e Radar

> **Mapa de enxerto — CAL-W0-PONTE.** Onde a existência de um compromisso
> marcado muda (ou deveria mudar) a decisão de cobrar o lead.
> **Nenhuma linha de produção foi alterada por este documento.**
> Medido em 2026-08-30 contra `origin/main` no SHA `26d384c6` (Release 1.10.1).
> Toda afirmação abaixo traz `arquivo:linha` e o comando que a re-mede — número
> sem comando envelhece calado, e este documento vai ser lido depois de o código
> ter andado.

---

## A pergunta, na voz de quem opera

> "O paciente marcou consulta para quinta. Por que o sistema mandou pra ele
> *'ainda tem interesse?'* na quarta?"

Essa mensagem custa mais que uma mensagem: ela diz ao cliente que a empresa não
sabe o que já combinou com ele.

---

## O achado central

**A régua já foi escrita, o índice que a serve já existe, e ninguém a executa.**

`lib/agenda/tipos.ts:112` declara `SITUACAO_SEGURA_O_LEAD` com este comentário,
literal:

> *"É a lista que responde 'este lead tem consulta marcada?' — a pergunta que o
> motor de follow-up e o Radar de Risco fazem antes de cobrar alguém."*

O motor de follow-up e o Radar **não fazem essa pergunta**. Medido:

```bash
# quem consome a régua declarada — só a definição e o derivado dela
grep -rn "SITUACAO_SEGURA_O_LEAD" lib app workers tests supabase
#   lib/agenda/tipos.ts:112  (a definição)
#   lib/agenda/tipos.ts:138  (SITUACOES_VIVAS, derivado — tipos.ts:137)
#   → ZERO consumidores fora do arquivo que a define

# o follow-up ou o Radar LEEM a tabela de compromissos?
grep -rn 'from("calendar_appointments")' lib/followup lib/leads app/app/radar
#   → vazio

# controle positivo do comando acima — ele acha quem de fato lê?
grep -rln 'from("calendar_appointments")' lib app
#   lib/lgpd/export-collector.ts, lib/agenda/consulta.ts,
#   app/app/agenda/page.tsx, app/api/v1/agenda/agendamentos/_handler.ts
```

> ⚠️ **A sonda tem de procurar LEITURA, não menção**, e isto é conserto de uma
> versão anterior deste documento. `grep -rln "calendar_appointments"` nos mesmos
> diretórios devolve `lib/leads/escopo-de-funil.ts` — e a ocorrência lá é um
> **comentário** (`escopo-de-funil.ts:76`) explicando por que "retorno" e
> "compromisso" são coisas diferentes no vocabulário do agente. Aquele arquivo
> não consulta a tabela, e é consumido pelo agente
> (`lib/ai/runtime/tools.ts`, `lib/agent-engine/agent/agent-config.ts`), não pelo
> Radar. Uma sonda por menção teria feito este documento afirmar que o Radar lê a
> agenda — o oposto do achado.

O índice existe e até traz a consulta pretendida **escrita como comentário**
(`supabase/baseline.sql:15268`, e o cabeçalho logo acima):

```sql
--    where l.lead_id = $1 and l.target_kind = 'appointment'
--      and a.organization_id = $2 and a.status in ('pending','confirmed')
--      and a.starts_at > now();
create index if not exists calendar_appointments_org_vivos_idx
  on public.calendar_appointments (organization_id, starts_at)
  where status in ('pending','confirmed');
```

Isto é o anti-pattern nº 3 do `CLAUDE.md` — *evento sem consumer* — na forma
mais silenciosa dele: não há erro, não há teste vermelho, não há tela quebrada.
Há uma constante que **afirma** um comportamento, e a afirmação está errada
desde o dia em que foi escrita. Quem ler `tipos.ts` para entender o sistema sai
achando que a supressão existe.

---

## Onde a decisão é tomada hoje — os três pontos

### 1. Radar de Risco — `lib/leads/risk-radar.ts:68`

`classifyRisk({ lastActivityAt, now, inFlight, window })` decide o balde do
lead. **`inFlight` é a única coisa que hoje "segura" um lead**, e ela olha
`cron_jobs` — não a agenda (`lib/leads/risk-radar.ts:49`):

> `/** há follow-up agendado no futuro (cron_jobs kind='at' enabled) para o contato. */`

A montagem está em `lib/leads/radar-de-risco.ts:170`
(`.eq("kind", "at")` + `.gt("next_run_at", nowIso)`), e a classificação em
`lib/leads/radar-de-risco.ts:207`.

**Consequência exata:** o lead com consulta marcada para amanhã e sem follow-up
programado cai em `em_risco` ou `critico` (`risk-radar.ts:76-82`) e **aparece no
Radar como se ninguém estivesse cuidando dele**. Está errado nos dois sentidos:
polui a fila de quem triagem, e esconde os que precisam mesmo.

### 2. O cálculo de score — `lib/leads/score-writer.ts:69`

Chama o mesmo classificador com **`inFlight: false` fixo**, e o balde entra na
fórmula como sinal `risco` (`score-writer.ts:75-83`). Um lead com consulta
marcada é pontuado como lead esfriando.

### 3. Motor de follow-up — `lib/followup/engine.ts:480`

`avancarEnrollmentAtivo` executa o nó do fluxo. A primeira guarda é
`steps_taken > MAX_STEPS` (`engine.ts:496`); **não há nenhuma guarda que
pergunte pela agenda** em todo o arquivo (medido: `grep -c
"calendar_appointments" lib/followup/engine.ts` → 0).

---

## A aresta que existe para atravessar

Ela é curta, e não precisa ser criada:

| Ponta | Onde | Medido |
|---|---|---|
| `calendar_appointments.contact_id` | coluna da tabela | `awk '/create table if not exists public.calendar_appointments/,/^\);/' supabase/baseline.sql \| grep contact_id` |
| índice por contato | `supabase/baseline.sql:15271` | `calendar_appointments_contato_idx (contact_id, starts_at desc)` |
| `followup_enrollments` é **por contato** | `supabase/baseline.sql:7365,7369,7560` | `grep -n "followup_enrollments (organization_id, contact_id)" supabase/baseline.sql` |
| o Radar agrupa **por contato** | `lib/leads/radar-de-risco.ts:155` | `contactIds` alimenta as três consultas |
| vínculo com o lead (para a timeline) | `app/api/v1/agenda/agendamentos/_handler.ts:516` | `crm_lead_links` com `target_kind='appointment'` |

**Ligar por `contact_id`, não por `lead_id`.** Os três consumidores já
trabalham por contato, o índice por contato existe, e o vínculo com o lead é
polimórfico e opcional — passar por ele custaria uma junção a mais para
responder pior. O vínculo continua servindo ao que ele foi feito: mostrar o
compromisso na timeline do negócio.

---

## A régua de supressão proposta

> **Um contato está PROTEGIDO quando existe compromisso dele com
> `status ∈ {pending, confirmed}` e `starts_at > now()`.**
> Protegido não entra no Radar como risco, não pontua como esfriando, e não
> recebe cobrança automática de follow-up.

É exatamente `SITUACOES_VIVAS` (`lib/agenda/tipos.ts:137`) — a constante órfã
passa a ter consumidor, e o índice parcial do baseline passa a ser usado pela
consulta para a qual foi criado.

⚠️ **A régua vale para compromisso marcado PELO PRODUTO.** Quem marcou direto no
Google não é alcançado, e o motivo é estrutural — ver a seção dos dois limites,
adiante. O limite tem de aparecer na tela; supressão que funciona "às vezes" sem
dizer quando é pior que supressão nenhuma.

### Os casos de borda, decididos

**`pending` protege.** "Aguardando confirmação" é alguém que já escolheu um
horário. Cobrar interesse de quem acabou de pedir hora é o pior momento
possível — e a régua irmã, a de ocupação de horário (`lib/agenda/ocupados.ts:69`),
já decidiu do mesmo jeito, com a razão escrita: *"é um pedido em cima daquele
horário"*. Duas réguas do mesmo produto respondendo diferente sobre o mesmo
estado é o que faz a agenda e o funil discordarem na cara do operador.

**Compromisso no passado sem fecho NÃO protege.** Um `confirmed` cujo
`starts_at` já passou e que ninguém marcou como `completed` ou `no_show` é
justamente o caso em que cobrar é **certo**: ou a pessoa veio e ninguém
registrou, ou ela faltou. Nos dois casos há assunto pendente. Por isso a régua
exige `starts_at > now()` e não apenas o status — sem essa metade, um
compromisso esquecido em `confirmed` protegeria o contato **para sempre**, e o
lead sumiria do Radar em silêncio. Este é o modo de falha mais caro da régua, e
é o que a condição de tempo evita.

**`cancelled` não protege, e é o gatilho oposto.** Cancelou e não remarcou é
exatamente quem precisa ser procurado. Idem `no_show`. Ambos já estão fora de
`SITUACOES_VIVAS` por construção.

**`completed` não protege.** Consulta realizada encerra aquele compromisso; o
próximo passo (retorno, proposta, pós-venda) é outra decisão, e é o follow-up
que existe para tomá-la.

### O que a régua deliberadamente NÃO faz

Ela **não silencia** o lead — muda o balde e a elegibilidade, não apaga o
registro. Um contato protegido deve continuar visível, com a razão à vista
("tem consulta quinta, 14:00"), pelo mesmo princípio que o resto desta base
aplica: falhar fechado na ação, aberto na informação. Supressão que some com a
linha vira "o lead desapareceu do Radar" e custa uma caçada.

---

## Pontos de enxerto, na ordem de menor risco

| # | Onde | Forma | Por que nesta ordem |
|---|---|---|---|
| 1 | `lib/leads/radar-de-risco.ts:158-176` | uma quarta consulta no `Promise.all`, por `contact_id`, alimentando um `protegidoAte: Map<string, string>` | Leitura pura, sem efeito externo. O balde novo (`protegido`) entra em `RiskBucket` e o compilador cobra os `Record` exaustivos — `BUCKET_RANK` (`risk-radar.ts:88`) reprova sozinho se alguém esquecer |
| 2 | `lib/leads/risk-radar.ts:68` | `classifyRisk` ganha `protegidoAte?: Date` e decide **antes** de `inFlight` | Função pura, testável sem banco, com `now` já injetado. É onde a régua tem de morar para os três chamadores concordarem |
| 3 | `lib/leads/score-writer.ts:69` | passar o mesmo dado em vez de `inFlight: false` | Depende de 2. Sem isto, tela e score discordam sobre o mesmo lead |
| 4 | `lib/followup/engine.ts:496` | guarda ao lado da de `steps_taken`, devolvendo desfecho próprio (não `exhausted`) | É o único com **efeito externo** (mensagem sai). Entra por último, quando os três de leitura já estiverem provados |

| 5 | `lib/automation/actions/send-whatsapp.ts` e `send-ai-message.ts` | a mesma guarda do item 4, ao lado das que já existem (opt-out, janela, cap) | Medido **depois** da primeira versão deste mapa: as regras automáticas cobram sem passar pelo motor de follow-up. Mesmo efeito externo, mesma régua |

**Sobre o desfecho do item 4:** reusar `exhausted` (`node-handlers.ts:20`) seria
mentir na timeline — o fluxo não se esgotou, ele foi adiado por um motivo que
tem data. Um desfecho próprio é o que permite ao operador ler *"não cobrei
porque tem consulta quinta"*, e é o que fecha o laço de retorno do invariante 7
do Sistema Vivo.

---

## Os dois limites da régua — MEDIDOS depois da primeira versão

Estavam como NÃO MEDIDO e o Maestro os pediu primeiro, com a razão certa: os
dois **mudam a régua**, não a detalham. Medidos em 2026-08-30, mesmo SHA.

### 1. Quem marcou pelo Google NÃO é protegido — e é limite estrutural

O compromisso vindo do Google **não entra em `calendar_appointments`**. O sync
grava em outra tabela (`app/api/v1/cron/agenda-google-sync/route.ts:219` →
`calendar_external_events`), e essa tabela **não tem `contact_id`**:

```bash
awk '/create table if not exists public.calendar_external_events/,/^\);/' supabase/baseline.sql \
  | grep -E "contact_id|organization_id|external_calendar_id|starts_at|status"
#   organization_id, external_calendar_id, starts_at, ends_at, status
#   → NÃO existe contact_id
```

Não é campo esquecido: `calendar_external_events` é **ocupação de horário**,
anônima por natureza — ela responde *"este horário está livre?"*, nunca *"de
quem é este compromisso?"*. Não há por onde ligar o evento ao contato, e
inventar essa ligação (por e-mail do convidado, por exemplo) seria adivinhação
sobre dado de terceiro.

**Consequência para a régua:** ela protege quem marcou **pelo produto**, e não
protege quem o atendente marcou direto no Google. Isso precisa ser dito na tela,
não escondido — senão a clínica que trabalha pelo Google conclui que a supressão
"às vezes funciona". É o caminho que a 1.10.1 acabou de pôr no ar, então o
limite nasce visível.

**E a frase tem de dizer QUAL caminho protege, nunca "pode não funcionar"**
(requisito do `@Maestro (2)`, e ele está certo: aviso de incerteza não é
informação, é isenção). A redação proposta, para quem for implementar:

> *"Compromissos marcados aqui pausam a cobrança automática. Os que você marca
> direto no Google não — para nós eles são só horário ocupado, sem o nome de
> quem vai ser atendido."*

Ela diz o que funciona, o que não funciona **e por quê** — e o porquê é o que
impede a leitura de "o produto é inconstante".

### 2. Os três enxertos NÃO bastam — há mais dois caminhos de cobrança

As regras automáticas mandam mensagem **sem passar pelo motor de follow-up**:

```bash
ls lib/automation/actions/          # send-whatsapp.ts, send-ai-message.ts, …
grep -rln "followup" lib/automation/actions/
#   → só start-message-flow.ts (que INICIA um fluxo; as outras duas não tocam)
```

`send-ai-message.ts:1-14` diz, no próprio cabeçalho, que é irmã de
`send-whatsapp.ts` e compartilha as guardas (contato, opt-out, janela do número,
cap diário, espaçamento) e o caminho de saída (`sendMessageHandler`). **Nenhuma
dessas guardas é a agenda.** Uma regra "3 dias sem resposta → manda mensagem"
cobra o paciente com consulta marcada, e os três enxertos de leitura não a
alcançam.

#### O cabeçalho que prova o achado — e é vítima dele

`send-ai-message.ts:10-13`, literal:

> *"As guardas são importadas da irmã de propósito. Reescrevê-las aqui faria a
> ação nova nascer sem o conserto que a antiga acabou de receber — que é
> exatamente o modo de falha que este repo já pagou antes: **conserto por
> instância, não por classe**."*

Quem escreveu compartilhou as guardas **justamente para não repetir esse erro**.
E a agenda nunca entrou na lista, porque a lista foi fechada antes de a agenda
existir. O arquivo que melhor entende a lição é vítima dela — e nenhuma revisão
pega isso, porque a lista **parece completa por dentro**. (Observação do
`@Maestro (2)`, medindo os 12 arquivos de `lib/automation/actions/`:
`send-whatsapp.ts` e `send-ai-message.ts` dão `followup=0, agenda=0`; só
`start-message-flow.ts` toca follow-up, com 3 ocorrências.)

**Consequência para a ordem de enxerto:** o item 4 deixa de ser o último. As
duas ações de automação são um quinto ponto, e ele tem o mesmo efeito externo do
motor de follow-up. A régua precisa morar num lugar que os dois consumam — a
função pura do item 2 é o candidato, por dois motivos: **dois** consumidores com
efeito externo passam a depender dela, e função pura é testável sem banco, sem
cron e sem WhatsApp, o que torna a **sabotagem barata** — e sabotagem barata é a
única que alguém repete daqui a seis meses.

---

## NÃO MEDIDO

Escrito como não medido de propósito — quem for implementar precisa saber onde
o mapa acaba:

- **O custo da consulta nova no Radar.** Não medi plano de execução nem tempo. O
  índice `calendar_appointments_contato_idx` existe e cobre `(contact_id,
  starts_at desc)`, mas **não confirmei** que o planejador o escolhe para o
  `in (...)` de N contatos que o Radar monta.
- **Quantos leads mudariam de balde hoje, em base real.** Não rodei a consulta
  contra nenhum banco com dados de produção. Sem esse número não dá para dizer
  se a régua é uma correção de borda ou uma mudança visível na fila.
- **O comportamento em produção.** Nada aqui foi exercitado em tela ou contra
  banco; este documento é leitura de código no SHA declarado.

---

## Comandos que re-medem este documento

```bash
# a régua declarada continua sem consumidor?
grep -rn "SITUACAO_SEGURA_O_LEAD" lib app workers tests supabase

# o follow-up e o Radar continuam cegos para a agenda? (LEITURA, não menção)
grep -rn 'from("calendar_appointments")' lib/followup lib/leads app/app/radar
grep -rln 'from("calendar_appointments")' lib app   # controle positivo

# os pontos de decisão ainda estão onde este mapa diz?
grep -n "export function classifyRisk" lib/leads/risk-radar.ts
grep -n "classifyRisk({" lib/leads/radar-de-risco.ts lib/leads/score-writer.ts
grep -n "export async function avancarEnrollmentAtivo" lib/followup/engine.ts

# a aresta por contato continua existindo?
grep -n "calendar_appointments_contato_idx" supabase/baseline.sql
```

Se qualquer um destes devolver outra coisa, **este documento venceu** — e o
comando é quem diz isso, não a data no cabeçalho.
