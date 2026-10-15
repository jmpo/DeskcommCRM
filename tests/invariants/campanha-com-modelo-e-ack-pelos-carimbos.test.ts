/**
 * MIGRATION 0679 — campanha com modelo aprovado, e o ack pelos carimbos.
 *
 * Duas coisas que só o banco prova:
 *
 *   1. `message_mode` é vocabulário FECHADO (`text` | `template`) e o modelo
 *      exige nome E idioma — a plataforma identifica a definição pelos dois.
 *   2. O oficial direto grava entrega e leitura SÓ nos carimbos
 *      (`lib/channels/meta/status-update.ts` mantém `status = 'sent'`). Antes
 *      da 0679 o trigger de ack olhava só o status e saía cedo: a campanha
 *      ficava com zero entregues e zero lidos para sempre nesse canal.
 */
import { describe, expect, it } from "vitest";

import { GOV_ORG, GOV_SESSION, seedGov, sql } from "./gov-helpers";

const CONTATO = "06790000-0000-4000-8000-000000000001";
const CONVERSA = "06790000-0000-4000-8000-000000000002";
const CAMPANHA = "06790000-0000-4000-8000-000000000003";
const MENSAGEM = "06790000-0000-4000-8000-000000000004";
const DESTINATARIO = "06790000-0000-4000-8000-000000000005";

function semear(): void {
  seedGov();
  sql(`
    insert into public.contacts (id, organization_id, display_name, phone_number)
      values ('${CONTATO}', '${GOV_ORG}', 'Prova 0679', '+595981000679')
      on conflict (id) do nothing;
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status)
      values ('${CONVERSA}', '${GOV_ORG}', '${CONTATO}', '${GOV_SESSION}', 'open')
      on conflict (id) do nothing;
    insert into public.campaigns
      (id, organization_id, name, status, channel_session_id, base_legal,
       message_mode, provider_template_name, provider_template_language, provider_template_variables)
      values ('${CAMPANHA}', '${GOV_ORG}', 'Prova 0679', 'running', '${GOV_SESSION}', 'consent',
              'template', 'oferta_pico', 'es', '{"1": {"kind": "contact_first_name"}}'::jsonb)
      on conflict (id) do nothing;
    insert into public.messages
      (id, organization_id, conversation_id, channel_session_id, contact_id,
       type, direction, status, sent_via, body, sent_at, template_name, template_language)
      values ('${MENSAGEM}', '${GOV_ORG}', '${CONVERSA}', '${GOV_SESSION}', '${CONTATO}',
              'template', 'outbound', 'sent', 'ai', '¡Hola Prova!', now(), 'oferta_pico', 'es')
      on conflict (id) do nothing;
    insert into public.campaign_recipients
      (id, organization_id, campaign_id, contact_id, status, message_id, sent_at, variables)
      values ('${DESTINATARIO}', '${GOV_ORG}', '${CAMPANHA}', '${CONTATO}', 'sent', '${MENSAGEM}', now(),
              '{"nome": "Prova", "modelo": {"1": "Prova"}}'::jsonb)
      on conflict (id) do nothing;
  `);
}

describe("0679: campanha com modelo aprovado", () => {
  it("message_mode nasce `text` para toda campanha que já existia", () => {
    const def = sql(
      `select column_default || '|' || is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = 'campaigns' and column_name = 'message_mode';`,
    );
    expect(def).toBe("'text'::text|NO");
  });

  it("modo fora do vocabulário é recusado pelo CHECK", () => {
    seedGov();
    expect(() =>
      sql(`insert into public.campaigns (organization_id, name, channel_session_id, base_legal, message_mode)
             values ('${GOV_ORG}', 'modo inventado', '${GOV_SESSION}', 'consent', 'broadcast');`),
    ).toThrow(/campaigns_message_mode_check/);
  });

  it("modelo sem idioma é recusado — nome e idioma identificam a definição", () => {
    seedGov();
    expect(() =>
      sql(`insert into public.campaigns
             (organization_id, name, channel_session_id, base_legal, message_mode, provider_template_name)
             values ('${GOV_ORG}', 'sem idioma', '${GOV_SESSION}', 'consent', 'template', 'oferta');`),
    ).toThrow(/campaigns_modelo_exige_nome_e_idioma/);
  });
});

describe("0679: o ack da campanha lê os carimbos de entrega e leitura", () => {
  it("o oficial direto carimba delivered_at com status 'sent' — o destinatário vira entregue", () => {
    semear();
    sql(`update public.messages set delivered_at = now() where id = '${MENSAGEM}';`);
    expect(
      sql(`select status || '|' || (delivered_at is not null)::text from public.campaign_recipients where id = '${DESTINATARIO}';`),
    ).toBe("delivered|true");
  });

  it("e read_at o leva a lido — sem o status da mensagem mudar", () => {
    semear();
    sql(`update public.messages set read_at = now() where id = '${MENSAGEM}';`);
    expect(
      sql(`select r.status || '|' || (r.read_at is not null)::text || '|' || m.status
             from public.campaign_recipients r join public.messages m on m.id = r.message_id
            where r.id = '${DESTINATARIO}';`),
    ).toBe("read|true|sent");
  });

  it("status analítico nunca retrocede: uma falha depois de lido não rebaixa o destinatário", () => {
    semear();
    sql(`update public.messages set status = 'failed', error_code = '131026' where id = '${MENSAGEM}';`);
    expect(sql(`select status from public.campaign_recipients where id = '${DESTINATARIO}';`)).toBe("read");
  });
});
