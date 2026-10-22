import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { AssistanceIssue } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AppError } from '../../common/errors/app-error';
import { HELP_CHAT_TTL_DAYS, HELP_TRANSCRIPT_MESSAGES } from '../../config/app.config';
import { WebChatStartResponse } from './dto/web-chat.response';
import { HelpChatAgent } from './help-chat.agent';
import { detailsUnavailableContext, issueContext, partnerName } from './help-chat.context';
import { helpChatOpener } from './help-chat.prompts';
import { SupportRepository } from './support.repository';
import { SupportService } from './support.service';
import { maskLongNumbers } from './validate-reply';
import { WebChat, WebChatMessage, webChatUid, WebChatStore } from './web-chat.store';

const DAY_MS = 86_400_000;
// Firestore document ids: help references (LDR-XXXXXX) and web-<uuid>.
const CHAT_ID_PATTERN = /^(LDR-[2-9A-HJKMNP-Z]{6}|web-[0-9a-f-]{36})$/;

// The message the customer "sends" when Get help opens the chat, so the chat starts from their
// problem without them typing anything.
const presetMessage = (reference: string | null): string =>
  reference
    ? `Hi Ladder, I need help with my account opening. Ref: ${reference}`
    : 'Hi Ladder, I need help. My details are not loading on the account opening screen.';

// Shown to the customer when an agent hands the chat back to the AI.
const HANDED_BACK =
  'You’re back with Ladder’s assistant. Ask me anything about your account opening check.';

// Help chat in a widget on the partner screen, stored in Firestore. Get help opens the chat with a
// preset customer message and Ladder's language question; the AI answers every message after,
// unless an agent on ladder-agent-dashboard has taken the chat over.
@Injectable()
export class WebChatService implements OnModuleDestroy {
  private readonly logger = new Logger(WebChatService.name);
  // Replies being written, per chat: one message is answered at a time, in order.
  private readonly queues = new Map<string, Promise<void>>();

  constructor(
    private readonly store: WebChatStore,
    private readonly supportRepository: SupportRepository,
    private readonly supportService: SupportService,
    private readonly agent: HelpChatAgent,
  ) {}

  // Opens the chat for a help reference, or reopens it. Without a reference, opens a new chat for
  // the "couldn't load your details" screen.
  async startChat(partnerId: string, reference?: string): Promise<WebChatStartResponse> {
    this.ensureConfigured();
    const issue = reference ? await this.checkReference(partnerId, reference) : null;
    const chatId = issue?.reference ?? `web-${randomUUID()}`;

    const { chat, created } = await this.store.createChat(
      { id: chatId, partnerId, reference: reference ?? null, preferredLanguage: null },
      [
        { sender: 'customer', text: presetMessage(reference ?? null) },
        { sender: 'ladder', text: helpChatOpener(partnerName(partnerId)) },
      ],
    );
    if (!created && chat.createdAt.getTime() < Date.now() - HELP_CHAT_TTL_DAYS * DAY_MS) {
      throw new AppError('HELP_REFERENCE_EXPIRED');
    }
    if (issue && created) await this.supportService.markInChat(issue.id);
    return { chatId, firebaseToken: await this.store.issueToken(chatId) };
  }

  // Stores the customer's message and answers it in the background; the widget sees both live.
  async sendMessage(
    partnerId: string,
    chatId: string,
    idToken: string,
    text: string,
  ): Promise<void> {
    this.ensureConfigured();
    if (
      !CHAT_ID_PATTERN.test(chatId) ||
      (await this.store.verifyToken(idToken)) !== webChatUid(chatId)
    ) {
      throw new AppError('HELP_CHAT_SESSION_INVALID');
    }
    const chat = await this.store.findChat(chatId);
    if (!chat || chat.partnerId !== partnerId) throw new AppError('HELP_CHAT_SESSION_INVALID');

    const masked = maskLongNumbers(text);
    const messageId = await this.store.addMessage(chatId, { sender: 'customer', text: masked });
    if (chat.mode === 'agent') {
      // The agent answers; the case shows the customer is waiting.
      await this.flagIssue(chat);
      return;
    }
    this.enqueue(chatId, () => this.answer(chatId, messageId, masked));
  }

  // The chat for an agent: null if the customer never opened it.
  async getChat(chatId: string): Promise<{ chat: WebChat; messages: WebChatMessage[] } | null> {
    if (!this.store.isConfigured) return null;
    const chat = await this.store.findChat(chatId);
    if (!chat) return null;
    return { chat, messages: await this.store.recentMessages(chatId, 500) };
  }

  // An agent writes to the customer and takes the chat over: the AI stops answering.
  async postAgentMessage(chatId: string, agentName: string, text: string): Promise<void> {
    await this.requireChat(chatId);
    await this.store.setMode(chatId, 'agent', agentName);
    await this.store.addMessage(chatId, {
      sender: 'agent',
      text: maskLongNumbers(text),
      agentName,
    });
  }

  // A fixed Ladder message sent by an agent (e.g. the recovery instructions). Keeps the mode.
  async postLadderMessage(chatId: string, text: string): Promise<void> {
    await this.requireChat(chatId);
    await this.store.addMessage(chatId, { sender: 'ladder', text });
  }

  async handBackToAi(chatId: string): Promise<void> {
    const chat = await this.requireChat(chatId);
    if (chat.mode === 'ai') return;
    await this.store.setMode(chatId, 'ai', null);
    await this.store.addMessage(chatId, { sender: 'ladder', text: HANDED_BACK });
  }

  // Resolves once every reply queued for the chat is written. For shutdown and tests.
  async whenIdle(chatId: string): Promise<void> {
    while (this.queues.has(chatId)) await this.queues.get(chatId);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.keys()].map((chatId) => this.whenIdle(chatId)));
  }

  // The chat id for a reference is the reference itself, so Get help always reopens the same chat.
  private async checkReference(partnerId: string, reference: string): Promise<AssistanceIssue> {
    const issue = await this.supportRepository.findIssueByReference(reference);
    if (!issue || issue.partnerId !== partnerId) throw new AppError('HELP_REFERENCE_NOT_FOUND');
    // An unexpired reference can open a chat; an open chat can be reopened (checked by startChat).
    if (issue.expiresAt <= new Date() && !(await this.store.findChat(reference))) {
      throw new AppError('HELP_REFERENCE_EXPIRED');
    }
    return issue;
  }

  private async answer(chatId: string, messageId: string, text: string): Promise<void> {
    // Read again: an earlier reply may have saved the language, or an agent may have taken over.
    const chat = (await this.store.findChat(chatId)) as WebChat;
    if (chat.mode === 'agent') return;

    await this.store.setTyping(chatId, true);
    try {
      const history = await this.store.recentMessages(chatId, HELP_TRANSCRIPT_MESSAGES + 1);
      const issue = await this.issueFor(chat);
      const context = issue
        ? issueContext(issue, chat.preferredLanguage)
        : detailsUnavailableContext(chat.partnerId, chat.preferredLanguage);

      const { reply, preferredLanguage, needsHuman, aiFailed } = await this.agent.reply({
        channel: 'web',
        data: context.data,
        transcript: history
          .filter((m) => m.id !== messageId)
          .map((m) => ({ from: m.sender, text: m.text })),
        text,
        fallback: context.fallback,
      });
      if (preferredLanguage && preferredLanguage !== chat.preferredLanguage) {
        await this.store.setPreferredLanguage(chatId, preferredLanguage);
      }
      // An agent may have taken over while the AI was writing.
      if ((await this.store.findChat(chatId))?.mode === 'agent') return;
      await this.store.addMessage(chatId, { sender: 'ladder', text: reply });
      if (issue && (needsHuman || aiFailed)) await this.supportService.markNeedsAttention(issue.id);
    } finally {
      await this.store.setTyping(chatId, false);
    }
  }

  private async issueFor(chat: WebChat): Promise<AssistanceIssue | null> {
    return chat.reference ? this.supportRepository.findIssueByReference(chat.reference) : null;
  }

  private async flagIssue(chat: WebChat): Promise<void> {
    const issue = await this.issueFor(chat);
    if (issue) await this.supportService.markNeedsAttention(issue.id);
  }

  private async requireChat(chatId: string): Promise<WebChat> {
    this.ensureConfigured();
    const chat = await this.store.findChat(chatId);
    if (!chat) throw new AppError('HELP_CHAT_NOT_STARTED');
    return chat;
  }

  private enqueue(chatId: string, task: () => Promise<void>): void {
    const next = (this.queues.get(chatId) ?? Promise.resolve())
      .then(task)
      .catch((error: Error) => this.logger.error(`Web chat reply failed: ${error.stack}`))
      .finally(() => {
        if (this.queues.get(chatId) === next) this.queues.delete(chatId);
      });
    this.queues.set(chatId, next);
  }

  private ensureConfigured(): void {
    if (!this.store.isConfigured) throw new AppError('HELP_CHAT_UNAVAILABLE');
  }
}
