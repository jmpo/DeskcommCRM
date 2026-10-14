---
impacto: capacidade_nova
secao: adicionado
titulo: Campos personalizados condicionais — o campo aparece só quando outro tem o valor certo
---
Os campos do funil agora podem declarar quando aparecem. Em Configurações, na linha de cada campo, a caixa "Mostrar só quando" monta a condição em três partes: o campo que manda, o operador (é igual a, contém, é maior que) e o valor. Enquanto a condição não for atendida, o campo some da ficha do contato, do dossiê do negócio e do painel do CRM na caixa de entrada — a pessoa deixa de preencher (ou deixar em branco) o que não se aplica.

Esconder não apaga nada: o valor que já estava gravado continua no registro e volta à tela assim que a condição for cumprida, e o campo oculto não é validado como obrigatório. Campo cuja condição aponta para um campo apagado, ou que forma um laço com outro, continua aparecendo — uma condição que não dá para ler nunca esconde nada.

Nada muda para quem não configurar a condição: sem ela, todos os campos continuam aparecendo sempre, como hoje.

Contribuição de @webtecnica, a partir da issue #2728.
