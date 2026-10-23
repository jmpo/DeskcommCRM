-- manifest: **O webhook da conexão por um clique passa a ser ÚNICO na instalação.** Só o comentário de `channel_sessions.zernio_webhook_id` muda: na conexão por um clique a coluna guarda o id da assinatura COMPARTILHADA da instalação (filtrada aos perfis das conexões ativas; id e segredo em `platform_config`), que a remoção do canal não apaga; na chave própria segue sendo a assinatura do número. Nenhum dado nem coluna novos.
--
-- 0761 — o webhook da conexão por um clique passa a ser ÚNICO na instalação.
--
-- A 0760 gravava em `zernio_webhook_id` a assinatura que a instalação registrava
-- PARA CADA NÚMERO. O provedor limita as assinaturas por conta e recomenda um
-- endpoint para todos os clientes: agora as conexões por um clique entram por
-- um webhook só da instalação (id e segredo em `platform_config`, filtrado aos
-- perfis das conexões ativas), e a coluna guarda o id dessa assinatura
-- compartilhada. Na chave própria, segue sendo a assinatura do número.
--
-- Só documentação no banco: nenhum dado muda, nenhuma coluna nova.
comment on column public.channel_sessions.zernio_webhook_id is
  'Assinatura de webhook que entrega os eventos desta conta, registrada pela INSTALAÇÃO. Na conexão por um clique é o webhook ÚNICO da instalação (compartilhado, filtrado aos perfis das conexões ativas; id em platform_config): a remoção do canal tira o perfil do filtro e NÃO apaga a assinatura. Na chave própria é a assinatura do número (filtrada à conta), apagada na remoção. Nulo quando o operador configurou o webhook à mão. Migrations 0760 e 0761.';
