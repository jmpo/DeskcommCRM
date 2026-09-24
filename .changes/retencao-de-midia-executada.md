---
impacto: capacidade_nova
secao: adicionado
titulo: A retenção de mídia passa a ser cumprida — arquivos vencidos e órfãos saem do armazenamento
---

A configuração «retenção de mídia» da organização existia no formulário e não
era cumprida por nada: todo áudio, foto, vídeo e PDF do WhatsApp ficava no
armazenamento para sempre, inclusive os de conversas já apagadas. Numa
instalação no Supabase gratuito isso chega ao limite de 1 GB, e o Supabase
restringe o projeto inteiro — login, mensagens e agente param juntos.

Agora, uma vez por dia, o CRM separa para remoção:

- o arquivo de mensagem mais antigo que a retenção da organização (mínimo 30
  dias). A mensagem continua na conversa, com texto e horário; o arquivo aparece
  como «Mídia indisponível»;
- o arquivo que nenhuma mensagem ou contato usa mais (o rastro de conversa
  apagada), depois de um dia de carência.

As imagens de cabeçalho de modelo nunca são tocadas. A remoção sai pela mesma
fila da anonimização da LGPD, com reintento. Quem precisa guardar mídia por mais
tempo aumenta a retenção em Configurações — o padrão segue 365 dias.
