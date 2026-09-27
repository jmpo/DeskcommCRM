---
impacto: nada_mudou
secao: corrigido
titulo: A poda do histórico de captação passa a ordenar o lote e a dizer quando falha
---

A retenção do histórico de leads captados passou a apagar em lotes **ordenados**
(`id` ascendente, a mesma coluna e a mesma direção da poda de rascunhos), e a
falha do banco deixou de ser engolida: ela sobe, responde 500, grava a linha
`falhou` na trilha e chega ao Sentry — em vez de virar um "não havia nada
vencido" que não era verdade.

Sem ação para quem opera: as duas tabelas e os dois horizontes são os mesmos. O
efeito é que a poda deixa de poder escolher um subconjunto arbitrário a cada
lote, e uma instalação em que o banco recusa o DELETE passa a ser vista.
