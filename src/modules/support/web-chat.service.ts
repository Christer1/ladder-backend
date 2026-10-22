import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AppError } from '../../common/errors/app-error';
import { HELP_CHAT_TTL_DAYS, HELP_TRANSCRIPT_MESSAGES } from '../../config/app.config';
import { WebChatStartResponse } from './dto/web-chat.response';
import { HelpChatAgent } from './help-chat.agent';
import { detailsUnavailableContext, issueContext, partnerName } from './help-chat.context';
import { helpChatOpener } from './help-chat.prompts';
import { SupportRepository } from './support.repository';
import { maskLongNumbers } from './validate-reply';
import { WebChat, webChatUid, WebChatStore } from './web-chat.store';

const DAY_MS = 86_400_000;
// Firestore document ids: help references (LDR-XXXXXX) and web-<uuid>.
const CHAT_ID_PATTERN = /^(LDR-[2-9A-HJKMNP-Z]{6}|web-[0-9a-f-]{36})$/;

// The message the customer "sends" when Get help opens the chat, so the chat starts from their
// problem without them typing anything.
const presetMessage = (reference: string | null): string =>
  reference
    ? `Hi Ladder, I need help with my account opening. Ref: ${reference}`
    : 'Hi Ladder, I need help. My details are not loading on the account opening screen.';

// Help chat in a widget on the partner screen, stored in Firestore. Get help opens the chat with a
// preset customer message and Ladder's language question; the AI answers every message after.
@Injectable()
export class WebChatService implements OnModuleDestroy {
  private readonly logger = new Logger(WebChatService.name);
  // Replies being written, per chat: one message is answered at a time, in order.
  private readonly queues = new Map<string, Promise<void>>();

  constructor(
    private readonly store: WebChatStore,
    private readonly supportRepository: SupportRepository,
    private readonly agent: HelpChatAgent,
  ) {}

  // Opens the chat for a help reference, or reopens it. Without a reference, opens a new chat for
  // the "couldn't load your details" screen.
  async startChat(partnerId: string, reference?: string): Promise<WebChatStartResponse> {
    this.ensureConfigured();
    const chatId = reference
      ? await this.checkReference(partnerId, reference)
      : `web-${randomUUID()}`;

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
    this.enqueue(chatId, () => this.answer(chatId, messageId, masked));
  }

  // Resolves once every reply queued for the chat is written. For shutdown and tests.
  async whenIdle(chatId: string): Promise<void> {
    while (this.queues.has(chatId)) await this.queues.get(chatId);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.keys()].map((chatId) => this.whenIdle(chatId)));
  }

  // The chat id for a reference: the reference itself, so Get help always reopens the same chat.
  private async checkReference(partnerId: string, reference: string): Promise<string> {
    const issue = await this.supportRepository.findIssueByReference(reference);
    if (!issue || issue.partnerId !== partnerId) throw new AppError('HELP_REFERENCE_NOT_FOUND');
    // An unexpired reference can open a chat; an open chat can be reopened (checked by startChat).
    if (issue.expiresAt <= new Date() && !(await this.store.findChat(reference))) {
      throw new AppError('HELP_REFERENCE_EXPIRED');
    }
    return reference;
  }

  private async answer(chatId: string, messageId: string, text: string): Promise<void> {
    await this.store.setTyping(chatId, true);
    try {
      // Read again: an earlier reply in the queue may have saved the customer's language.
      const chat = (await this.store.findChat(chatId)) as WebChat;
      const history = await this.store.recentMessages(chatId, HELP_TRANSCRIPT_MESSAGES + 1);
      const context = await this.contextFor(chat);

      const { reply, preferredLanguage } = await this.agent.reply({
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
      await this.store.addMessage(chatId, { sender: 'ladder', text: reply });
    } finally {
      await this.store.setTyping(chatId, false);
    }
  }

  private async contextFor(chat: WebChat) {
    const issue =
      chat.reference && (await this.supportRepository.findIssueByReference(chat.reference));
    return issue
      ? issueContext(issue, chat.preferredLanguage)
      : detailsUnavailableContext(chat.partnerId, chat.preferredLanguage);
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
