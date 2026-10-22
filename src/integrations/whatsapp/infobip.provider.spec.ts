import { ConfigService } from '@nestjs/config';
import { InfobipWhatsAppProvider } from './infobip.provider';

const CONFIG: Record<string, string> = {
  INFOBIP_BASE_URL: 'https://abc123.api.infobip.com',
  INFOBIP_API_KEY: 'test-key',
  INFOBIP_WHATSAPP_SENDER: '447860088970',
  INFOBIP_WEBHOOK_TOKEN: 'secret',
  PUBLIC_BASE_URL: 'https://ladder.example.com',
};

// fetch is replaced in every test: no real WhatsApp message is ever sent from here.
describe('InfobipWhatsAppProvider', () => {
  let fetchMock: jest.SpyInstance;
  let config: Record<string, string>;
  let provider: InfobipWhatsAppProvider;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
    config = { ...CONFIG };
    provider = new InfobipWhatsAppProvider({
      get: (key: string) => config[key],
    } as unknown as ConfigService as never);
  });

  afterEach(() => fetchMock.mockRestore());

  it('sends text from the sender, asking for reports on the public URL', async () => {
    fetchMock.mockResolvedValue(
      new Response('{"messageId":"ib-1","status":{"groupName":"PENDING"}}', { status: 200 }),
    );

    await expect(provider.sendText('+2348150990267', 'Hello')).resolves.toEqual({
      providerMessageId: 'ib-1',
      status: 'SENT',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://abc123.api.infobip.com/whatsapp/1/message/text');
    expect(init.headers.authorization).toBe('App test-key');
    expect(JSON.parse(init.body)).toEqual({
      from: '447860088970',
      to: '2348150990267',
      content: { text: 'Hello' },
      notifyUrl: 'https://ladder.example.com/api/v1/webhooks/infobip/reports?token=secret',
    });
  });

  it('asks for no reports when the API is on localhost', async () => {
    config.PUBLIC_BASE_URL = 'http://localhost:4000';
    fetchMock.mockResolvedValue(new Response('{"messageId":"ib-2"}', { status: 200 }));

    await provider.sendText('+2348150990267', 'Hello');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('notifyUrl');
  });

  it.each([
    ['rejects the request', () => new Response('{"requestError":{}}', { status: 401 })],
    [
      'rejects the message',
      () => new Response('{"messageId":"x","status":{"groupName":"REJECTED"}}', { status: 200 }),
    ],
    ['returns no messageId', () => new Response('{}', { status: 200 })],
  ])('throws WHATSAPP_SEND_FAILED when Infobip %s', async (_case, response) => {
    fetchMock.mockResolvedValue(response());
    await expect(provider.sendText('+2348150990267', 'Hello')).rejects.toMatchObject({
      code: 'WHATSAPP_SEND_FAILED',
    });
  });

  it('throws WHATSAPP_SEND_FAILED when Infobip is unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(provider.sendText('+2348150990267', 'Hello')).rejects.toMatchObject({
      code: 'WHATSAPP_SEND_FAILED',
    });
  });
});
