/**
 * Task 3 do seam de canais. O adapter é BURRO de propósito: traduz formato e
 * delega. Não há caso aqui sobre janela, cap ou horário — se um aparecer, o
 * desenho vazou (a regra pertence à cadeia `before_send`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAdapter } from '@/lib/channels';

/** A organização atravessa o seam desde a issue #236. */
const ORG = "00000000-0000-4000-8000-000000000236";

const WAHA_BASE = 'http://localhost:3030';

/** Sobe o WAHA "configurado" e devolve o fetch espionado. */
function stubWaha(response: unknown) {
  vi.stubEnv('WAHA_API_BASE_URL', WAHA_BASE);
  vi.stubEnv('WAHA_API_KEY', 'hash123');
  const fetchMock = vi.fn().mockResolvedValue(Response.json(response));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('adapter WAHA', () => {
  it('resolve destinatário 1:1 por telefone', () => {
    const a = getAdapter('waha');
    expect(
      a.resolveRecipient({
        isGroup: false,
        groupChatId: null,
        phoneNumber: '+5531999998888',
        waIdentity: null,
      }),
    ).toBe('5531999998888@c.us');
  });

  it('resolve destinatário por lid quando não há telefone', () => {
    const a = getAdapter('waha');
    expect(
      a.resolveRecipient({
        isGroup: false,
        groupChatId: null,
        phoneNumber: null,
        waIdentity: 'lid:12345',
      }),
    ).toBe('12345@lid');
  });

  it('resolução de adapter é fail-closed', () => {
    // @ts-expect-error provider inexistente é erro de tipo E de runtime
    expect(() => getAdapter('telegram')).toThrow(/unknown_channel_provider/);
  });

  // `isConfigured` existe porque `send` devolvendo `{externalId:null}` colapsa
  // dois desfechos que o handler trata diferente: "não tentei" (fica `queued`)
  // e "tentei e a resposta não tinha id" (vira `sent`). Sem este pre-check, a
  // primeira viraria `sent` sem ter saído — perda de mensagem, não refactor.
  it('isConfigured é false sem env do canal', () => {
    vi.stubEnv('WAHA_API_BASE_URL', '');
    vi.stubEnv('WAHA_API_KEY', '');
    expect(getAdapter('waha').isConfigured()).toBe(false);
  });

  it('isConfigured é true com env do canal', () => {
    vi.stubEnv('WAHA_API_BASE_URL', WAHA_BASE);
    vi.stubEnv('WAHA_API_KEY', 'hash123');
    expect(getAdapter('waha').isConfigured()).toBe(true);
  });

  // Os códigos vivem no adapter porque carregam nome de provider, e o lint da
  // Task 7 proíbe esse nome fora de `lib/channels/`. Os valores são os literais
  // que o handler grava hoje — mudá-los é mudança de comportamento.
  it('codes carrega os literais que o handler grava', () => {
    expect(getAdapter('waha').codes).toEqual({
      notConfigured: 'waha_not_configured',
      sendFailed: 'waha_error',
      // Task 7: era literal no handler; o VALOR não muda (é gravado em
      // `messages.error_message`), só a casa.
      unknownError: 'waha_unknown',
    });
  });

  it('canal não configurado é NOOP, não erro — e nada sai pela rede', async () => {
    vi.stubEnv('WAHA_API_BASE_URL', '');
    vi.stubEnv('WAHA_API_KEY', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      getAdapter('waha').send({
        organizationId: ORG,
        sessionRef: 's',
        to: '5531999998888@c.us',
        kind: 'text',
        body: 'oi',
      }),
    ).resolves.toEqual({ externalId: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('texto vai por sendText e o id externo sai parseado', async () => {
    const fetchMock = stubWaha({ id: { _serialized: 'ABC123' } });

    const res = await getAdapter('waha').send({
      organizationId: ORG,
      sessionRef: 'default',
      to: '5531999998888@c.us',
      kind: 'text',
      body: 'oi',
    });

    expect(res).toEqual({ externalId: 'ABC123' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${WAHA_BASE}/api/sendText`);
    expect(JSON.parse(String(init.body))).toEqual({
      session: 'default',
      chatId: '5531999998888@c.us',
      text: 'oi',
    });
  });

  it('áudio vai pelo plano de mídia do WAHA (sendVoice), não por sendText', async () => {
    const fetchMock = stubWaha({ key: { id: 'VOICE1' } });

    const res = await getAdapter('waha').send({
      organizationId: ORG,
      sessionRef: 'default',
      to: '5531999998888@c.us',
      kind: 'audio',
      media: { url: 'https://x/a.ogg', mime: 'audio/ogg' },
    });

    expect(res).toEqual({ externalId: 'VOICE1' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${WAHA_BASE}/api/sendVoice`);
    expect(JSON.parse(String(init.body))).toEqual({
      session: 'default',
      chatId: '5531999998888@c.us',
      file: { url: 'https://x/a.ogg', mimetype: 'audio/ogg' },
      convert: true,
    });
  });
});
