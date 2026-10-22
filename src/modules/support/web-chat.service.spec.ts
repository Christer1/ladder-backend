import { AssistanceIssue } from '@prisma/client';
import { InMemoryWebChatStore } from '../../../test/in-memory-web-chat.store';
import { GroqService, LlmUnavailableError } from '../../integrations/llm/groq.service';
import { HelpChatAgent } from './help-chat.agent';
import { SupportRepository } from './support.repository';
import { WebChatService } from './web-chat.service';
import { WebChatStore } from './web-chat.store';

const REF = 'LDR-7K3QX9';
const TOKEN = `token:help_${REF}`;
const OPENER =
  'Hello! I’m Ladder, here to help you with your recent Zenith Bank account application. Which language would you like us to use? English, Nigerian Pidgin, Yoruba, Hausa, Igbo, or another?';

const issue = (overrides: Partial<AssistanceIssue> = {}): AssistanceIssue => ({
  id: 'issue-1',
  reference: REF,
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

const ai = (reply: string, preferredLanguage: string | null = null) =>
  JSON.stringify({ preferred_language: preferredLanguage, reply });

describe('WebChatService', () => {
  let store: InMemoryWebChatStore;
  let repo: jest.Mocked<SupportRepository>;
  let groq: jest.Mocked<GroqService>;
  let service: WebChatService;

  const aiCall = (n = 0) => groq.complete.mock.calls[n][0];
  const send = async (text: string) => {
    await service.sendMessage('zenith', REF, TOKEN, text);
    await service.whenIdle(REF);
  };

  beforeEach(() => {
    store = new InMemoryWebChatStore();
    repo = {
      findIssueByReference: jest.fn().mockResolvedValue(issue()),
    } as unknown as jest.Mocked<SupportRepository>;
    groq = {
      isConfigured: true,
      complete: jest.fn().mockResolvedValue(ai('Check your date of birth and try again.')),
    } as unknown as jest.Mocked<GroqService>;
    service = new WebChatService(store as unknown as WebChatStore, repo, new HelpChatAgent(groq));
  });

  describe('startChat', () => {
    it('opens the chat with the preset message and the language question', async () => {
      const started = await service.startChat('zenith', REF);

      expect(started).toEqual({ chatId: REF, firebaseToken: TOKEN });
      expect(store.transcript(REF)).toEqual([
        `customer: Hi Ladder, I need help with my account opening. Ref: ${REF}`,
        `ladder: ${OPENER}`,
      ]);
      expect(groq.complete).not.toHaveBeenCalled();
    });

    it('reopens the same chat when Get help is tapped again', async () => {
      await service.startChat('zenith', REF);
      await send('English');
      const again = await service.startChat('zenith', REF);

      expect(again.chatId).toBe(REF);
      expect(store.transcript(REF)).toHaveLength(4);
    });

    it('opens a new chat about the details screen when there is no reference', async () => {
      const started = await service.startChat('zenith');

      expect(started.chatId).toMatch(/^web-[0-9a-f-]{36}$/);
      expect(store.transcript(started.chatId)[0]).toContain('My details are not loading');
      expect(repo.findIssueByReference).not.toHaveBeenCalled();
    });

    it.each([
      ['unknown', null],
      ['from another partner', issue({ partnerId: 'gtbank' })],
    ])('refuses a reference that is %s', async (_case, found) => {
      repo.findIssueByReference.mockResolvedValue(found);
      await expect(service.startChat('zenith', REF)).rejects.toMatchObject({
        code: 'HELP_REFERENCE_NOT_FOUND',
      });
    });

    it('refuses an expired reference that never opened a chat', async () => {
      repo.findIssueByReference.mockResolvedValue(issue({ expiresAt: new Date(Date.now() - 1) }));
      await expect(service.startChat('zenith', REF)).rejects.toMatchObject({
        code: 'HELP_REFERENCE_EXPIRED',
      });
    });

    it('reopens a chat after its reference expired', async () => {
      await service.startChat('zenith', REF);
      repo.findIssueByReference.mockResolvedValue(issue({ expiresAt: new Date(Date.now() - 1) }));
      await expect(service.startChat('zenith', REF)).resolves.toMatchObject({ chatId: REF });
    });

    it('answers HELP_CHAT_UNAVAILABLE without Firebase', async () => {
      store.isConfigured = false;
      await expect(service.startChat('zenith', REF)).rejects.toMatchObject({
        code: 'HELP_CHAT_UNAVAILABLE',
      });
    });
  });

  describe('sendMessage', () => {
    beforeEach(() => service.startChat('zenith', REF));

    it('saves the language the customer picks and explains the issue in it', async () => {
      groq.complete.mockResolvedValue(ai('Ọjọ́ ìbí tí o tẹ̀ kò bá ti BVN rẹ mu…', 'Yoruba'));

      await send('Yoruba');

      const [system, input] = aiCall();
      expect(system.content).toContain('tapped "Get help"');
      expect(input.content).toContain('"preferred_language":null');
      expect(input.content).toContain('The date of birth entered does not match');
      expect(input.content).toContain(`Customer: Hi Ladder, I need help with my account opening`);
      expect(input.content).toContain(`Ladder: ${OPENER}`);
      expect(store.chats.get(REF)?.preferredLanguage).toBe('Yoruba');
      expect(store.transcript(REF).slice(-2)).toEqual([
        'customer: Yoruba',
        'ladder: Ọjọ́ ìbí tí o tẹ̀ kò bá ti BVN rẹ mu…',
      ]);
    });

    it('passes the chosen language on to later replies', async () => {
      groq.complete
        .mockResolvedValueOnce(ai('O dabo', 'Yoruba'))
        .mockResolvedValueOnce(ai('Bẹẹni'));

      await service.sendMessage('zenith', REF, TOKEN, 'Yoruba');
      await service.sendMessage('zenith', REF, TOKEN, 'ok');
      await service.whenIdle(REF);

      expect(aiCall(1)[1].content).toContain('"preferred_language":"Yoruba"');
      // Answered in order, one at a time.
      expect(store.transcript(REF).slice(-4)).toEqual([
        'customer: Yoruba',
        'customer: ok',
        'ladder: O dabo',
        'ladder: Bẹẹni',
      ]);
    });

    it('shows Ladder typing while the AI writes, and clears it after', async () => {
      await send('English');
      expect(store.typing).toEqual([true, false]);
      expect(store.chats.get(REF)?.aiTyping).toBe(false);
    });

    it('masks ID numbers before storing the message or showing it to the AI', async () => {
      await send('My BVN is 22345678901');

      expect(store.transcript(REF)).toContain('customer: My BVN is [number removed]');
      expect(JSON.stringify(groq.complete.mock.calls)).not.toContain('22345678901');
    });

    it('sends the fixed explanation when the AI is unavailable', async () => {
      groq.complete.mockRejectedValue(new LlmUnavailableError('down'));

      await send('English');

      const reply = store.transcript(REF).at(-1);
      expect(reply).toContain(`ref ${REF}`);
      expect(reply).toContain('*What went wrong:* The date of birth entered does not match');
      expect(store.typing.at(-1)).toBe(false);
    });

    it('explains the details screen problem in a chat without a reference', async () => {
      const { chatId, firebaseToken } = await service.startChat('zenith');
      Object.assign(groq, { isConfigured: false });

      await service.sendMessage('zenith', chatId, firebaseToken, 'English');
      await service.whenIdle(chatId);

      expect(store.transcript(chatId).at(-1)).toContain('could not load their details');
    });

    it.each([
      ['no token', ''],
      ['the token of another chat', 'token:help_LDR-2222AA'],
    ])('refuses a message with %s', async (_case, token) => {
      await expect(service.sendMessage('zenith', REF, token, 'hi')).rejects.toMatchObject({
        code: 'HELP_CHAT_SESSION_INVALID',
      });
      expect(store.transcript(REF)).toHaveLength(2);
    });

    it('refuses a message for another partner’s chat', async () => {
      await expect(service.sendMessage('gtbank', REF, TOKEN, 'hi')).rejects.toMatchObject({
        code: 'HELP_CHAT_SESSION_INVALID',
      });
    });

    it('refuses a chat id that is not one Ladder creates', async () => {
      await expect(
        service.sendMessage('zenith', 'helpChats/x', 'token:help_helpChats/x', 'hi'),
      ).rejects.toMatchObject({ code: 'HELP_CHAT_SESSION_INVALID' });
    });
  });
});
