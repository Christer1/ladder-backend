import { ConfigService } from '@nestjs/config';
import { AssistanceIssue, Prisma, WhatsAppMessage } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { GroqService, LlmUnavailableError } from '../../integrations/llm/groq.service';
import { HelpChatAgent } from './help-chat.agent';
import { WhatsAppProvider } from '../../integrations/whatsapp/whatsapp.provider';
import { SupportRepository } from './support.repository';
import { SupportService } from './support.service';

const PHONE = '+2348150990267';
const CONFIG: Record<string, string> = { INFOBIP_WHATSAPP_SENDER: '447860088970' };
const OPENER =
  'Hello! I’m Ladder, here to help you with your recent Zenith Bank account application. Which language would you like us to use? English, Nigerian Pidgin, Yoruba, Hausa, Igbo, or another?';

const issue = (overrides: Partial<AssistanceIssue> = {}): AssistanceIssue => ({
  id: 'issue-1',
  reference: 'LDR-7K3QX9',
  partnerId: 'zenith',
  method: 'BVN',
  failedType: 'BVN',
  reason: 'DOB_MISMATCH',
  maskedValue: '*******8901',
  contactPhone: null,
  preferredLanguage: null,
  expiresAt: new Date(Date.now() + 60_000),
  createdAt: new Date('2026-10-22T10:00:00Z'),
  updatedAt: new Date('2026-10-22T10:00:00Z'),
  ...overrides,
});

// What the AI returns in JSON mode.
const ai = (reply: string, preferredLanguage: string | null = null) =>
  JSON.stringify({ preferred_language: preferredLanguage, reply });

const inbound = (text: string, messageId = 'ib-in-1') => ({ messageId, fromPhone: PHONE, text });

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' });

describe('SupportService', () => {
  let repo: jest.Mocked<SupportRepository>;
  let groq: jest.Mocked<GroqService>;
  let whatsApp: jest.Mocked<WhatsAppProvider>;
  let service: SupportService;

  const sentText = (): string => whatsApp.sendText.mock.calls[0][1];
  const aiInput = (): string => groq.complete.mock.calls[0][0][1].content;

  beforeEach(() => {
    repo = {
      createIssue: jest.fn(async (data) => issue({ reference: data.reference })),
      findIssueByReference: jest.fn().mockResolvedValue(null),
      claimIssue: jest.fn().mockResolvedValue(true),
      findLatestIssueForPhone: jest.fn().mockResolvedValue(null),
      setPreferredLanguage: jest.fn(),
      touchIssue: jest.fn(),
      createMessage: jest.fn(async (data) => ({ id: `msg-${data.direction}` }) as WhatsAppMessage),
      updateMessage: jest.fn(),
      findMessageByProviderId: jest.fn(),
      updateMessageStatus: jest.fn(),
      recentMessages: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<SupportRepository>;
    groq = {
      isConfigured: true,
      complete: jest.fn().mockResolvedValue(ai('Check your date of birth and try again.')),
    } as unknown as jest.Mocked<GroqService>;
    whatsApp = {
      name: 'console',
      sendText: jest.fn().mockResolvedValue({ providerMessageId: 'ib-out-1', status: 'SENT' }),
    };
    const config = { get: (key: string) => CONFIG[key] } as unknown as ConfigService;
    service = new SupportService(repo, config as never, new HelpChatAgent(groq), whatsApp);
  });

  describe('openIssue', () => {
    it('stores only the last 4 characters and returns a pre-typed WhatsApp link', async () => {
      const help = await service.openIssue({
        partnerId: 'zenith',
        method: 'BVN',
        failedType: 'BVN',
        reason: 'DOB_MISMATCH',
        enteredValue: '22345678901',
      });

      expect(help.helpReference).toMatch(/^LDR-[2-9A-HJKMNP-Z]{6}$/);
      expect(help.whatsappUrl).toBe(
        `https://wa.me/447860088970?text=${encodeURIComponent(
          `Hi Ladder, I need help with my account opening. Ref: ${help.helpReference}`,
        )}`,
      );
      expect(repo.createIssue).toHaveBeenCalledWith(
        expect.objectContaining({ maskedValue: '*******8901', reason: 'DOB_MISMATCH' }),
      );
      expect(JSON.stringify(repo.createIssue.mock.calls)).not.toContain('22345678901');
    });

    it('retries when a reference is already taken', async () => {
      repo.createIssue.mockRejectedValueOnce(uniqueViolation());
      await service.openIssue({
        partnerId: 'zenith',
        method: 'LADDER_ID',
        failedType: null,
        reason: 'LADDER_ID_UNKNOWN',
        enteredValue: 'LID-ABCD-EFGH',
      });
      expect(repo.createIssue).toHaveBeenCalledTimes(2);
    });
  });

  describe('handleInbound', () => {
    it('claims the issue named in the message and sends the opening message', async () => {
      repo.findIssueByReference.mockResolvedValue(issue());

      await service.handleInbound(inbound('Hi Ladder, I need help. Ref: ldr-7k3qx9'));

      expect(repo.findIssueByReference).toHaveBeenCalledWith('LDR-7K3QX9');
      expect(repo.claimIssue).toHaveBeenCalledWith('issue-1', PHONE);
      expect(repo.updateMessage).toHaveBeenCalledWith('msg-INBOUND', { issueId: 'issue-1' });
      expect(groq.complete).not.toHaveBeenCalled();
      expect(whatsApp.sendText).toHaveBeenCalledWith(PHONE, OPENER);
      expect(repo.updateMessage).toHaveBeenCalledWith('msg-OUTBOUND', {
        providerMessageId: 'ib-out-1',
        status: 'SENT',
      });
    });

    it('saves the language the customer picks and explains the issue in it', async () => {
      repo.findLatestIssueForPhone.mockResolvedValue(issue({ contactPhone: PHONE }));
      groq.complete.mockResolvedValue(ai('Ọjọ́ ìbí tí o tẹ̀ kò bá ti BVN rẹ mu…', 'Yoruba'));

      await service.handleInbound(inbound('Yoruba'));

      expect(groq.complete).toHaveBeenCalledWith(expect.any(Array), { json: true });
      expect(aiInput()).toContain('"preferred_language":null');
      expect(aiInput()).toContain('The date of birth entered does not match');
      expect(aiInput()).toContain('"value_entered_ends_with":"8901"');
      expect(repo.setPreferredLanguage).toHaveBeenCalledWith('issue-1', 'Yoruba');
      expect(sentText()).toBe('Ọjọ́ ìbí tí o tẹ̀ kò bá ti BVN rẹ mu…');
    });

    it('keeps an already chosen language', async () => {
      repo.findLatestIssueForPhone.mockResolvedValue(
        issue({ contactPhone: PHONE, preferredLanguage: 'Yoruba' }),
      );
      groq.complete.mockResolvedValue(ai('Ẹ ṣe é! BVN rẹ pari pẹlu **8901**.', 'Yoruba'));

      await service.handleInbound(inbound('ok'));

      expect(sentText()).toBe('Ẹ ṣe é! BVN rẹ pari pẹlu *8901*.');

      expect(aiInput()).toContain('"preferred_language":"Yoruba"');
      expect(repo.setPreferredLanguage).not.toHaveBeenCalled();
    });

    it('answers a resent reference on an issue this phone already claimed with the AI', async () => {
      repo.findIssueByReference.mockResolvedValue(issue({ contactPhone: PHONE }));

      await service.handleInbound(inbound('Ref: LDR-7K3QX9'));

      expect(repo.claimIssue).not.toHaveBeenCalled();
      expect(sentText()).toBe('Check your date of birth and try again.');
    });

    it('does not reveal an issue already claimed by another phone', async () => {
      repo.findIssueByReference.mockResolvedValue(issue({ contactPhone: '+2349000000000' }));

      await service.handleInbound(inbound('Ref: LDR-7K3QX9'));

      expect(repo.claimIssue).not.toHaveBeenCalled();
      expect(aiInput()).toContain('already being used in a chat from another phone');
      expect(aiInput()).not.toContain('date of birth');
    });

    it('ignores a message Infobip delivers twice', async () => {
      repo.createMessage.mockRejectedValueOnce(uniqueViolation());
      await service.handleInbound(inbound('Ref: LDR-7K3QX9'));
      expect(whatsApp.sendText).not.toHaveBeenCalled();
    });

    it('masks ID numbers before storing the message or showing it to the AI', async () => {
      await service.handleInbound(inbound('My BVN is 22345678901'));

      expect(repo.createMessage).toHaveBeenCalledWith(
        expect.objectContaining({ direction: 'INBOUND', body: 'My BVN is [number removed]' }),
      );
      expect(aiInput()).not.toContain('22345678901');
    });

    it.each([
      ['breaks the rules', ai('Your account is now open!')],
      ['is not the requested JSON', 'Please check your date of birth.'],
    ])('asks the AI to rewrite a reply that %s', async (_case, firstReply) => {
      repo.findLatestIssueForPhone.mockResolvedValue(issue({ contactPhone: PHONE }));
      groq.complete
        .mockResolvedValueOnce(firstReply)
        .mockResolvedValueOnce(ai('Please check your date of birth.'));

      await service.handleInbound(inbound('English'));

      expect(groq.complete).toHaveBeenCalledTimes(2);
      expect(sentText()).toBe('Please check your date of birth.');
    });

    it('sends the fixed explanation when the AI is unavailable', async () => {
      repo.findLatestIssueForPhone.mockResolvedValue(issue({ contactPhone: PHONE }));
      groq.complete.mockRejectedValue(new LlmUnavailableError('down'));

      await service.handleInbound(inbound('English'));

      expect(sentText()).toContain('ref LDR-7K3QX9');
      expect(sentText()).toContain('*What went wrong:* The date of birth entered does not match');
    });

    it('asks for the reference when it cannot tell what the message is about', async () => {
      Object.assign(groq, { isConfigured: false });

      await service.handleInbound(inbound('Hello'));

      expect(groq.complete).not.toHaveBeenCalled();
      expect(sentText()).toContain('LDR-XXXXXX');
    });

    it('records a failed send', async () => {
      whatsApp.sendText.mockRejectedValue(new AppError('WHATSAPP_SEND_FAILED'));

      await service.handleInbound(inbound('Hello'));

      expect(repo.updateMessageStatus).toHaveBeenCalledWith(
        'msg-OUTBOUND',
        'FAILED',
        'WHATSAPP_SEND_FAILED',
      );
    });
  });

  describe('handleReports', () => {
    it('applies later statuses and ignores out-of-order earlier ones', async () => {
      repo.findMessageByProviderId.mockResolvedValue({
        id: 'msg-1',
        status: 'DELIVERED',
      } as WhatsAppMessage);

      await service.handleReports([
        { messageId: 'ib-out-1', status: 'SENT' },
        { messageId: 'ib-out-1', status: 'READ' },
      ]);

      expect(repo.updateMessageStatus).toHaveBeenCalledTimes(1);
      expect(repo.updateMessageStatus).toHaveBeenCalledWith('msg-1', 'READ', undefined);
    });
  });
});
