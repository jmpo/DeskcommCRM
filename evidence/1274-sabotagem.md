# 1274 — SABOTAGEM PREVISTA, escrita ANTES do fix

Escopo: filtro por VÁRIAS etiquetas (E/OU) nas três listas (Inbox, Funil, Contatos),
com `?tag=` singular preservado.

Data da escrita: **antes** de qualquer linha do fix. Regra do time: uma previsão escrita
depois do verde é racionalização, não prova.

## As seis sabotagens, e o que CADA uma tem de reprovar

| # | Sabotagem | Teste que tem de ficar VERMELHO | Por que este teste é o certo |
|---|---|---|---|
| S1 | Apagar o ramo `modo === "ou"` e deixar o E cair no caminho de OU (bug de copy-paste) | `tests/unit/filtro-multi-etiqueta.test.ts` → caso "OU com duas etiquetas" | E e OU com DUAS etiquetas produzem o MESMO `or=(tags.cs.{a},tags_do_contato.cs.{a},…)` byte a byte quando o ramo se perde. A diferença só aparece no OPERADOR (`ov` vs `cs`) e no TERMO ÚNICO da disjunção. Só um teste que compara as DUAS formas byte a byte pega. |
| S2 | Trocar `tags.cs.{a,b},tags_do_contato.cs.{a,b}` por `tags.cs.{a},tags.cs.{b},tags_do_contato…` no modo E | mesmo arquivo → caso "E com duas etiquetas" | O `cs` de um valor só cada é OU; "vip E orçamento" viraria "vip OU orçamento" e a lista cresceria. O teste afirma o LITERAL do array com as duas etiquetas em cada caixa. |
| S3 | Deletar a linha `modo` do `_handler.ts` (`aplicarMarcadores(query, q.tag, q.modo)`) | `tests/unit/filtro-multi-etiqueta.test.ts` → caso "o handler aplica o modo que veio da URL" | `modo` tem Default (`"e"`), então TypeScript NÃO reclama de omitir: a assinatura continua válida e a UI escolher "OU" simplesmente filtraria por E, sem erro. Só um teste que passa `modo: "ou"` ao handler e compara o `or=` emitido pega. |
| S4 | Voltar o schema a `tag: conversationTagSchema.optional()` (sem `string[]`) | mesmo arquivo → caso "o schema aceita `?tag=vip&tag=orçamento`" | Com o schema singular, `getAll` devolve array e o `safeParse` RECUSA com 422: a tela de multi-seletor ficaria vermelha na cara do operador. O teste passa o array ao schema e afirma que passa. |
| S5 | Trocar a compatibilidade do `?tag=` singular: fazer o caminho de TAMANHO 1 passar pelo plural e produzir `cs.{vip}` por outro caminho | mesmo arquivo → caso "`?tag=vip` continua byte a byte o `or=` de antes" + `tests/unit/inbox-filtro-de-tag-le-as-duas-caixas.test.ts` (já existente) | O singularity é o CONTRATO de hoje (link salvo, aba aberta, chamada de API). A regressão é silenciosa: a lista volta quase toda, porque `cs.{vip}` e `ov.{vip}` casam a mesma conversa — o sintoma é "o filtro parou de filtrar", e nenhum teste de contagem nota. O teste afirma IGUALDADE BYTE A BYTE com a forma singular de sempre. |
| S6 | No Funil, deixar `applyFilters` casando `cardTemMarcadores` com a lista INTEIRA em vez do modo (ou seja, ignorar `tagMode`) | `tests/unit/filtro-multi-etiqueta.test.ts` → caso "funil: E e OU dão listas diferentes" + `tests/unit/funil-filtro-de-tag-le-as-duas-caixas.test.ts` (existente) | O funil filtra no CLIENTE, sem erro e sem 422: a diferença entre E e OU é só o TAMANHO da lista, e ninguém lê o sintoma. Comparar as duas listas com o MESMO conjunto de leads é o que torna isso vermelho. |

## O que NÃO é sabotagem (e por quê não entra na lista)

- **Migration nova.** A #1274 não pede coluna: o filtro é sobre `conversations.tags` (0033) e
  o campo calculado `tags_do_contato` (0323), que já aceitam "contém todos" e "sobrepõe".
  Uma migration aqui seria mudança de schema sem pedido — proibido pelo escopo desta fatia.
- **Mixing de caixas** ("vip na conversa E orçamento no contato"). A issue registra isso
  como decisão de produto pendente, e é a razão de o E ser "mesma caixa". Sabotar isso
  seria implementar o que a issue NÃO pediu.
- **Teto de 20 etiquetas.** Acima de 20 nenhum marcador escrito hoje seria filtrável
  (é o mesmo teto de `conversationTagsSchema`), então o limite não tira nada de quem filtra.

## Como cada uma é executada

Cada sabotagem é uma troca EXATA de texto num arquivo de produção, aplicada por um
script que (1) falha em voz alta se o texto velho não existir mais, (2) copia o
arquivo antes, (3) roda a suíte-alvo por `dk-heavy.sh`, (4) restaura o arquivo da
cópia. O script roda UMA vez só, com as seis sabotagens em sequência, e no fim
roda a suíte de novo: o `rc=0` final é a prova de que nenhum arquivo ficou
sabotado. Sem o medido, a tabela acima é apenas uma intenção — e uma intenção não
é prova de cobertura.

Comando (sempre fora do terminal do gateway):

```
export PATH=/root/.hermes/node/bin:$PATH
/root/workspace/bin/dk-heavy.sh /root/workspace/wt-dk1274 onda4-1274-sab2 \
  'python3 /root/.hermes/profiles/webtecnica/cache/scratch/sab-1274.py'
/root/workspace/bin/dk-heavy.sh --wait onda4-1274-sab2 280
```

Suíte-alvo de cada sabotagem: `tests/unit/filtro-multi-etiqueta.test.ts` +
`tests/unit/funil-filtro-de-tag-le-as-duas-caixas.test.ts`.

## RESULTADO MEDIDO (2026-09-28, rc lido do `/tmp/dk-onda4-1274-sab2.log`)

**BASE sem sabotagem: rc=0. APÓS restaurar as seis: rc=0.** As seis sabotagens:
rc=1 VERMELHO, e em todas o teste MIRADO foi o que quebrou.

| # | rc | O teste mirado quebrou | Outros testes que também ficaram vermelhos |
|---|---|---|---|
| S1 | 1 (VERMELHO) | SIM — `E com DUAS etiquetas: \`cs\` com a LISTA nas DUAS caixas` | `E e OU com as MESMAS etiquetas só diferem no OPERADOR`; `conversas, modo E: um \`or=\` só, com \`cs\` e as DUAS etiquetas num literal` (6 no total) |
| S2 | 1 (VERMELHO) | SIM — `E com DUAS etiquetas` | 12 testes, incluindo `conversas, modo E` e `conversas, modo OU` |
| S3 | 1 (VERMELHO) | SIM — `conversas, modo OU: o MESMO literal com o operador \`ov\`` | só ele (2 contagens do mesmo caso) |
| S4 | 1 (VERMELHO) | SIM — `a repetição na URL vira LISTA no schema` | `\`?tag=vip\` (um só) continua sendo ACEITO`; `o marcador é normalizado item a item`; `\`modo\` fora dos dois é RECUSADO (422)`; `CONTROLE: mais etiquetas que o teto é recusado` (10 no total) |
| S5 | 1 (VERMELHO) | SIM — `UMA etiqueta pelo caminho plural é IDÊNTICA ao caminho singular` | `conversas, uma etiqueta só: continua o \`or=\` singular de sempre` (4 no total) |
| S6 | 1 (VERMELHO) | SIM — `OU devolve quem tem QUALQUER uma — e a lista CRESCE` | `CONTROLE: a diferença entre E e OU é o TAMANHO`; **`E do funil NÃO aceita mistura de caixas`** (6 no total) |

### Duas correções sobre o que estava previsto acima (a previsão é de antes do fix)

1. **S3 — o caso previsto não existe.** A tabela previa o caso "o handler aplica o
   modo que veio da URL"; ele nunca foi escrito com esse nome. O caso que cumpre a
   mesma função é `conversas, modo OU: o MESMO literal com o operador \`ov\``, do
   bloco novo do handler, e foi ele que quebrou.
2. **S5 — a sabotagem como estava escrita é um APAGÃO, não uma troca.** Fazer o
   caminho de tamanho 1 passar pelo plural NÃO muda o byte: `listaDeValoresParaOr(["vip"])`
   produz exatamente `arrayDeUmValorParaOr("vip")`, porque a lista de um é o
   literal de um item. Trocar só o caminho deixaria o teste verde — e um teste
   verde sob sabotagem não é prova. A sabotagem EXECUTADA muda o OPERADOR da forma
   singular (`cs` → `ov` no predicado do marcador), que é a mesma classe de
   regressão (o `?tag=vip` deixa de ser o de sempre) e sim é detectável: o caso
   byte a byte e o caso do handler ficaram vermelhos.
   **Corolário para quem vier depois:** a delegação de tamanho 1 para a função
   singular é redundante por construção — quem a remover não é pegue por este
   arquivo, e sim pelo operador. O que segura o contrato é a comparação byte a
   byte com a função singular, não o desvio de caminho.

### Um achado que a sabotagem S6 revelou (e que o fix já tinha corrigido)

Quando o `passaMarcador` do funil foi sabotado para `every` sobre a união das três
caixas, ficaram vermelhos NÃO só os casos de E/OU, mas também
`E do funil NÃO aceita mistura de caixas`. É esse o caso: a primeira versão desta
fatia (escrita antes desta medição) fazia exatamente aquele `every` — aceitava
"vip na conversa E orçamento no negócio", que o servidor recusa. O teste que
cobriu a mistura de caixas é o que transformou um defeito silencioso (duas telas
com respostas diferentes para o mesmo filtro) em vermelho.
