-- 0403 — a etapa do funil pode mandar um evento de conversão à plataforma de anúncio.
--
-- A venda (`Purchase`) só é reportada no GANHO. Em quem vende com pagamento na
-- entrega, o ganho é a entrega — dias depois do clique —, e o otimizador da
-- plataforma aprende devagar com um sinal tão tardio. O momento de intenção
-- forte é outro: o cliente CONFIRMAR o pedido. Esse momento é uma etapa, e qual
-- etapa é decide a organização.
--
-- `evento_de_conversao`: o evento que sai quando um negócio ENTRA na etapa.
-- Vocabulário fechado nos eventos que a Meta aceita para conversa de WhatsApp e
-- que não são a venda: InitiateCheckout, LeadSubmitted, AddToCart. Coluna nova,
-- sem linha legada — o CHECK não quebra o update.sh de ninguém.
--
-- Quem lê: `lib/conversoes/etapa.handler.ts` (evento `lead.stage_changed`), pelo
-- mesmo caminho da venda — canal com a ponte primeiro, Meta direta depois, e o
-- livro-razão `ad_conversion_dispatches` impede enviar duas vezes.
alter table public.crm_stages
  add column if not exists evento_de_conversao text;

do $$ begin
  alter table public.crm_stages
    add constraint crm_stages_evento_de_conversao_check
    check (evento_de_conversao is null or evento_de_conversao in ('InitiateCheckout', 'LeadSubmitted', 'AddToCart'));
exception when duplicate_object then null; end $$;

comment on column public.crm_stages.evento_de_conversao is
  'Evento de conversão enviado à plataforma de anúncio quando um negócio entra nesta etapa (0403).';
