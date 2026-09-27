---
impacto: nada_mudou
secao: corrigido
titulo: A fila de remoção de mídia avisa quantas linhas ela expurgou
---

O cron diário de retenção de mídia deixa de apagar a fila em silêncio. Ele já
expurgava as linhas de mídia que saíram do bucket havia mais de 90 dias — o
que impedia a fila de crescer sem teto — mas não dizia quantas: a contagem
saía só da função interna, não chegava nem no registro de auditoria nem na
resposta do cron. Agora quem administra o sistema vê, na trilha de auditoria e
no retorno da rotina, quantas linhas da fila saíram na rodada, inclusive nas
rodadas em que o expurgo foi a única coisa que aconteceu. Nada a fazer para
quem já roda o sistema: é contabilidade, não mudança de comportamento do que
é removido.

Contribuição de @webtecnica (#1765).
