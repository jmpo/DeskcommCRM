---
impacto: capacidade_nova
secao: adicionado
titulo: A venda que veio de anúncio vai para a Meta pelo próprio canal intermediado — sem token nem dataset no CRM
---

Quando o número de WhatsApp está conectado por um canal intermediado que já
liga o conjunto de dados da Meta ao número (na tela "Conversions" do
provedor), a venda fechada no CRM — botão Ganhar, arrasto no kanban ou mover
em lote — agora é reportada por esse canal: o evento `Purchase` sai com o
valor, a moeda e o id da conversa, e o provedor completa o vínculo com o
clique do anúncio.

Antes, a única via era a conexão direta com a Meta (Configurações ›
Conversões), que exige token e dataset próprios; quem já tinha tudo
configurado do lado do canal via a venda ficar como pendência.

A venda sai por UM caminho só: canal com a ponte primeiro, Meta direta
quando não houver. A resposta é lida por inteiro — um evento recusado dentro
de uma resposta 200 aparece como recusa na tela de conversões, não como
enviado.
