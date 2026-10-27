---
impacto: nada_mudou
secao: corrigido
titulo: O número oficial responde ao provedor na hora, e a mensagem entra logo depois
---
O provedor do número oficial dá por falha a entrega que não recebe resposta em 5 segundos e manda de novo. Com volume, a entrada de uma mensagem passava desse tempo (medido numa instalação: 368 de 1.304 mensagens em 30 dias tiveram uma entrega vencida; nenhuma se perdeu, mas cada uma foi processada mais de uma vez). Agora a mensagem nova é guardada no arquivo do webhook, a resposta sai em seguida e o processamento acontece logo depois. Se o arquivo não conseguir guardá-la, a resposta pede ao provedor que mande de novo, em vez de dizer que recebeu. Se o servidor reiniciar no meio, o reprocessamento que já roda a cada minuto termina o que ficou, uma vez só e sem duplicar a mensagem; se mesmo assim ela não entrar depois de vinte tentativas, um aviso na Central pede para conferir as conversas no painel do provedor. Status de entrega, edições, modelos e o estado do número continuam como antes. Nada muda na VPS. Crédito: @jmpo.
