import { AssistanceIssue } from '@prisma/client';
import { InMemoryWebChatStore } from '../../../test/in-memory-web-chat.store';
import { GroqService, LlmUnavailableError } from '../../integrations/llm/groq.service';
import { HelpChatAgent } from './help-chat.agent';
import { SupportRepository } from './support.repository';
import { SupportService } from './support.service';
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
  status: 'OPEN',
  attempts: 1,
  lastAttemptAt: new Date(),
  attemptFingerprint: 'fp-attempt',
  idFingerprint: 'fp-id',
  openFingerprint: 'fp-attempt',
  resolvedAt: null,
  resolvedBy: null,
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
  let support: jest.Mocked<SupportService>;
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
    support = {
      markInChat: jest.fn(),
      markNeedsAttention: jest.fn(),
    } as unknown as jest.Mocked<SupportService>;
    service = new WebChatService(
      store as unknown as WebChatStore,
      repo,
      support,
      new HelpChatAgent(groq),
    );
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
      expect(support.markInChat).toHaveBeenCalledWith('issue-1');
    });

    it('reopens the same chat when Get help is tapped again', async () => {
      await service.startChat('zenith', REF);
      await send('English');
      const again = await service.startChat('zenith', REF);

      expect(again.chatId).toBe(REF);
      expect(store.transcript(REF)).toHaveLength(4);
      expect(support.markInChat).toHaveBeenCalledTimes(1);
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

    it('gives the AI where to go and what to bring when the record must be fixed', async () => {
      await send('English');

      const data = aiCall()[1].content;
      expect(data).toContain('"office_visit":{"BVN":');
      expect(data).toContain('Birth certificate, or a sworn declaration of age');
      expect(data).toContain('"other_record_fixes":{"BVN":');
      expect(aiCall()[0].content).toContain('Never mention fees');
    });

    it('flags the issue for an agent when the customer asks for a person', async () => {
      groq.complete.mockResolvedValue(
        JSON.stringify({
          preferred_language: null,
          needs_human: true,
          reply: 'An agent will help.',
        }),
      );
      await send('Can I talk to a person?');
      expect(support.markNeedsAttention).toHaveBeenCalledWith('issue-1');
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

    describe('when an agent takes over', () => {
      it('posts the agent’s message, and the AI stops answering', async () => {
        await service.postAgentMessage(REF, 'Ladder Support', 'Hi, I’m here to help.');
        await send('Thank you');

        expect(store.chats.get(REF)).toMatchObject({ mode: 'agent', agentName: 'Ladder Support' });
        expect(store.messages.get(REF)?.at(-2)).toMatchObject({
          sender: 'agent',
          agentName: 'Ladder Support',
        });
        expect(store.transcript(REF).at(-1)).toBe('customer: Thank you');
        expect(groq.complete).not.toHaveBeenCalled();
        // The customer is waiting for the agent.
        expect(support.markNeedsAttention).toHaveBeenCalledWith('issue-1');
      });

      it('drops an AI reply that was still being written', async () => {
        groq.complete.mockImplementation(async () => {
          await service.postAgentMessage(REF, 'Ladder Support', 'I’ve got this.');
          return ai('AI reply');
        });

        await send('English');

        expect(store.transcript(REF)).not.toContain('ladder: AI reply');
        expect(store.transcript(REF).at(-1)).toBe('agent: I’ve got this.');
      });

      it('lets the AI answer again after the agent hands the chat back', async () => {
        await service.postAgentMessage(REF, 'Ladder Support', 'Hello');
        await service.handBackToAi(REF);
        await send('English');

        expect(store.chats.get(REF)).toMatchObject({ mode: 'ai', agentName: null });
        expect(store.transcript(REF)).toContain(
          'ladder: You’re back with Ladder’s assistant. Ask me anything about your account opening check.',
        );
        expect(store.transcript(REF).at(-1)).toBe(
          'ladder: Check your date of birth and try again.',
        );
        // The AI sees what the agent said.
        expect(aiCall()[1].content).toContain('Ladder agent: Hello');
      });

      it('refuses an agent message before the customer opens the chat', async () => {
        await expect(
          service.postAgentMessage('LDR-2222AB', 'Ladder Support', 'Hi'),
        ).rejects.toMatchObject({ code: 'HELP_CHAT_NOT_STARTED' });
      });
    });

    it('refuses a chat id that is not one Ladder creates', async () => {
      await expect(
        service.sendMessage('zenith', 'helpChats/x', 'token:help_helpChats/x', 'hi'),
      ).rejects.toMatchObject({ code: 'HELP_CHAT_SESSION_INVALID' });
    });
  });
});
