import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/database/prisma.service';
import { MailService } from '../src/integrations/mail/mail.service';
import { StorageService } from '../src/integrations/storage/storage.service';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const EMAIL = 'e2e@example.com';

describe('Onboarding flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sentCodes: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue({ sendOtp: async (_to: string, code: string) => void sentCodes.push(code) })
      .overrideProvider(StorageService)
      .useValue({ upload: async (key: string) => key })
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    await prisma.otp.deleteMany({ where: { email: EMAIL } });
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  let cookie: string[];

  it('rejects invalid signup input with field errors', async () => {
    const res = await api().post('/api/v1/auth/signup').send({ email: 'nope', dateOfBirth: 'x' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, code: 'VALIDATION_FAILED' });
    expect(Object.keys(res.body.errors)).toEqual(expect.arrayContaining(['email', 'dateOfBirth']));
  });

  it('signs up and sends an OTP', async () => {
    const res = await api()
      .post('/api/v1/auth/signup')
      .send({ email: EMAIL, dateOfBirth: '1990-01-01' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true, data: { otpExpiresIn: 600 } });
    expect(sentCodes).toHaveLength(1);
  });

  it('blocks protected routes without a session', async () => {
    const res = await api().get('/api/v1/verification/status');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a wrong OTP', async () => {
    const wrong = sentCodes[0] === '000000' ? '111111' : '000000';
    const res = await api().post('/api/v1/auth/otp/verify').send({ email: EMAIL, code: wrong });
    expect(res.body.code).toBe('OTP_INVALID');
  });

  it('verifies the OTP and sets an httpOnly session cookie', async () => {
    const res = await api()
      .post('/api/v1/auth/otp/verify')
      .send({ email: EMAIL, code: sentCodes[0] });

    expect(res.status).toBe(200);
    cookie = res.get('Set-Cookie') ?? [];
    expect(cookie[0]).toMatch(/ladder_session=.+HttpOnly/);
  });

  it('creates the PIN', async () => {
    const res = await api()
      .post('/api/v1/auth/pin')
      .set('Cookie', cookie)
      .send({ pin: '123456', confirmPin: '123456' });
    expect(res.status).toBe(201);
  });

  it('records a failed NIN', async () => {
    const res = await api()
      .post('/api/v1/verification/nin')
      .set('Cookie', cookie)
      .send({ nin: '12345670000' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('NIN_MISMATCH');
  });

  it('verifies the BVN', async () => {
    const res = await api()
      .post('/api/v1/verification/bvn')
      .set('Cookie', cookie)
      .send({ bvn: '12345678901' });
    expect(res.body).toMatchObject({ success: true, data: { status: 'VERIFIED' } });
  });

  it('rejects an upload whose bytes are not an image or PDF', async () => {
    const res = await api()
      .post('/api/v1/verification/government-id')
      .set('Cookie', cookie)
      .field('idType', 'NATIONAL_ID_CARD')
      .attach('file', Buffer.from('fake'), { filename: 'id.png', contentType: 'image/png' });
    expect(res.body.code).toBe('FILE_TYPE_INVALID');
  });

  it('passes liveness and issues a Ladder ID', async () => {
    const res = await api()
      .post('/api/v1/verification/liveness')
      .set('Cookie', cookie)
      .attach('selfie', PNG, { filename: 'selfie.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(res.body.data.ladderId).toMatch(/^LID-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it('returns the profile with masked identity numbers', async () => {
    const res = await api().get('/api/v1/profile/me').set('Cookie', cookie);

    expect(res.body.data).toMatchObject({ email: EMAIL, status: 'VERIFIED' });
    expect(JSON.stringify(res.body)).not.toContain('12345678901');
    expect(res.body.data.verifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'BVN', maskedValue: '*******8901' }),
      ]),
    );
  });

  it('logs out and revokes the session', async () => {
    await api().post('/api/v1/auth/logout').set('Cookie', cookie).expect(200);
    await api().get('/api/v1/profile/me').set('Cookie', cookie).expect(401);
  });
});
