/**
 * Bug reportado: quando um atendente manda mensagem manualmente numa conversa,
 * a IA "fica quieta" só por coincidência de timing (nenhum turno novo foi
 * disparado) — e volta a responder junto com o humano assim que o CLIENTE manda
 * a próxima mensagem, porque `isLeadInHandoff` (lib/agent-engine/agent/human-
 * handoff.ts) só olha `contacts.force_human`/`conversations.bot_silenced_until`,
 * e nenhum envio manual tocava nenhum dos dois.
 *
 * A correção: `sendMessageHandler` (`_handler.ts`) estende `bot_silenced_until`
 * para 5min à frente quando quem envia é um humano (`ctx.actor.type === "user"`)
 * — sliding window, renovada a cada mensagem. Nunca ENCURTA um silêncio maior já
 * setado (nem o 'infinity' do handoff permanente, que `isLeadInHandoff` também
 * lê — ver `lib/ai/handoff/orchestrator.ts` e `human-handoff.ts:performHumanHandoff`).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sendMessageHandler } from '@/app/api/v1/messages/_handler';
import type { HandlerCtx } from '@/lib/api/handlers/types';
import type { SendMessageInput } from '@/lib/schemas';

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ storage: { from: () => ({ createSignedUrl: vi.fn() }) } }),
}));
vi.mock('@/lib/audit', () => ({ audit: vi.fn(async () => {}) }));

const ORG = '11111111-1111-4111-8111-111111111111';
const CONV = '22222222-2222-4222-8222-222222222222';
const CONTACT = '33333333-3333-4333-8333-333333333333';
const SESSION = '44444444-4444-4444-8444-444444444444';
const USER = '55555555-5555-4555-8555-555555555555';
const AGENT_RUN = '66666666-6666-4666-8666-666666666666';

type Row = Record<string, unknown>;

function conversationRow(botSilencedUntil: string | null): Row {
  return {
    id: CONV,
    organization_id: ORG,
    contact_id: CONTACT,
    channel_session_id: SESSION,
    is_group: false,
    group_chat_id: null,
    bot_silenced_until: botSilencedUntil,
    contacts: { phone_number: '+5531999998888', wa_identity: null, is_blocked: false },
    channel_sessions: { provider: 'waha', waha_session_name: 'default', status: 'WORKING' },
  };
}

/** Captura o patch do UPDATE em `conversations` — é isso que os casos verificam. */
function makeSupabase(botSilencedUntil: string | null) {
  const patches: Row[] = [];
  const client = {
    from(table: string) {
      if (table === 'conversations') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: conversationRow(botSilencedUntil), error: null }) }),
          }),
          update: (patch: Row) => {
            patches.push(patch);
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      if (table === 'messages') {
        return {
          insert: (row: Row) => {
            const nova = { id: 'msg-1', external_id: null, ack: null, error_code: null, error_message: null, ...row };
            return { select: () => ({ single: async () => ({ data: nova, error: null }) }) };
          },
          update: (patch: Row) => ({
            eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: 'msg-1', ...patch }, error: null }) }) }),
          }),
        };
      }
      throw new Error(`fake_supabase: tabela inesperada '${table}'`);
    },
    rpc: async () => ({ error: null }),
  };
  return { supabase: client as unknown as SupabaseClient, patches };
}

const input = { conversation_id: CONV, type: 'text', body: 'oi' } as SendMessageInput;

function wahaConfigured() {
  vi.stubEnv('WAHA_API_BASE_URL', 'http://localhost:3030');
  vi.stubEnv('WAHA_API_KEY', 'hash123');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: { id: 'BARE1' } }), { status: 200 })));
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('sendMessageHandler — silêncio da IA de 5min após resposta manual humana', () => {
  it('humano manda mensagem numa conversa sem silêncio → bot_silenced_until vira ~agora+5min', async () => {
    wahaConfigured();
    const ctx: HandlerCtx = { organization_id: ORG, actor: { type: 'user', id: USER }, requestId: 'req-1' };
    const { supabase, patches } = makeSupabase(null);

    const before = Date.now();
    await sendMessageHandler(supabase, ctx, input);
    const after = Date.now();

    const convPatch = patches[patches.length - 1]!;
    expect(convPatch.bot_silenced_until, 'não silenciou a IA após resposta manual').toBeDefined();
    const silencedUntil = new Date(convPatch.bot_silenced_until as string).getTime();
    expect(silencedUntil).toBeGreaterThanOrEqual(before + 5 * 60 * 1000 - 1000);
    expect(silencedUntil).toBeLessThanOrEqual(after + 5 * 60 * 1000 + 1000);
  });

  it('IA envia mensagem (ai_agent) → NÃO mexe em bot_silenced_until', async () => {
    wahaConfigured();
    const ctx: HandlerCtx = { organization_id: ORG, actor: { type: 'ai_agent', id: AGENT_RUN, role: 'agent' }, requestId: 'req-2' };
    const { supabase, patches } = makeSupabase(null);

    await sendMessageHandler(supabase, ctx, input);

    const convPatch = patches[patches.length - 1]!;
    expect(convPatch.bot_silenced_until, 'a IA silenciou a si mesma ao responder').toBeUndefined();
  });

  it('handoff permanente (infinity) já ativo → resposta manual NÃO encurta para 5min', async () => {
    wahaConfigured();
    const ctx: HandlerCtx = { organization_id: ORG, actor: { type: 'user', id: USER }, requestId: 'req-3' };
    const { supabase, patches } = makeSupabase('infinity');

    await sendMessageHandler(supabase, ctx, input);

    const convPatch = patches[patches.length - 1]!;
    expect(convPatch.bot_silenced_until, 'rebaixou o handoff permanente para uma janela de 5min').toBeUndefined();
  });

  it('silêncio finito já maior que 5min (ex.: 30min) → resposta manual não encurta', async () => {
    wahaConfigured();
    const ctx: HandlerCtx = { organization_id: ORG, actor: { type: 'user', id: USER }, requestId: 'req-4' };
    const trintaMin = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const { supabase, patches } = makeSupabase(trintaMin);

    await sendMessageHandler(supabase, ctx, input);

    const convPatch = patches[patches.length - 1]!;
    expect(convPatch.bot_silenced_until, 'encurtou um silêncio maior já setado').toBeUndefined();
  });

  it('silêncio finito menor que 5min (ex.: 1min) → resposta manual estende (sliding window)', async () => {
    wahaConfigured();
    const ctx: HandlerCtx = { organization_id: ORG, actor: { type: 'user', id: USER }, requestId: 'req-5' };
    const umMin = new Date(Date.now() + 60 * 1000).toISOString();
    const { supabase, patches } = makeSupabase(umMin);

    const before = Date.now();
    await sendMessageHandler(supabase, ctx, input);

    const convPatch = patches[patches.length - 1]!;
    expect(convPatch.bot_silenced_until, 'não renovou a janela com a nova mensagem').toBeDefined();
    const silencedUntil = new Date(convPatch.bot_silenced_until as string).getTime();
    expect(silencedUntil).toBeGreaterThanOrEqual(before + 5 * 60 * 1000 - 1000);
  });
});
