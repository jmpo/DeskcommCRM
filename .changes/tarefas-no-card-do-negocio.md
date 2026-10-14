---
impacto: capacidade_nova
secao: adicionado
titulo: Tarefas dentro do card do negócio, com responsável, e o selo de pendências no quadro
---

Até aqui a tarefa só nascia na tela de Tarefas, que não pergunta de qual negócio ela é — na prática toda tarefa ficava avulsa, e as presas a um negócio só vinham de automação. Agora o dossiê do negócio (o painel que abre ao clicar no card) ganha a seção **Tarefas**, entre o contato e a linha do tempo: o botão **Nova tarefa** cria a tarefa já presa àquele negócio (e ao contato dele), e dali mesmo dá para concluir, reabrir, editar e apagar. O formulário de tarefa ganha o campo **Responsável**, com as mesmas pessoas que podem receber uma conversa; quem cria pelo card já nasce como responsável. No quadro, o card mostra um selo discreto com as tarefas em aberto daquele negócio, em vermelho quando alguma passou do prazo — sem crescer o card. Na tela de Tarefas, cada linha diz de qual negócio é a tarefa, com atalho para ele, e quem é o responsável. O servidor passou a recusar um responsável que não faz parte da equipe (antes o usuário de qualquer empresa da instalação era aceito). Criar e mexer em tarefa continua sendo do papel `agent` para cima; `viewer` vê. Nenhuma mudança de banco.

Contribuição de @profpeque.
