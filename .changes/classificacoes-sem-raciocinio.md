---
impacto: nada_mudou
secao: corrigido
titulo: O agente responde mais rápido quando o modelo econômico raciocina
---

Antes de cada resposta, o agente classifica o estágio da conversa e confere se a mensagem tenta manipulá-lo. Essas duas verificações usam o modelo mais barato do provedor, e os mais novos raciocinam antes de responder até quando a resposta é uma palavra só. Na OpenAI, desde que o GPT-6 Luna virou o modelo econômico, isso somava perto de 1 segundo a cada resposta, e até 2 segundos nas mais lentas. Agora as duas verificações pedem ao modelo que não raciocine: medido em 60 conversas reais, a espera delas caiu de 1,7 s para 0,9 s (de 3,5 s para 1,3 s nas mais lentas). O mesmo vale para o Claude Haiku 5.5 quando ele entrar no catálogo: de 2,0 s para 0,9 s. Também custam menos, porque deixam de pagar o raciocínio. Quem ajustou o esforço de raciocínio da OpenAI no servidor (`OPENAI_REASONING_EFFORT`) continua com o ajuste nas demais chamadas. Nada a fazer na VPS.

Contribuição de @jmpo.
