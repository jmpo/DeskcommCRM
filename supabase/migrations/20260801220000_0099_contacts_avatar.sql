-- 0099 — foto de perfil do contato (avatar do WhatsApp).
--
-- POR QUE GUARDAR O ARQUIVO, E NÃO A URL
-- --------------------------------------
-- O WAHA devolve a foto como URL assinada do CDN do WhatsApp:
--
--   https://pps.whatsapp.net/v/t61.24694-24/...&oe=6A7B69D2&...
--                                              ^^^^^^^^^^^ expira
--
-- Esse `oe` é a validade. Medido numa instalação real: **9 dias**. Guardar a URL
-- crua faria TODOS os avatares quebrarem em pouco mais de uma semana, sem erro
-- nenhum — só o rosto sumindo da tela.
--
-- Então o arquivo é baixado e persistido no bucket privado `whatsapp-media`,
-- exatamente como já se faz com a mídia das mensagens (media_storage_path). O
-- que fica aqui é o CAMINHO no bucket; a tela pede URL assinada na hora.
--
-- Isso também é o que torna a LGPD cumprível: foto de perfil é dado pessoal e
-- precisa sumir na anonimização. Só dá para garantir a remoção de um arquivo que
-- é nosso — sobre uma URL do WhatsApp não se tem controle nenhum.
--
-- `avatar_updated_at` existe para o refresh periódico saber o que está velho:
-- as pessoas trocam de foto, e sem esse carimbo o cron não teria como escolher
-- quem revisitar (nem evitar martelar a API do WAHA a cada rodada).
--
-- Ambas NULLABLE: contato sem foto (ou de antes desta migration) é o estado
-- normal, não um defeito. NULL em `avatar_updated_at` = nunca tentado.

alter table public.contacts
  add column if not exists avatar_storage_path text,
  add column if not exists avatar_updated_at   timestamptz;

comment on column public.contacts.avatar_storage_path is
  'Caminho da foto de perfil no bucket whatsapp-media. NULL = sem foto. Guardamos o arquivo, não a URL do WhatsApp, que expira em ~9 dias.';
comment on column public.contacts.avatar_updated_at is
  'Quando a foto foi buscada pela última vez. NULL = nunca tentado. Usado pelo cron de refresh para escolher quem revisitar.';

-- Índice parcial: o cron procura "quem está velho ou nunca foi buscado". Sem ele
-- essa varredura vira seq scan na tabela inteira a cada rodada.
create index if not exists idx_contacts_avatar_refresh
  on public.contacts (organization_id, avatar_updated_at nulls first);

notify pgrst, 'reload schema';
