-- manifest: **O lembrete da agenda sai por modelo aprovado quando a janela de 24 h do cliente fechou (fork jmpo).**
--
-- 9500 — `calendar_event_types.reminder_meta_template_id`
--
-- O lembrete da agenda sai como texto livre. Num número que só aceita texto livre
-- de quem escreveu nas últimas 24 h (o oficial da Meta, direto ou pelo parceiro),
-- a reserva feita dias antes cai fora da janela e o cron pula o lembrete (#2595):
-- o cliente não é avisado. Com o modelo aprovado do número no tipo, o lembrete
-- sai por ele. As variáveis, por posição: primeiro nome, dia e hora, título,
-- endereço (`lib/agenda/lembrete-por-modelo.ts`).
--
-- Chave estrangeira com `on delete set null`: apagar o modelo volta o tipo ao
-- comportamento de antes, nunca quebra o lembrete. Quem garante que o modelo é
-- da MESMA organização e do MESMO número é o cron, na leitura.
--
-- Número da faixa do fork (9500+), longe dos que a upstream usa.
-- Idempotente.

alter table public.calendar_event_types
  add column if not exists reminder_meta_template_id uuid
    references public.meta_templates(id) on delete set null;

comment on column public.calendar_event_types.reminder_meta_template_id is
  'Modelo aprovado do número para o lembrete quando a janela de 24 h do cliente fechou (migration 9500, fork). Variáveis por posição: primeiro nome, dia e hora, título, endereço.';
