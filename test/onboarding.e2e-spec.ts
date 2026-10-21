import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/database/prisma.service';
import { MailService } from '../src/integrations/mail/mail.service';

const EMAIL = 'e2e@example.com';
const PASSWORD = 'secret123';

// Registry records created for this test only.
const VALID_BVN = { number: '22900000001', dob: '1990-05-17' };
const INVALID_BVN = { number: '22900000002', dob: '1985-01-01' };
const VALID_NIN = { number: '79000000001', dob: '1990-05-17' };

describe('Onboarding flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sentCodes: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue({ sendOtp: async (_to: string, code: string) => void sentCodes.push(code) })
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    await prisma.otp.deleteMany({ where: { email: EMAIL } });
    await prisma.identityRecord.deleteMany({ where: { number: { startsWith: '2290000' } } });
    await prisma.identityRecord.deleteMany({ where: { number: { startsWith: '7900000' } } });
    await prisma.identityRecord.createMany({
      data: [
        { type: 'BVN', ...record(VALID_BVN), isValid: true },
        { type: 'BVN', ...record(INVALID_BVN), isValid: false },
        { type: 'NIN', ...record(VALID_NIN), isValid: true },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  let cookie: string[];

  it('rejects a weak password with field errors', async () => {
    const res = await api().post('/api/v1/auth/signup').send({ email: 'nope', password: 'short' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, code: 'VALIDATION_FAILED' });
    expect(Object.keys(res.body.errors)).toEqual(expect.arrayContaining(['email', 'password']));
  });

  it('signs up with email and password and sends an OTP', async () => {
    const res = await api().post('/api/v1/auth/signup').send({ email: EMAIL, password: PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true, data: { otpExpiresIn: 600 } });
    expect(sentCodes).toHaveLength(1);
  });

  it('blocks login until the email is verified', async () => {
    const res = await api().post('/api/v1/auth/login').send({ email: EMAIL, password: PASSWORD });
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('blocks protected routes without a session', async () => {
    const res = await api().get('/api/v1/verification/status');
    expect(res.status).toBe(401);
  });

  it('verifies the OTP and sets an httpOnly session cookie', async () => {
    const res = await api()
      .post('/api/v1/auth/otp/verify')
      .send({ email: EMAIL, code: sentCodes[0] });

    expect(res.status).toBe(200);
    cookie = res.get('Set-Cookie') ?? [];
    expect(cookie[0]).toMatch(/ladder_session=.+HttpOnly/);
  });

  it('requires the PIN before credentials', async () => {
    const res = await api()
      .post('/api/v1/verification/bvn')
      .set('Cookie', cookie)
      .send({ bvn: VALID_BVN.number, dateOfBirth: VALID_BVN.dob });
    expect(res.body.code).toBe('PIN_REQUIRED');
  });

  it('creates the PIN', async () => {
    const res = await api()
      .post('/api/v1/auth/pin')
      .set('Cookie', cookie)
      .send({ pin: '123456', confirmPin: '123456' });
    expect(res.status).toBe(201);
  });

  it.each([
    ['an unknown BVN', { bvn: '22999999999', dateOfBirth: '1990-05-17' }, 'BVN_NOT_FOUND'],
    ['an invalid BVN', { bvn: INVALID_BVN.number, dateOfBirth: INVALID_BVN.dob }, 'BVN_INVALID'],
    [
      'a wrong date of birth',
      { bvn: VALID_BVN.number, dateOfBirth: '1991-05-17' },
      'BVN_DOB_MISMATCH',
    ],
  ])('rejects %s', async (_case, body, code) => {
    const res = await api().post('/api/v1/verification/bvn').set('Cookie', cookie).send(body);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(code);
  });

  it('verifies a valid BVN with its date of birth and issues the Ladder ID', async () => {
    const res = await api()
      .post('/api/v1/verification/bvn')
      .set('Cookie', cookie)
      .send({ bvn: VALID_BVN.number, dateOfBirth: VALID_BVN.dob });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('VERIFIED');
    expect(res.body.data.ladderId).toMatch(/^LID-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it('verifies a NIN for the same date of birth', async () => {
    const res = await api()
      .post('/api/v1/verification/nin')
      .set('Cookie', cookie)
      .send({ nin: VALID_NIN.number, dateOfBirth: VALID_NIN.dob });
    expect(res.body.data.status).toBe('VERIFIED');
  });

  it('reports status and the profile with masked numbers', async () => {
    const status = await api().get('/api/v1/verification/status').set('Cookie', cookie);
    expect(status.body.data).toMatchObject({ bvn: 'VERIFIED', nin: 'VERIFIED' });

    const profile = await api().get('/api/v1/profile/me').set('Cookie', cookie);
    expect(profile.body.data).toMatchObject({
      email: EMAIL,
      status: 'VERIFIED',
      dateOfBirth: '1990-05-17',
    });
    expect(JSON.stringify(profile.body)).not.toContain(VALID_BVN.number);
  });

  it('logs out, then logs back in with the password', async () => {
    await api().post('/api/v1/auth/logout').set('Cookie', cookie).expect(200);
    await api().get('/api/v1/profile/me').set('Cookie', cookie).expect(401);

    const res = await api().post('/api/v1/auth/login').send({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.get('Set-Cookie')?.[0]).toMatch(/ladder_session=/);
  });
});

function record({ number, dob }: { number: string; dob: string }) {
  return { number, dateOfBirth: new Date(dob), firstName: 'Test', lastName: 'User' };
}
