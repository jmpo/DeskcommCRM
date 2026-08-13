# Runbook — o worker congelado: diagnóstico e remediação

> ## Estado do ensaio: **U6-b EXECUTADO em 2026-08-13, com uma ressalva que muda o procedimento**
>
> O ensaio rodou numa VPS real, com estado legado **reproduzido** (não simulado): clone
> no commit `ee520110` de 2026-07-31 — o mesmo em que o worker era `build:`-only —,
> baseline daquela época aplicado, e a stack subida por `docker compose up -d`, que
> construiu o worker na máquina, como acontece na instalação de um cliente.
>
> **O que passou:** o worker migrou de imagem local (`2174fb4f`) para a publicada
> (`ghcr.io/…/deskcomm-worker`, `revision=31096584…`); as três imagens ficaram pinadas
> na mesma versão; o volume do WAHA, a customização do operador no `.env` e o banco
> sobreviveram (69 → 73 tabelas, a migração esperada).
>
> **A ressalva, e ela é o motivo de este aviso continuar aqui:** a **primeira** execução
> do `update.sh` NÃO consertou o worker. Quem executa a transição é o `update.sh` que
> está no disco do cliente — o antigo —, e ele só sabe gravar `APP_IMAGE`. O worker cai
> no default do compose novo, e enquanto o canal `stable` não existir no registry esse
> default não resolve. Só a **segunda** execução, já com o kit novo em disco, pinou as
> três e trocou a imagem. Ver §5.0.
>
> **Ainda não coberto:** o app não subiu contra um Supabase real (o ensaio usou um
> Postgres em contêiner como `SUPABASE_DB_URL`), então auth, storage e PostgREST não
> foram exercitados; e a sessão do WhatsApp foi representada por um arquivo marcador no
> volume, não por um número pareado de verdade.

---

## 1. O que aconteceu

O serviço `worker` — o processo que faz o agente de IA atender 24/7 — não tinha `image:`
no `docker-compose.prod.yml`, só `build:`. Duas consequências do Docker Compose, ambas
medidas:

- `docker compose pull` **pula** serviço build-only (`"Skipped - No image to be pulled"`);
- `docker compose up -d` **sem `--build`** recria o contêiner sobre a imagem que já existe.

Resultado: o worker era compilado na VPS no dia da instalação e **nenhum `update.sh`
jamais o reconstruiu**. O app, o banco e todo o resto atualizavam normalmente; só o
agente ficava parado.

**Não é teoria.** Medido na instalação de produção do projeto em 2026-08-13:

| serviço | imagem | criada |
|---|---|---|
| app | `ghcr.io/melgarafael/deskcommcrm:1.2.1` (registry) | 2026-08-12 |
| worker | `deskcommcrm-worker` (local, sem labels OCI) | **2026-07-31** |

O contêiner do worker havia sido **reiniciado naquele mesmo dia** e continuava rodando a
imagem de 31/07 — restart não reconstrói.

## 2. Impacto — o que o cliente perdeu

Entre a data da imagem do worker e a versão instalada do app, **9 commits e 399 linhas**
em `workers/` nunca chegaram. Traduzido para o que se sente na operação:

| O que o cliente percebe | O que estava por trás | Corrigido em |
|---|---|---|
| **O agente responde duas vezes à mesma mensagem** | dois runtimes consumiam o mesmo evento de despacho | `#129`, 2026-08-06 |
| **Áudio e imagem que o cliente manda não viram conteúdo** — a IA responde como se nada tivesse chegado | a mídia só era derivada num dos canais | 2026-08-11 |
| **O agente vaza dado interno na conversa** (URL de sistema, ID, jargão de CRM) | não havia separação entre quem fala e quem executa | `#181`, 2026-08-07 — vazamento medido caiu de 3-em-10 para 1-em-10 turnos |
| **Sentimento classificado errado, sem erro visível** | a classificação falhava por truncamento e ficava em silêncio | 2026-08-01 |
| **Resposta atribuída ao canal errado no histórico** | `sent_via` inválido | `#126`, 2026-08-04 |

**O que NÃO aconteceu:** nenhum dado foi perdido ou corrompido. Conversas, contatos,
leads, mídia no storage e a sessão pareada do WhatsApp são estado do banco e dos volumes
— o worker congelado deixou de *melhorar*, não de funcionar. Uma instalação afetada
atendeu o tempo todo; atendeu com o agente de dois meses atrás.

## 3. Diagnóstico — antes de qualquer conserto

Read-only, seguro em produção, não precisa de clone:

```bash
curl -fsSL https://raw.githubusercontent.com/melgarafael/DeskcommCRM/main/hostgator-setup-kit/diagnostico.sh | bash
```

Ou, se o operador já tem o projeto no disco:

```bash
cd /caminho/do/projeto && bash hostgator-setup-kit/diagnostico.sh
```

Códigos de saída: `0` não afetada · `1` afetada · `2` inconclusivo (Docker parado, stack
no chão, instalação não encontrada).

**Por que não basta olhar o `/api/v1/health`:** até a versão que conserta isto, ele lê
`npm_package_version`, que é `undefined` sob `CMD ["node","server.js"]`. Toda instalação
responde `0.1.0` — afetada ou não. Foi medido na produção.

---

## 4. As duas rotas

### Rota A — Completa: `update.sh` (**recomendada**)

Leva a instalação para a versão nova inteira: app, worker e scheduler pinados na mesma
versão, `.env` com as chaves novas, `baseline.sql` re-aplicado, backup antes.

```bash
cd /caminho/do/projeto
bash hostgator-setup-kit/update.sh
```

### Rota B — Cirúrgica: só o worker passa a puxar imagem publicada

Blast radius mínimo — não toca no banco, não muda o app, não re-aplica o baseline.

```bash
cd /caminho/do/projeto
# 1. anote o estado atual, para poder voltar
docker compose -f docker-compose.prod.yml ps --format '{{.Service}}|{{.Image}}' > /root/estado-antes.txt
# 2. aponte SÓ o worker para a imagem publicada da versão que o app já roda
grep '^APP_IMAGE=' .env            # → confirme a versão, ex.: …deskcommcrm:1.2.1
printf 'WORKER_IMAGE=ghcr.io/melgarafael/deskcomm-worker:<a-mesma-versão>\n' >> .env
printf 'WORKER_PULL_POLICY=missing\n' >> .env
# 3. recrie apenas o worker
docker compose -f docker-compose.prod.yml up -d --no-deps worker
```

> Numa VPS com proxy reverso próprio, **todo** `docker compose` leva também
> `-f docker-compose.traefik.yml`. Omitir recria o contêiner sem as labels de roteamento
> e o domínio inteiro passa a responder 404, com o contêiner `healthy`.

### Qual usar, e por quê

**Recomendo a Rota A.** A B parece mais segura por mexer em menos, e essa aparência é
justamente o risco: ela deixa o worker numa versão nova e o **banco** na versão antiga.
O worker é o consumidor de `ai_agent.dispatch_requested` e escreve em tabelas que
migrations recentes alteraram — parear código novo com schema velho é a combinação que
nem o CI nem o ensaio cobrem, porque não é um estado que o produto produz sozinho.

A Rota A é mais longa e é o caminho que o `update.sh` já percorre em toda atualização:
backup do banco antes, `baseline.sql` idempotente, healthcheck no fim, e rollback
automático do app se ele não voltar.

**A B tem um uso legítimo:** quando o `update.sh` não pode rodar agora — janela de
manutenção fechada, ou o operador quer separar o conserto do agente da atualização geral.
Nesse caso, escolha a tag do worker **igual à do app** (`grep APP_IMAGE .env`), nunca a
mais nova. É o que mantém código e schema no mesmo par.

---

## 5. Passo a passo — Rota A

Cada passo traz o rollback ao lado. `[ENSAIADO]` foi executado no U6-b de 2026-08-13;
`[NÃO VERIFICADO]` continua sem prova.

### 5.0. Leia isto antes: **a primeira execução pode não bastar**

Medido no ensaio, e é o achado que muda o procedimento.

Quem executa a transição é o `update.sh` que está **no disco do cliente** — o antigo. Ele
faz `git checkout` da tag nova (o que já troca o `docker-compose.prod.yml` pelo novo) e
só então segue com a própria lógica, que conhece apenas `APP_IMAGE`. O worker cai no
default do compose novo, `:stable`.

No ensaio, `stable` ainda não existia no registry. Resultado medido, na ordem:

```
dc pull  → Image ghcr.io/…/deskcommcrm:… Pulled          (o app veio)
         → Error: ghcr.io/…/deskcomm-worker:stable: not found
         → Error: ghcr.io/…/deskcomm-scheduler:stable: not found
up -d    → o worker seguiu no contêiner que já existia
worker   → antes 2174fb4f · depois 2174fb4f   (NÃO mudou)
```

A **segunda** execução, já com o kit novo em disco, chamou `gravar_imagens`, pinou as três
na mesma versão e trocou a imagem do worker pela publicada.

**Consequências práticas:**

1. **A release precisa existir antes de o parque atualizar.** Com `stable` publicado, o
   default resolve e a primeira execução já traz o worker. A ordem do
   [runbook de ativação](ativar-packaging.md) — merge → pacotes públicos → check
   obrigatório → **release** — não é burocracia: é a precondição desta remediação.
2. **Rode `update.sh` duas vezes** numa instalação legada, e confira com o
   `diagnostico.sh` entre uma e outra. O README do kit já pedia isso por outro motivo
   ("a primeira execução ainda é a do script velho"); aqui o motivo é este, e é medido.
3. **Confirme pelo detector, não pelo fim do script.** A primeira execução termina sem
   erro fatal — ela puxa o app, aplica o banco e sobe. Nada na tela diz que o worker
   ficou para trás. Só o `diagnostico.sh` responde isso.

### A1. Diagnosticar e registrar o antes `[ENSAIADO]`

```bash
cd /caminho/do/projeto
bash hostgator-setup-kit/diagnostico.sh | tee /root/antes-remediacao.txt
docker compose -f docker-compose.prod.yml ps --format '{{.Service}}|{{.Image}}' >> /root/antes-remediacao.txt
cp .env /root/.env.antes-remediacao        # o .env tem segredos: chmod 600
chmod 600 /root/.env.antes-remediacao
```

**Rollback:** nada a desfazer — só leitura e cópia.

### A2. Confirmar que há espaço em disco `[NÃO VERIFICADO]`

O update baixa três imagens novas sem apagar as antigas, e faz um dump do banco.

```bash
df -h / | tail -1
docker system df
```

**Se faltar espaço:** `docker image prune -a` remove imagens **sem contêiner usando**.
Não use `docker system prune --volumes` — ele apaga volumes, e é lá que mora a sessão
pareada do WhatsApp.

### A3. Rodar o update `[ENSAIADO — ver §5.0: pode exigir duas execuções]`

```bash
bash hostgator-setup-kit/update.sh
```

O que ele faz, na ordem (lido do script, não ensaiado ponta a ponta): instala o cron do
agente de atualização → **backup do banco** → `git checkout` da tag → re-aplica o
`baseline.sql` → grava as três imagens no `.env` → `dc pull` → `dc up -d` → espera o app
ficar saudável.

**Rollback:** se o app não voltar, o script sai com código 1 e **não** reverte sozinho
quando executado à mão (o rollback automático existe no `agent.sh`, o caminho do botão na
tela). Manual:

```bash
cp /root/.env.antes-remediacao .env
docker compose -f docker-compose.prod.yml up -d
```

O banco **não** volta com isso. Para voltá-lo, `bash hostgator-setup-kit/restore.sh` com o
dump que o A3 gerou — e ele pede confirmação digitada, de propósito.

### A4. Verificar que o worker mudou de verdade `[ENSAIADO]`

```bash
bash hostgator-setup-kit/diagnostico.sh          # esperado: exit 0, "NÃO está afetada"
curl -s localhost:3000/api/v1/health | grep -o '"version":"[^"]*"'
grep -E '^(APP|WORKER|SCHEDULER)_IMAGE=' .env    # as três na MESMA versão
```

### A5. Verificar que nada se perdeu `[ENSAIADO em parte — ver a tabela]`

O que precisa estar intacto, e o que responde por cada um:

| O quê | Como conferir | Onde mora |
|---|---|---|
| Sessão do WhatsApp pareada | a conexão continua `WORKING` na tela de Conexões, **sem pedir QR de novo** | volume `waha-data` |
| Mídia recebida | uma conversa antiga ainda abre áudio/imagem | Supabase Storage |
| Conversas, contatos, leads | contagens iguais às de antes | banco (Supabase) |
| Certificado HTTPS | o domínio responde 307 sem aviso de certificado | volume do Caddy |
| Customizações do operador no `.env` | `diff /root/.env.antes-remediacao .env` mostra **só** as chaves de imagem | `.env` |

O `update.sh` mexe em exatamente três chaves do `.env` (`APP_IMAGE`, `APP_PULL_POLICY` e
— desde esta versão — as do worker e do scheduler) e preserva o resto, inclusive o que o
operador acrescentou à mão. **O `diff` do A5 é o que prova isso, e é uma das coisas que o
U6-b precisa confirmar.**

---

## 6. Evidência do ensaio (U6-b, 2026-08-13)

**Ambiente.** VPS real, num diretório isolado (`deskcomm-ensaio`, projeto compose próprio,
sem publicar portas), lado a lado com uma instalação de produção que **não foi tocada** —
confirmado antes e depois: 7 contêineres, mesmo uptime, Caddy respondendo 308.

**Estado legado reproduzido, não simulado.** Clone no commit `ee520110` (2026-07-31), o
mesmo em que `docker-compose.prod.yml` tinha o worker `build:`-only; `baseline.sql`
daquela época aplicado (69 tabelas); `docker compose up -d` construiu o worker na
máquina — imagem `deskcomm-ensaio-worker` (`2174fb4f`), **sem labels OCI**, diferente da
imagem da produção, provando que foi construída ali e não reaproveitada.

**Sintoma confirmado antes de consertar:** `diagnostico.sh` → exit 1, "ESTÁ afetada".

| Verificação | Antes | Depois | |
|---|---|---|---|
| imagem do worker | `deskcomm-ensaio-worker` (`2174fb4f`, sem labels) | `ghcr.io/…/deskcomm-worker:docs-doutrina-packaging` (`2082c65e`, `revision=31096584…`) | ✅ |
| `.env` — as três imagens | só `APP_IMAGE` | as três na mesma versão, `pull_policy: missing` | ✅ |
| marcador no volume `waha-data` | presente | **presente** | ✅ |
| customização do operador no `.env` | presente | **presente** | ✅ |
| tabelas no banco | 69 | 73 (a migração esperada) | ✅ |
| `diagnostico.sh` | exit 1 (afetada) | **exit 0 (não afetada)** | ✅ |

**O que exigiu duas execuções:** ver §5.0. A primeira não trocou o worker.

### O rollback tem um efeito colateral, e ele foi medido

Restaurar o `.env` anterior (sem `WORKER_IMAGE`) e subir **não devolve o estado exato**.
O compose no disco já é o novo, então o worker volta ao default `:stable`; como `stable`
não existia, o Compose **construiu localmente e taggeou a imagem como
`ghcr.io/melgarafael/deskcomm-worker:stable`**.

O resultado é uma imagem local **com nome de registry** — que parece publicada e não é:

```
revision: []                                          ← vazio: não veio do CI
source:   [https://github.com/melgarafael/DeskcommCRM] ← veio do LABEL do Dockerfile
está no registry de verdade? NAO
```

O `diagnostico.sh` detectou corretamente (exit 1). Vale registrar por quê: esse é
exatamente o caso que uma sabotagem do detector tinha inventado — imagem local
retagueada — e que a primeira versão dele, decidindo pelo **nome** da imagem, deixava
passar. O caso apareceu sozinho, na vida real, produzido pelo próprio rollback.

**Portanto:** depois de um rollback, rode o `diagnostico.sh`. Voltar o `.env` desfaz a
pinagem, não o estado da imagem.

### O que este ensaio NÃO cobriu

- **Supabase real.** O `SUPABASE_DB_URL` apontou para um Postgres em contêiner
  (`pgvector/pgvector:pg17`, o mesmo do CI). O `baseline.sql` foi exercitado de verdade;
  auth, storage e PostgREST não.
- **Sessão de WhatsApp pareada de verdade.** Foi representada por um arquivo marcador
  dentro do volume `waha-data`. Prova que o volume sobrevive ao ciclo; não prova que uma
  sessão pareada continua `WORKING`.
- **`install.sh` da época de ponta a ponta.** Ele exige um projeto Supabase (bootstrap do
  owner pela Admin API). O estado legado foi produzido pelo `docker compose up -d` — que
  é literalmente a linha que o passo 9 do `install.sh` executa, e é a que produz o worker
  construído localmente.
- **Uma release de verdade.** O ensaio usou uma tag local (`vdocs-doutrina-packaging`)
  apontando para as imagens já publicadas da branch. Foi o artifício que permitiu ensaiar
  o caminho completo antes de haver release — e é por isso que o cenário do `stable`
  inexistente apareceu.

## 7. Decisão do operador — sempre

Nada aqui roda sozinho. Não existe atualização automática nem compulsória: o agente de
atualização da tela só age quando alguém clica em "Atualizar agora", e o `update.sh` só
roda quando alguém o executa.

Uma instalação afetada **está funcionando** — atende, responde, registra. O que ela não
tem são as correções dos últimos dois meses no agente. Quem escolhe o momento de fechar
essa distância é quem opera o servidor.
