---
impacto: nada_mudou
secao: corrigido
titulo: O assistente consegue gravar o pedido no negócio do cliente que está atendendo
---

Ao fechar um pedido, o assistente chamava a atualização do negócio com o id do contato em vez do id do negócio, e a gravação era recusada: o pedido confirmado ficava sem valor e sem os dados de entrega. Quando o id recebido é o do contato da conversa em curso e ele tem um único negócio aberto, a gravação agora vai para esse negócio. Com dois negócios abertos, nada muda: a escolha continua sendo de quem opera.

Contribuição de @jmpo (#1583).
