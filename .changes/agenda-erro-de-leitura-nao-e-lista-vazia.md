---
impacto: nada_mudou
secao: corrigido
titulo: A tela de tipos de agendamento não diz mais "nenhum tipo" quando a leitura falhou
---

Quando a consulta dos tipos de agendamento falhava (por exemplo, num banco em que faltava uma coluna), a tela mostrava "Nenhum tipo de agendamento ainda", mesmo com tipos ativos cadastrados, e quem tentava criar um deles recebia um erro de duplicidade sem explicação. Agora a falha de leitura aparece como falha, com a mensagem do banco e a orientação de recarregar ou avisar quem cuida da instalação. Crédito: @bonito-system.
