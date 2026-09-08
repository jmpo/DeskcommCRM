---
impacto: nada_mudou
secao: corrigido
titulo: Abrir uma conversa por link direto para de esperar a lista carregar
---

Quem chega ao Inbox por um link direto para uma conversa — `/app/inbox/<id>`, o clique num
aviso, o retorno de uma tela de IA — via a coluna do contato (demandas, memória, negócios)
demorar vários segundos a mais que o resto da tela, sobretudo quando a conversa não aparece na
aba aberta (por exemplo, uma conversa já encerrada).

A causa era ordem, não peso: a busca da conversa por id só começava depois de a lista de
conversas terminar de carregar — e a lista carrega **duas vezes** por abertura de tela, porque
o filtro da aba Fila muda quando o sistema descobre se a organização tem atendimento automático
de pé. Eram quatro idas ao servidor em fila indiana antes de o painel do contato poder começar.

Agora a busca da conversa sai junto com a lista, e não atrás dela.
