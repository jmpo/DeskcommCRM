# TRIAGEM.md — o procedimento de triagem de PR

Este arquivo é o procedimento inteiro. O comando `/triagem-de-pr` é só a porta.

**Por que ele existe, em números medidos em 2026-08-04:** em 60 dias — janela que cobre 100% do
histórico do repositório — seis humanos externos abriram 16 PRs. **Quinze mergeados, zero fechados.**
A taxa de rejeição é zero. O gargalo nunca foi qualidade: os 7 PRs de um mesmo contribuidor
esperaram **5h08min** entre serem abertos e o CI começar, e depois foram do verde ao merge em 25
minutos. Um PR de contribuidor de primeira viagem ficou horas com zero execuções de workflow, zero
reviews, e um `Vercel :: FAILURE` como único check — a primeira coisa que ele viu deste projeto.

Logo: **esta triagem não é um porteiro.** Ela é uma desbloqueadora que, depois de desbloquear,
verifica com rigor. As duas coisas nesta ordem.

E o rigor precisa ser real, porque a branch protection **não exige review humano** (`required_pull_request_reviews`
está ausente; os 7 PRs citados foram mergeados com `reviews=0`). Não há rede embaixo de você. Erro
seu entra na `main`.

---

## 0. Âncora — o passe que impede o erro mais caro

```bash
git fetch origin
MAIN=$(git rev-parse origin/main)
```

Daqui em diante, **todo** config de gate se lê por `git show origin/main:<path>`. Nunca do disco.

Motivo, medido: o checkout de trabalho deste repositório já esteve numa branch que **não tinha**
`scripts/lint-channels.ts`, não tinha `.github/workflows/e2e.yml` e ainda usava Node 20 no
`perf.yml`. Uma triagem lendo o disco rodaria 4 gates onde a `main` exige 6, e declararia verde um PR
que o CI reprova.

O SHA curto da `main` entra em **toda** afirmação daí em diante. Número sem SHA não compara.

---

## 1. Acolhida — em minutos, sem uma linha de avaliação

Nesta ordem:

1. Liberar o CI do fork. **`gh pr checks` NÃO mostra workflow parado esperando aprovação** — ele
   lista só o que já começou, então um PR travado aparece como se não tivesse check nenhum, e a
   acolhida promete "acabei de liberar" sem ter liberado. A sonda que enxerga é o campo
   `conclusion`, e o comando é este, sempre, antes de qualquer outra coisa:

   ```bash
   BR=$(gh pr view <n> --json headRefName --jq .headRefName)
   for id in $(gh api repos/{owner}/{repo}/actions/runs \
                 --jq "[.workflow_runs[] | select(.head_branch==\"$BR\" and .conclusion==\"action_required\")] | .[].id"); do
     gh api -X POST "repos/{owner}/{repo}/actions/runs/$id/approve"
   done
   ```

   Medido: o PR #176 ficou **6 dias** aberto e, quando a triagem chegou, os 4 workflows estavam em
   `action_required` desde o primeiro push. A latência de 5h08min que este arquivo cita não é
   lentidão de runner — é PR esperando um humano clicar.
2. Aplicar `triagem:recebido` + as labels `area/*` derivadas do diff.
3. Postar a acolhida — molde em `references/resposta-ao-contribuidor.md`, seção *Acolhida*.

A acolhida **não contém juízo técnico**. É isso, e só isso, que a torna segura de ser automática:
ela não pode estar errada sobre o mérito porque não fala do mérito. Ela diz três coisas — o `Vercel`
vermelho é esperado em fork e não é culpa dele, o CI está sendo liberado, e quando vem o veredito.

Todo comentário desta triagem abre com a âncora invisível `<!-- triagem-de-pr:v1:pass=N -->`. Leia as
âncoras existentes antes de escrever: **acolhida nunca é postada duas vezes.**

---

## 2. Raio de dano — decide quanto se gasta

| o PR toca | passes obrigatórios |
|---|---|
| só `.md`, `docs/` | 3, 9, 10 |
| só `package.json`/lockfile | 3, 4 (linha de dependência), 9, 10 |
| `app/`, `components/`, `lib/` | todos |
| `supabase/` | todos, com o passe 4 reforçado |
| `hostgator-setup-kit/`, `docker-compose*`, `Dockerfile` | todos + instalação do zero + **GET externo** |
| `.github/workflows/` vindo de fork | todos + leitura linha a linha |

PR pequeno não paga pipeline caro. Isso não é economia: triagem lenta reintroduz exatamente a
latência que ela existe para matar.

---

## 3. Gates — na prévia do merge, não na branch

`strict=false` na branch protection: um PR pode ser mergeado sem estar rebasado na `main`. O CI testa
**a branch**; o que vai para produção é **o merge**. Monte a prévia e rode ali:

```bash
git merge-tree --write-tree origin/main <sha-do-pr>
```

É o único jeito de pegar convergência independente — dois lados que mudaram a mesma coisa de formas
compatíveis textualmente e incompatíveis semanticamente. Isso não gera conflito e não aparece em
nenhum gate.

Gates da `main`: `typecheck`, `lint`, `lint:channels`, `test:unit`, `test:shell`, `test:db`, `build`.
Obrigatórios no merge — **cinco**, e não confie nesta lista: meça.

```bash
gh api repos/melgarafael/DeskcommCRM/branches/main/protection \
  --jq '.required_status_checks.contexts|join(", ")'
# em 2026-08-14: verify, build-and-size, invariants, e2e, imagens-ok
```

Esta linha listava **três** — faltavam `e2e` e `imagens-ok`, que são justamente os que
cobrem o artefato que o self-hoster instala. Um triador que a lesse declararia "passou os
obrigatórios" tendo rodado 3 de 5, dentro do próprio documento que o `CLAUDE.md` aponta
como o lugar onde medir contra a régua errada é o modo de falha número um.

Meça exit code **direto**. `cmd | tail` devolve o exit do `tail` — verde falso.

---

## 4. Complemento — o que os gates não provam

`references/complemento-do-ci.md`, linha por linha, com o gatilho de cada uma no diff.

Esta é a razão de a triagem existir tecnicamente. Repetir o que o CI já faz é teatro; o trabalho é o
que ele **não** alcança — e a lista não é opinião, é o que foi medido: a tripla de migration é
guardada por um hook local que fork nunca roda, o teste de RLS cobre uma lista fixa de tabelas,
`no-console` é aviso sem `--max-warnings`, e nenhum job testa o instalador.

---

## 5. Reprodução — no SHA da `main`, não na base do PR

Todo PR que alega consertar bug:

1. Reproduza o defeito na `main` **de hoje**. Se não reproduzir, o PR pode estar consertando algo que
   já foi consertado — e isso é achado, não bloqueio.
2. Prove que a correção o remove.
3. Se a borda é infraestrutura, **suba a dependência real** e varie **uma variável por vez**,
   reportando a matriz. `--dry-run`, `config` e `typecheck` são renderização, não comportamento.

E a pergunta que tem nome próprio — **falha-em-verde**:

> Qual é a sonda que declara sucesso, e ela mede o mesmo caminho que o usuário usa?

Um instalador já terminou com "Instalação concluída! Acesse: https://$DOMAIN" com o site inalcançável
de fora, porque a sonda de saúde era interna ao contêiner. Num produto self-host essa é a classe mais
cara de todas: o cliente não descobre que está quebrado.

---

## 6. O teste que falta — o passe de maior rendimento

Se o PR muda comportamento e não traz teste, **você escreve o teste**. Não peça primeiro.

O valor não é o teste. É que escrevê-lo obriga a percorrer o caminho inteiro, e é ali que aparece o
defeito que ninguém pediu para procurar. Rendimento real desta casa: uma cascata de LGPD que deixava
o arquivo no bucket enquanto a auditoria registrava que havia redigido; um realtime que refazia a
mesma primeira página; o tratamento de erro de um script inteiro inalcançável por `pipefail` + `set -e`.

Depois de escrever: **sabote e veja vermelho.** Sabote a linha cuja perda seria **silenciosa** — a que
convergência independente sobrescreve sem gerar conflito e que nenhum grep de símbolo detecta.
Presença de símbolo não é comportamento. E ao medir discriminância, reverta **só o fonte**: reverter o
commit leva os testes junto e devolve verde.

---

## 7. Teste a própria suspeita antes de exigir

Regra de cultivo, não de rigor.

Numa revisão desta casa, duas acusações do revisor foram testadas e **caíram** antes de virar
exigência. Noutra, um contribuidor foi mandado consertar um bug que não existia na `main` — teria
escrito código para um defeito inexistente.

**Nenhum pedido sai sem a medição que prova o defeito, anexada ao pedido.** Se você não mediu, não é
pedido: é pergunta, e vai redigido como pergunta.

---

## 8. Reconciliação

O que é mecânico, você conserta — branch própria, commit próprio, creditando o autor original no
corpo. O que muda uma decisão de projeto do contribuidor **volta como pergunta**, nunca como patch
por cima. A diferença entre as duas é: você consegue enunciar a intenção dele e mostrar que ela
sobrevive à sua mudança?

---

## 9. Veredito com proveniência

```
VEREDITO: MERGEAR | MERGEAR+ISSUE | SEGURAR
main: <sha curto>            prévia do merge: <tree>
MEDIDO:      <o quê> — <comando> — <saída observada>
NÃO MEDIDO:  <o quê> — <por quê>
BLOQUEADOR:  <arquivo:linha> — <o defeito> — <como reproduzir>
VERSÃO:      <patch | minor | major | nenhuma> — <o que o dono da VPS precisa fazer>
```

**`NÃO MEDIDO` é campo obrigatório.** Veredito sem ele é recusado pelo cético e não vai para o PR.
Ausência de dado herda a frase otimista de quem escreve; escrever o vazio explicitamente é o que
impede isso.

Aplique a label do desfecho: `triagem:pronto`, `triagem:bloqueado` ou `triagem:decisao`.

---

## 10. Resposta que faz voltar

`references/resposta-ao-contribuidor.md`. As três regras duras:

- **Creditar pelo nome** o que o contribuidor achou ou mediu.
- **Nunca cobrar como descuido um gate que não está documentado.** Quando acontecer, conserte a
  documentação no mesmo movimento e diga que a falha é do projeto.
- **Nunca pedir sem medição anexada** (passe 7).

Uma ressalva honesta, para não fingirmos saber: que creditar medição faça o contribuidor voltar é
**hipótese** — ninguém perguntou a ele. A alavanca que É mensurável, e que você reporta, é o **tempo
entre abrir o PR e a primeira resposta humana**.

---

## 11. Catraca — o passe que impede esta triagem de ser eterna

Todo defeito que os gates não pegaram vira **gate novo** ou dívida com issue aberta.

A consequência é a parte elegante: a tabela do passe 4 é a **lista de tarefas do CI**. Cada linha que
vira gate de verdade é uma linha que a triagem para de fazer à mão. Este procedimento deve ficar mais
leve com o tempo. Se estiver ficando mais pesado, o passe 11 não está sendo cumprido.

---

## 12. A versão — porque merge na `main` não é entrega

**O self-hoster puxa imagem publicada por número de versão.** Um PR que para na `main` existe só no
repositório: nenhuma VPS de cliente o recebe, nunca. Triar até o merge e ir embora deixa o trabalho
do contribuidor a meio caminho — ele fica no repo, e o cliente segue com o defeito.

A lei é [`docs/doctrine/versionamento.md`](../docs/doctrine/versionamento.md). O que muda para você:

### O fragmento é bloqueador, e você o escreve quando falta

Todo PR que muda comportamento traz um arquivo em `.changes/` declarando **o efeito no operador** —
`nada_mudou`, `capacidade_nova` ou `exige_acao` —, nunca o número. Sem ele o trabalho chega na VPS e
**não aparece na tela de atualização**: o dono ganha a mudança e não fica sabendo.

Contribuidor externo não conhece essa regra, e o passe 10 proíbe cobrar como descuido um gate não
documentado. Então: **se o PR muda comportamento e não traz fragmento, escreva você**, em branch
própria, creditando o autor — é reconciliação mecânica (passe 8), não decisão de projeto. Só volta
como pergunta se você não souber dizer o que muda para quem opera.

O impacto se **mede**, não se chuta. A pergunta é uma: *o operador precisa fazer alguma coisa?*
Variável nova é o caso clássico — abra `lib/env.ts` e veja se ela é `required()` ou
`optional().default(...)`. Obrigatória sem default é `exige_acao`, e o fragmento **precisa** trazer o
bloco `## Requer atenção` dizendo o que fazer. Confira com `pnpm release:conferir`.

### Seção de versão escrita à mão é BLOQUEADOR

Se o PR adiciona uma linha `## [X.Y.Z]` ao `CHANGELOG.md`, isso entra no veredito como bloqueador e
sai da branch. Ninguém digita número: ele é calculado dos fragmentos, e a seção é montada no corte.

Isso não é preciosismo — foi medido em 2026-08-27. O PR #354 trazia `## [1.7.0]` escrito à mão, e
até aquele dia o merge dele teria criado a tag e publicado as três imagens **sozinho**, pulando a
aprovação. O gatilho hoje exige a assinatura do corte, mas a linha à mão continua errada: ela
produziria uma seção duplicada, ou um número que já saiu.

```bash
gh pr diff <n> | grep -E '^\+## \[[0-9]+\.[0-9]+\.[0-9]+\]'   # vazio é o esperado
```

### Depois do merge, a versão sai — e isso não é opcional

O merge é do mantenedor (Fronteira). Assim que ele acontecer, **a versão precisa sair**, ou o passe
12 não foi cumprido. O corte é `Actions → release → Run workflow`: ele lê os fragmentos, calcula o
número, e abre um PR de release em português. O merge desse PR cria a tag, publica as três imagens e
move o canal `stable`.

Você não decide o número — ele é consequência do que os fragmentos declararam. O que você reporta ao
mantenedor, em lote, é: **quais PRs estão prontos e que versão eles produzem juntos**.

E confira o desfecho, porque "a tag saiu" não é "a versão chegou":

```bash
git ls-remote --tags origin 'refs/tags/vX.Y.Z'          # a tag existe
gh release list --limit 1                                # a release é a Latest
# e as três imagens no digest da versão, contra `stable` — receita em
# docs/runbooks/ativar-packaging.md
```

---

## Fronteira: o que você nunca faz

| você faz sozinho | é a palavra do mantenedor |
|---|---|
| liberar CI, rotular, acolher, comentar veredito | **mergear na `main`** |
| criar worktree, rodar gate, escrever teste, sabotar | **fechar um PR** |
| abrir issue e PR de follow-up | empurrar para a branch do fork alheio |
| consertar CONTRIBUTING/README/docs | **mergear o PR de release** (é ele que cria a tag) |
| escrever o fragmento que falta, e conferi-lo | |
| disparar `Run workflow` do `release` depois do merge | |

Sem perguntas de sim/não a cada passo: faça tudo, pare no merge, reporte em lote.

---

## Modos de falha que você vigia em si mesmo

Cada um destes foi cometido de verdade nesta casa, e é por isso que estão escritos:

1. Medir contra o disco em vez do SHA. Declare SHA + `git status` em toda afirmação.
2. `cmd | tail` mascara o exit code. Meça direto.
3. Presença de símbolo lida como comportamento. Sabote.
4. Reverter o commit leva os testes junto e devolve verde. Reverta **só o fonte**.
5. Dois agentes no mesmo worktree leem a sabotagem um do outro como bug. **Um worktree por agente.**
6. No zsh, `$var:caminho` come letras (modificadores `:c`/`:h`/`:t`). Use `${var}:caminho`.
7. `grep` vazio precisa de **controle positivo** — sem ele é indistinguível de instrumento morto.
8. Contagem absoluta medida em árvore contaminada mente. Reporte o **delta**.
9. `NÃO MEDIDO` ausente. É campo obrigatório.
10. Exigir sem medir (passe 7).
11. Tratar rede de segurança como durável só porque existe. Tag, backup e réplica também se medem.
