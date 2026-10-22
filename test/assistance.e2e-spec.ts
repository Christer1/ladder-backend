import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/database/prisma.service';

const PARTNER = { 'X-Partner-Id': 'zenith' };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const LADDER_EMAIL = 'e2e-assistance@example.com';
const LADDER_ID = 'LID-E2EA-SSTX';

// Registry records created for this test only.
const DOB = '1991-03-09';
const profile = {
  firstName: 'Kelechi',
  lastName: 'Eze',
  phoneNumber: '08031234567',
  residentialAddress: '4, Herbert Macaulay Way, Yaba',
};
const BVN = '22800000001';
const NIN = '78000000001';
const OTHER_NIN = '78000000002'; // valid, same date of birth, different person

describe('Assistance flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    await prisma.user.deleteMany({ where: { email: LADDER_EMAIL } });
    await prisma.identityRecord.deleteMany({
      where: { number: { in: [BVN, NIN, OTHER_NIN] } },
    });
    const dateOfBirth = new Date(DOB);
    const [bvnRecord] = await Promise.all([
      prisma.identityRecord.create({
        data: { type: 'BVN', number: BVN, dateOfBirth, isValid: true, ...profile },
      }),
      prisma.identityRecord.create({
        data: { type: 'NIN', number: NIN, dateOfBirth, isValid: true, ...profile },
      }),
      prisma.identityRecord.create({
        data: {
          type: 'NIN',
          number: OTHER_NIN,
          dateOfBirth,
          isValid: true,
          ...profile,
          firstName: 'Musa',
        },
      }),
    ]);
    await prisma.user.create({
      data: {
        email: LADDER_EMAIL,
        passwordHash: 'not-used',
        emailVerifiedAt: new Date(),
        ladderId: LADDER_ID,
        dateOfBirth,
        status: 'VERIFIED',
        verifications: {
          create: {
            type: 'BVN',
            status: 'VERIFIED',
            provider: 'registry',
            providerRef: bvnRecord.id,
            verifiedAt: new Date(),
          },
        },
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());

  it('rejects requests without an allowed partner', async () => {
    const res = await api()
      .post('/api/v1/assistance/identify/bvn')
      .send({ bvn: BVN, dateOfBirth: DOB });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PARTNER_NOT_ALLOWED');
  });

  it.each([
    ['a wrong date of birth', { bvn: BVN, dateOfBirth: '1991-03-10' }],
    ['an unknown BVN', { bvn: '22899999999', dateOfBirth: DOB }],
  ])('answers %s with INFORMATION_MISMATCH and no cookie', async (_case, body) => {
    const res = await api().post('/api/v1/assistance/identify/bvn').set(PARTNER).send(body);
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ success: false, code: 'INFORMATION_MISMATCH' });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('rejects a BVN and NIN that belong to different people', async () => {
    const res = await api()
      .post('/api/v1/assistance/identify/bvn-and-nin')
      .set(PARTNER)
      .send({ bvn: BVN, nin: OTHER_NIN, dateOfBirth: DOB });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INFORMATION_MISMATCH');
  });

  it('needs a session for the later steps', async () => {
    const res = await api().get('/api/v1/assistance/status').set(PARTNER);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('ASSISTANCE_SESSION_EXPIRED');
  });

  it('runs BVN and NIN → liveness → details → confirm → end', async () => {
    const identify = await api()
      .post('/api/v1/assistance/identify/bvn-and-nin')
      .set(PARTNER)
      .send({ bvn: BVN, nin: NIN, dateOfBirth: DOB });
    expect(identify.status).toBe(200);
    expect(identify.body.data).toEqual({ status: 'verified' });
    const cookie = identify.headers['set-cookie'] as unknown as string[];
    expect(cookie[0]).toMatch(/^ladder_assistance_session=.+HttpOnly/);

    const before = await api().get('/api/v1/assistance/details').set(PARTNER).set('Cookie', cookie);
    expect(before.status).toBe(403);
    expect(before.body.code).toBe('LIVENESS_REQUIRED');

    const liveness = await api()
      .post('/api/v1/assistance/liveness')
      .set(PARTNER)
      .set('Cookie', cookie)
      .attach('selfie', JPEG, { filename: 'selfie.jpg', contentType: 'image/jpeg' });
    expect(liveness.status).toBe(200);

    const status = await api().get('/api/v1/assistance/status').set(PARTNER).set('Cookie', cookie);
    expect(status.body.data).toEqual({
      method: 'bvn-and-nin',
      identity: 'verified',
      liveness: 'verified',
    });

    const details = await api()
      .get('/api/v1/assistance/details')
      .set(PARTNER)
      .set('Cookie', cookie);
    expect(details.body.data).toEqual({
      fullName: 'Kelechi Eze',
      dateOfBirth: DOB,
      gender: 'Male',
      phoneNumber: '08031234567',
      email: 'customer@example.com',
      stateOfOrigin: 'Oyo',
      stateOfResidence: 'Oyo',
      town: 'Ibadan',
      residentialAddress: '4, Herbert Macaulay Way, Yaba',
    });

    const confirm = await api()
      .post('/api/v1/assistance/confirm')
      .set(PARTNER)
      .set('Cookie', cookie)
      .send({});
    expect(confirm.status).toBe(200);

    const end = await api()
      .post('/api/v1/assistance/session/end')
      .set(PARTNER)
      .set('Cookie', cookie);
    expect(end.status).toBe(200);
    const after = await api().get('/api/v1/assistance/status').set(PARTNER).set('Cookie', cookie);
    expect(after.status).toBe(401);
  });

  it('rejects an unknown Ladder ID', async () => {
    const res = await api()
      .post('/api/v1/assistance/identify/ladder-id')
      .set(PARTNER)
      .send({ ladderId: 'LID-NOPE-NOPE' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('LADDER_ID_NOT_FOUND');
  });

  it('identifies a Ladder ID (any case) and shows the account email', async () => {
    const identify = await api()
      .post('/api/v1/assistance/identify/ladder-id')
      .set(PARTNER)
      .send({ ladderId: ` ${LADDER_ID.toLowerCase()} ` });
    expect(identify.status).toBe(200);
    const cookie = identify.headers['set-cookie'] as unknown as string[];

    await api()
      .post('/api/v1/assistance/liveness')
      .set(PARTNER)
      .set('Cookie', cookie)
      .attach('selfie', JPEG, { filename: 'selfie.jpg', contentType: 'image/jpeg' })
      .expect(200);

    const details = await api()
      .get('/api/v1/assistance/details')
      .set(PARTNER)
      .set('Cookie', cookie);
    expect(details.body.data).toMatchObject({ fullName: 'Kelechi Eze', email: LADDER_EMAIL });
  });
});
