-- manifest: **Campanha pelo número oficial com modelo aprovado (issue #1330, fatia 4).** `campaigns` ganha `message_mode` (`text` | `template`) e `provider_template_name`/`_language`/`_variables` — os nomes que a 0375 reservou ("Spec 12 §2.1") e deixou para "quando o canal oficial entrar". E o trigger de ack da campanha passa a ler `delivered_at`/`read_at`: o número oficial direto grava a entrega e a leitura só nos carimbos (o status fica `sent`), e a campanha nunca contava entregue nem lido nele.
--
-- ═══ Por que a campanha precisa de modelo ═══
--
-- Número oficial (API da plataforma, direto ou por provedor parceiro) só aceita
-- texto livre para quem escreveu nas últimas 24 horas. Uma campanha fala
-- justamente com quem NÃO escreveu: com `message_body` sozinho, cada destinatário
-- de um número oficial virava falha (`131047`, ou recusa do parceiro antes de
-- sair). O corpo da campanha oficial é um modelo aprovado, e cada variável dele
-- (`{{1}}`, `{{2}}`…) diz DE ONDE sai o valor — nome do contato, campo do
-- negócio, texto fixo —, nunca o valor: quem resolve é a preparação, contato a
-- contato, e o valor resolvido fica em `campaign_recipients.variables`.
--
-- ═══ Por que `message_mode` tem CHECK ═══
--
-- Vocabulário FECHADO: só existe o que o despacho sabe mandar. Linha legada não
-- existe (a coluna nasce aqui com default `text`, que é o que toda campanha
-- anterior é). Vigiado por `tests/invariants/vocabulario-banco-x-typescript.test.ts`
-- contra `MODOS_DA_MENSAGEM` em `lib/campanhas/tipos.ts`.
--
-- ═══ Por que o trigger de ack muda ═══
--
-- `fn_campanha_sincroniza_ack` só olhava `status`, e o webhook do oficial direto
-- (`lib/channels/meta/status-update.ts`) mantém `status = 'sent'` e carimba
-- `delivered_at`/`read_at`. O trigger saía cedo (status igual) e a campanha
-- ficava com zero entregues e zero lidos para sempre nesse canal. Agora ele
-- dispara também pelos carimbos e deriva o estado efetivo deles. Status
-- analítico continua não retrocedendo.
--
-- Idempotente: `add column if not exists`, constraint recriada por nome,
-- `create or replace function`, trigger recriado.

alter table public.campaigns
  add column if not exists message_mode text not null default 'text',
  add column if not exists provider_template_name text,
  add column if not exists provider_template_language text,
  add column if not exists provider_template_variables jsonb not null default '{}'::jsonb;

alter table public.campaigns drop constraint if exists campaigns_message_mode_check;
alter table public.campaigns
  add constraint campaigns_message_mode_check check (message_mode in ('text', 'template'));

-- Modelo sem nome ou sem idioma não sai: a plataforma identifica a definição
-- pelos DOIS (o mesmo nome em `es` e `es_AR` são modelos diferentes).
alter table public.campaigns drop constraint if exists campaigns_modelo_exige_nome_e_idioma;
alter table public.campaigns
  add constraint campaigns_modelo_exige_nome_e_idioma check (
    message_mode <> 'template'
    or (coalesce(btrim(provider_template_name), '') <> ''
        and coalesce(btrim(provider_template_language), '') <> '')
  );

comment on column public.campaigns.message_mode is
  'text = corpo livre em message_body (número por QR); template = modelo aprovado (número oficial). Migration 0707.';
comment on column public.campaigns.provider_template_name is
  'Nome do modelo aprovado na plataforma, quando message_mode = template.';
comment on column public.campaigns.provider_template_language is
  'Idioma exato do modelo (es, es_AR, pt_BR…): nome + idioma identificam a definição.';
comment on column public.campaigns.provider_template_variables is
  'slotKey ("1", "header:1", "button0:1") → origem do valor ({kind: contact_first_name|contact_name|lead_custom|fixed}). Nunca o valor: ele é resolvido por contato na preparação.';

-- O trigger de ack pelos carimbos que esta migration trazia (quando era a 0680
-- do fork) veio da upstream com o mesmo comportamento (issue #2937). Na
-- renumeração da sync com a v1.86 ele saiu daqui: redefini-lo DEPOIS da upstream
-- faria a última definição da cadeia divergir do apêndice do baseline
-- (`tests/unit/apendice-do-baseline-nao-diverge-da-cadeia.test.ts`).
