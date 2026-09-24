-- 0397 — o bucket dos sons dos avisos da Central.
--
-- A organização escolhe o som da venda confirmada e o do pedido de pessoa
-- (`lib/notifications/sons-da-org.ts`). O arquivo vive aqui, PRIVADO: só o
-- service_role lê e grava, pela rota `app/api/v1/settings/sons`, e a tela
-- recebe URL assinada. O caminho fica em `organizations.settings.sons_de_aviso`
-- (jsonb, sem coluna nova). Teto e tipos são os da lib — 1 MB, MP3/OGG/WAV.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('org-sounds', 'org-sounds', false, 1048576, array['audio/mpeg', 'audio/ogg', 'audio/wav'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
