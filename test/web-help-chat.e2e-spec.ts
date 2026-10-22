import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/database/prisma.service';
import { WebChatService } from '../src/modules/support/web-chat.service';
import { WebChatStore } from '../src/modules/support/web-chat.store';
import { InMemoryWebChatStore } from './in-memory-web-chat.store';

const PARTNER = { 'X-Partner-Id': 'zenith' };
const DOB = '1992-07-14';
const BVN = '22800000098'; // a registry record created for this test only

// Failed identify → Get help opens the web chat with the preset message → language question →
// explanation. Firestore is replaced by an in-memory store and Groq is off (fixed explanation).
describe('Web help chat (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const store = new InMemoryWebChatStore();

  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WebChatStore)
      .useValue(store)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    await prisma.identityRecord.deleteMany({ where: { number: BVN } });
    await prisma.identityRecord.create({
      data: {
        type: 'BVN',
        number: BVN,
        dateOfBirth: new Date(DOB),
        isValid: true,
        firstName: 'Bola',
        lastName: 'Adeyemi',
      },
    });
  });

  afterAll(async () => {
    await prisma.assistanceIssue.deleteMany({ where: { maskedValue: '*******0098' } });
    await app.close();
  });

  it('opens the chat from a failed identify and explains the issue', async () => {
    const identify = await api()
      .post('/api/v1/assistance/identify/bvn')
      .set(PARTNER)
      .send({ bvn: BVN, dateOfBirth: '1992-07-15' });
    expect(identify.status).toBe(422);
    const { helpReference } = identify.body.details;

    const start = await api()
      .post('/api/v1/assistance/help-chat')
      .set(PARTNER)
      .send({ reference: helpReference.toLowerCase() });
    expect(start.status).toBe(200);
    expect(start.body.data).toEqual({
      chatId: helpReference,
      firebaseToken: `token:help_${helpReference}`,
    });
    expect(store.transcript(helpReference)).toEqual([
      `customer: Hi Ladder, I need help with my account opening. Ref: ${helpReference}`,
      'ladder: Hello! I’m Ladder, here to help you with your recent Zenith Bank account application. Which language would you like us to use? English, Nigerian Pidgin, Yoruba, Hausa, Igbo, or another?',
    ]);

    const send = await api()
      .post(`/api/v1/assistance/help-chat/${helpReference}/messages`)
      .set(PARTNER)
      .set('Authorization', `Bearer ${start.body.data.firebaseToken}`)
      .send({ text: 'English' });
    expect(send.status).toBe(202);

    await app.get(WebChatService).whenIdle(helpReference);
    expect(store.transcript(helpReference).at(-1)).toContain(
      'date of birth entered does not match',
    );
  });

  it('refuses a message without the chat token', async () => {
    const { body } = await api().post('/api/v1/assistance/help-chat').set(PARTNER).send({});
    const res = await api()
      .post(`/api/v1/assistance/help-chat/${body.data.chatId}/messages`)
      .set(PARTNER)
      .send({ text: 'hello' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('HELP_CHAT_SESSION_INVALID');
  });

  it('refuses an unknown reference', async () => {
    const res = await api()
      .post('/api/v1/assistance/help-chat')
      .set(PARTNER)
      .send({ reference: 'LDR-ZZZZZZ' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('HELP_REFERENCE_NOT_FOUND');
  });

  it('validates the message', async () => {
    const res = await api()
      .post('/api/v1/assistance/help-chat/LDR-ZZZZZZ/messages')
      .set(PARTNER)
      .send({ text: '   ' });

    expect(res.status).toBe(400);
    expect(res.body.errors.text).toBeDefined();
  });
});
