import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/database/prisma.service';

const PARTNER = { 'X-Partner-Id': 'zenith' };
const TOKEN = 'test-webhook-token'; // setup-env.ts
const PHONE = '+2348000000099';
const DOB = '1992-07-14';
const BVN = '22800000099'; // a registry record created for this test only

// Failed identify → help reference → customer writes on WhatsApp → opener → explanation.
// WHATSAPP_PROVIDER is console and Groq is off, so the fixed explanation is "sent".
describe('WhatsApp help chat (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const api = () => request(app.getHttpServer());
  const inbound = (messageId: string, text: string, token = TOKEN) =>
    api()
      .post(`/api/v1/webhooks/infobip/inbound?token=${token}`)
      .send({
        results: [
          {
            from: PHONE.slice(1),
            to: '447860088970',
            messageId,
            message: { type: 'TEXT', text },
          },
        ],
      });

  // The webhook answers before the reply is written; wait for the outbound row.
  const replyTo = async (count: number) => {
    for (let i = 0; i < 50; i++) {
      const replies = await prisma.whatsAppMessage.findMany({
        where: { phone: PHONE, direction: 'OUTBOUND' },
        orderBy: { createdAt: 'asc' },
      });
      if (replies.length >= count) return replies[count - 1];
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('No reply was sent');
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    await prisma.whatsAppMessage.deleteMany({ where: { phone: PHONE } });
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
    await prisma.whatsAppMessage.deleteMany({ where: { phone: PHONE } });
    await prisma.assistanceIssue.deleteMany({ where: { contactPhone: PHONE } });
    await app.close();
  });

  it('refuses webhooks without the token', async () => {
    const res = await inbound('e2e-bad-token', 'hello', 'wrong');
    expect(res.status).toBe(403);
  });

  it('explains a failed identify to the customer who sends its reference', async () => {
    const identify = await api()
      .post('/api/v1/assistance/identify/bvn')
      .set(PARTNER)
      .send({ bvn: BVN, dateOfBirth: '1992-07-15' });

    // The screen still gets the one generic error, plus the WhatsApp link.
    expect(identify.status).toBe(422);
    expect(identify.body.code).toBe('INFORMATION_MISMATCH');
    const { helpReference, whatsappUrl } = identify.body.details;
    expect(helpReference).toMatch(/^LDR-[2-9A-HJKMNP-Z]{6}$/);
    expect(whatsappUrl).toContain(`https://wa.me/447860088970?text=`);
    expect(decodeURIComponent(whatsappUrl)).toContain(`Ref: ${helpReference}`);

    const issue = await prisma.assistanceIssue.findUniqueOrThrow({
      where: { reference: helpReference },
    });
    expect(issue).toMatchObject({ reason: 'DOB_MISMATCH', maskedValue: '*******0099' });

    const res = await inbound(
      `e2e-${helpReference}`,
      `Hi Ladder, I need help. Ref: ${helpReference}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ received: 1 });

    // Ladder's opening message asks for a language, as in the Zenith flow.
    const opener = await replyTo(1);
    expect(opener.issueId).toBe(issue.id);
    expect(opener.body).toBe(
      'Hello! I’m Ladder, here to help you with your recent Zenith Bank account application. Which language would you like us to use? English, Nigerian Pidgin, Yoruba, Hausa, Igbo, or another?',
    );
    expect(opener.status).toBe('SENT');
    await expect(
      prisma.assistanceIssue.findUniqueOrThrow({ where: { id: issue.id } }),
    ).resolves.toMatchObject({ contactPhone: PHONE });

    // Infobip retrying the same webhook gets no second reply.
    await inbound(`e2e-${helpReference}`, `Hi Ladder, I need help. Ref: ${helpReference}`);
    await new Promise((r) => setTimeout(r, 300));
    expect(
      await prisma.whatsAppMessage.count({ where: { phone: PHONE, direction: 'OUTBOUND' } }),
    ).toBe(1);

    // The answer (no reference needed) stays on the same issue and explains it. Groq is off in
    // tests, so this is the fixed explanation.
    await inbound(`e2e-followup-${helpReference}`, 'English');
    const explanation = await replyTo(2);
    expect(explanation.issueId).toBe(issue.id);
    expect(explanation.body).toContain('date of birth entered does not match');
  });
});
