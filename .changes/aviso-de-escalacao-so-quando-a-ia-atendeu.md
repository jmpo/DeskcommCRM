---
impacto: nada_mudou
secao: corrigido
titulo: O aviso de "a IA acionou o time" só sai se a IA realmente atendia a conversa — e nunca repetido
---

Numa instalação sem agente publicado, o detector de sentimento — que roda para
toda mensagem, com ou sem agente — podia escalar uma conversa e o sistema
enviava ao cliente "Esse caso é melhor resolvido por uma pessoa. Já acionei o
time." do nada: ninguém de IA jamais tinha falado com ele. E quando o envio
travava e era redirigido, o mesmo aviso saía várias vezes seguidas.

Medido em produção: 5 mensagens fantasma para 2 clientes reais em uma tarde.

Agora o aviso só sai quando a IA de fato falou naquela conversa antes (sem
retirada, nada a anunciar), e no máximo uma vez por conversa a cada 24 horas —
contado no banco, onde redrive não engana.
