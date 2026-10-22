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
const DOB = '1993-02-11';
const BVN = '22800000097'; // a registry record created for this test only

// Failed identifies become one case per set of details, which agents follow on the dashboard API:
// they read and answer the help chat, and the case resolves itself when the BVN passes.
describe('Agent cases (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const store = new InMemoryWebChatStore();

  const api = () => request(app.getHttpServer());
  const identify = (dateOfBirth: string) =>
    api().post('/api/v1/assistance/identify/bvn').set(PARTNER).send({ bvn: BVN, dateOfBirth });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WebChatStore)
      .useValue(store)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    await prisma.assistanceIssue.deleteMany({ where: { maskedValue: '*******0097' } });
    await prisma.identityRecord.deleteMany({ where: { number: BVN } });
    await prisma.identityRecord.create({
      data: {
        type: 'BVN',
        number: BVN,
        dateOfBirth: new Date(DOB),
        isValid: true,
        firstName: 'Tunde',
        lastName: 'Bakare',
      },
    });
  });

  afterAll(async () => {
    await prisma.assistanceIssue.deleteMany({ where: { maskedValue: '*******0097' } });
    await app.close();
  });

  it('follows one case from failed identifies to automatic resolution', async () => {
    // The same wrong details three times: one case, flagged on the third attempt.
    const references = [];
    for (let i = 0; i < 3; i++) {
      const res = await identify('1993-02-12');
      expect(res.body.code).toBe('INFORMATION_MISMATCH');
      references.push(res.body.details.helpReference);
    }
    const ref = references[0];
    expect(new Set(references)).toEqual(new Set([ref]));

    // A different date is a different attempt: a second case.
    const other = (await identify('1993-02-13')).body.details.helpReference;
    expect(other).not.toBe(ref);

    const list = await api().get('/api/v1/agent/cases').query({ search: '0097' });
    expect(list.status).toBe(200);
    expect(list.body.data.total).toBe(2);
    const listed = list.body.data.items.find((item: { id: string }) => item.id === ref);
    expect(listed).toMatchObject({
      customer: { label: 'BVN ending 0097', phoneNumber: null },
      issue: { title: 'Date of birth mismatch' },
      status: 'NEEDS_ATTENTION',
      attempts: 3,
      partner: 'Zenith',
    });

    // Before the customer opens the chat there is nothing to reply to.
    const early = await api().post(`/api/v1/agent/cases/${ref}/messages`).send({ text: 'Hi' });
    expect(early.body.code).toBe('HELP_CHAT_NOT_STARTED');

    // The customer opens the chat; the agent reads it, replies and takes it over.
    const start = await api()
      .post('/api/v1/assistance/help-chat')
      .set(PARTNER)
      .send({ reference: ref });
    const token = start.body.data.firebaseToken;
    const reply = await api()
      .post(`/api/v1/agent/cases/${ref}/messages`)
      .send({ text: 'Hello, I’m from Ladder. Please check your date of birth.' });
    expect(reply.status).toBe(200);
    expect(reply.body.data).toMatchObject({
      status: 'IN_CHAT',
      chat: { mode: 'agent', agentName: 'Ladder Support' },
    });
    expect(reply.body.data.officeVisits[0]).toMatchObject({ id: 'BVN' });

    // While the agent has the chat, the AI stays quiet and the case waits for the agent.
    await api()
      .post(`/api/v1/assistance/help-chat/${ref}/messages`)
      .set(PARTNER)
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'Thanks, I will check' });
    await app.get(WebChatService).whenIdle(ref);
    const waiting = (await api().get(`/api/v1/agent/cases/${ref}`)).body.data;
    expect(waiting.status).toBe('NEEDS_ATTENTION');
    expect(waiting.chat.messages.at(-1)).toMatchObject({
      sender: 'customer',
      text: 'Thanks, I will check',
    });

    const handBack = await api().post(`/api/v1/agent/cases/${ref}/hand-back`);
    expect(handBack.body.data.chat.mode).toBe('ai');

    const note = await api()
      .post(`/api/v1/agent/cases/${ref}/notes`)
      .send({ text: 'Called the customer.' });
    expect(note.body.data.notes[0]).toMatchObject({
      text: 'Called the customer.',
      authorName: 'Ladder Support',
    });

    // The customer fixes the date and passes: both cases for this BVN resolve.
    expect((await identify(DOB)).status).toBe(200);
    const resolved = (await api().get(`/api/v1/agent/cases/${ref}`)).body.data;
    expect(resolved).toMatchObject({ status: 'RESOLVED', resolvedBy: 'Automatic' });
    expect(resolved.stages.map((s: { status: string }) => s.status)).toEqual([
      'COMPLETED',
      'COMPLETED',
      'COMPLETED',
    ]);
    expect((await api().get(`/api/v1/agent/cases/${other}`)).body.data.status).toBe('RESOLVED');

    // Resolved details are free again: failing with them now logs a new case.
    const fresh = (await identify('1993-02-12')).body.details.helpReference;
    expect(fresh).not.toBe(ref);

    const summary = await api().get('/api/v1/agent/cases/summary');
    expect(summary.body.data.resolvedToday).toBeGreaterThanOrEqual(2);

    const insights = (await api().get('/api/v1/agent/insights')).body.data;
    expect(insights.days).toHaveLength(7);
    expect(insights.days.at(-1).logged).toBeGreaterThanOrEqual(3);
    expect(insights.issues).toContainEqual(
      expect.objectContaining({ title: 'Date of birth mismatch' }),
    );
  });

  it('escalates and resolves a case by hand, once each', async () => {
    const ref = (await identify('1993-03-01')).body.details.helpReference;

    expect((await api().post(`/api/v1/agent/cases/${ref}/escalate`)).body.data.status).toBe(
      'ESCALATED',
    );
    expect((await api().post(`/api/v1/agent/cases/${ref}/escalate`)).body.code).toBe(
      'CASE_NOT_ESCALATABLE',
    );
    const resolved = await api().post(`/api/v1/agent/cases/${ref}/resolve`);
    expect(resolved.body.data).toMatchObject({ status: 'RESOLVED', resolvedBy: 'Ladder Support' });
    expect((await api().post(`/api/v1/agent/cases/${ref}/resolve`)).body.code).toBe(
      'CASE_RESOLVED',
    );
  });

  it('answers 404 for an unknown case and validates notes', async () => {
    expect((await api().get('/api/v1/agent/cases/LDR-ZZZZZZ')).body.code).toBe('CASE_NOT_FOUND');
    const ref = (await identify('1993-03-02')).body.details.helpReference;
    const res = await api().post(`/api/v1/agent/cases/${ref}/notes`).send({ text: '' });
    expect(res.status).toBe(400);
  });
});
