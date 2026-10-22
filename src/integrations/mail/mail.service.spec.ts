import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

const CONFIG: Record<string, string> = {
  BREVO_API_KEY: 'test-key',
  EMAIL_FROM: 'no-reply@example.com',
  EMAIL_FROM_NAME: 'Ladder',
};

// fetch is replaced in every test: no real email is ever sent from here.
describe('MailService', () => {
  let fetchMock: jest.SpyInstance;
  let service: MailService;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
    const config = { get: (key: string) => CONFIG[key] } as unknown as ConfigService;
    service = new MailService(config as never);
  });

  afterEach(() => fetchMock.mockRestore());

  it('sends the OTP through the Brevo API from the configured sender', async () => {
    fetchMock.mockResolvedValue(new Response('{"messageId":"<id>"}', { status: 201 }));

    await service.sendOtp('ada@example.com', '482913', 600);

    const [url, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(init.headers['api-key']).toBe('test-key');
    expect(body.sender).toEqual({ email: 'no-reply@example.com', name: 'Ladder' });
    expect(body.to).toEqual([{ email: 'ada@example.com' }]);
    expect(body.htmlContent).toContain('482913');
    expect(body.textContent).toContain('10 minutes');
  });

  it('throws EMAIL_SEND_FAILED when Brevo rejects the request', async () => {
    fetchMock.mockResolvedValue(new Response('{"code":"unauthorized"}', { status: 401 }));

    await expect(service.sendOtp('ada@example.com', '482913', 600)).rejects.toMatchObject({
      code: 'EMAIL_SEND_FAILED',
    });
  });

  it('throws EMAIL_SEND_FAILED when Brevo is unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(service.sendOtp('ada@example.com', '482913', 600)).rejects.toMatchObject({
      code: 'EMAIL_SEND_FAILED',
    });
  });
});
