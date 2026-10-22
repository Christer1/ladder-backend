import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/database/prisma.service';
import { MailService } from '../src/integrations/mail/mail.service';

const EMAIL = 'e2e@example.com';
const PASSWORD = 'secret123';
// A second account that verifies with a passport instead of a BVN/NIN.
const EMAIL_PASSPORT = 'e2e-passport@example.com';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

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
    await prisma.user.deleteMany({ where: { email: { in: [EMAIL, EMAIL_PASSPORT] } } });
    await prisma.otp.deleteMany({ where: { email: { in: [EMAIL, EMAIL_PASSPORT] } } });
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
    const res = await api()
      .post('/api/v1/auth/signup')
      .send({ email: 'nope', password: 'short', confirmPassword: 'short' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, code: 'VALIDATION_FAILED' });
    expect(Object.keys(res.body.errors)).toEqual(expect.arrayContaining(['email', 'password']));
  });

  it('rejects mismatched passwords', async () => {
    const res = await api()
      .post('/api/v1/auth/signup')
      .send({ email: EMAIL, password: PASSWORD, confirmPassword: 'secret124' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: 'PASSWORD_MISMATCH',
      errors: { confirmPassword: [expect.any(String)] },
    });
  });

  it('signs up with email and password and sends an OTP', async () => {
    const res = await api()
      .post('/api/v1/auth/signup')
      .send({ email: EMAIL, password: PASSWORD, confirmPassword: PASSWORD });

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

  it('remembers the onboarding page the user is on', async () => {
    await api()
      .put('/api/v1/verification/last-step')
      .set('Cookie', cookie)
      .send({ step: 'UPLOAD_ID' })
      .expect(200);
    const res = await api().get('/api/v1/verification/status').set('Cookie', cookie);
    expect(res.body.data).toMatchObject({ lastStep: 'UPLOAD_ID', ladderId: null });

    const bad = await api()
      .put('/api/v1/verification/last-step')
      .set('Cookie', cookie)
      .send({ step: 'PROFILE' });
    expect(bad.status).toBe(400);
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
    expect(status.body.data).toMatchObject({
      bvn: 'VERIFIED',
      nin: 'VERIFIED',
      governmentId: 'NOT_STARTED',
      liveness: 'NOT_STARTED',
    });

    const profile = await api().get('/api/v1/profile/me').set('Cookie', cookie);
    expect(profile.body.data).toMatchObject({
      email: EMAIL,
      status: 'VERIFIED',
      dateOfBirth: '1990-05-17',
    });
    expect(JSON.stringify(profile.body)).not.toContain(VALID_BVN.number);
  });

  it('records liveness on the backend so it survives signing out', async () => {
    const res = await api()
      .post('/api/v1/verification/liveness')
      .set('Cookie', cookie)
      .field('challenges', JSON.stringify(['smile', 'turnLeft', 'blink']))
      .attach('selfie', JPEG, { filename: 'selfie.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('VERIFIED');
  });

  it('logs out, then logs back in with the password and sees the same progress', async () => {
    await api().post('/api/v1/auth/logout').set('Cookie', cookie).expect(200);
    await api().get('/api/v1/profile/me').set('Cookie', cookie).expect(401);

    const res = await api().post('/api/v1/auth/login').send({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(200);
    cookie = res.get('Set-Cookie') ?? [];
    expect(cookie[0]).toMatch(/ladder_session=/);

    const status = await api().get('/api/v1/verification/status').set('Cookie', cookie);
    expect(status.body.data).toMatchObject({ bvn: 'VERIFIED', liveness: 'VERIFIED' });
  });

  it('verifies with a passport photo page, then issues the Ladder ID at liveness', async () => {
    await api()
      .post('/api/v1/auth/signup')
      .send({ email: EMAIL_PASSPORT, password: PASSWORD, confirmPassword: PASSWORD })
      .expect(201);
    const verify = await api()
      .post('/api/v1/auth/otp/verify')
      .send({ email: EMAIL_PASSPORT, code: sentCodes[sentCodes.length - 1] })
      .expect(200);
    const passportCookie = verify.get('Set-Cookie') ?? [];

    const early = await api()
      .post('/api/v1/verification/liveness')
      .set('Cookie', passportCookie)
      .attach('selfie', JPEG, { filename: 'selfie.jpg', contentType: 'image/jpeg' });
    expect(early.body.code).toBe('IDENTITY_REQUIRED');

    const id = await api()
      .post('/api/v1/verification/government-id')
      .set('Cookie', passportCookie)
      .field('idType', 'international-passport')
      .attach('front', JPEG, { filename: 'page.jpg', contentType: 'image/jpeg' });
    expect(id.status).toBe(200);
    expect(id.body.data).toEqual({ status: 'VERIFIED', ladderId: null });

    const liveness = await api()
      .post('/api/v1/verification/liveness')
      .set('Cookie', passportCookie)
      .attach('selfie', JPEG, { filename: 'selfie.jpg', contentType: 'image/jpeg' });
    expect(liveness.body.data.ladderId).toMatch(/^LID-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });
});

function record({ number, dob }: { number: string; dob: string }) {
  return { number, dateOfBirth: new Date(dob), firstName: 'Test', lastName: 'User' };
}
