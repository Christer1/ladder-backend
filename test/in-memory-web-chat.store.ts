import {
  NewWebChatMessage,
  WebChat,
  WebChatMessage,
  webChatUid,
  WebChatStore,
} from '../src/modules/support/web-chat.store';

// WebChatStore without Firebase, for unit and e2e tests. Tokens are "token:<uid>".
export class InMemoryWebChatStore implements Pick<WebChatStore, keyof WebChatStore> {
  isConfigured = true;
  readonly chats = new Map<string, WebChat & { aiTyping: boolean }>();
  readonly messages = new Map<string, WebChatMessage[]>();
  // Every aiTyping change, in order.
  readonly typing: boolean[] = [];
  private nextId = 1;

  async createChat(
    chat: Omit<WebChat, 'createdAt'>,
    messages: NewWebChatMessage[],
  ): Promise<{ chat: WebChat; created: boolean }> {
    const existing = this.chats.get(chat.id);
    if (existing) return { chat: existing, created: false };
    const stored = { ...chat, createdAt: new Date(), aiTyping: false };
    this.chats.set(chat.id, stored);
    this.messages.set(chat.id, []);
    for (const message of messages) await this.addMessage(chat.id, message);
    return { chat: stored, created: true };
  }

  async findChat(id: string): Promise<WebChat | null> {
    const chat = this.chats.get(id);
    return chat ? { ...chat } : null;
  }

  async addMessage(chatId: string, message: NewWebChatMessage): Promise<string> {
    const id = `m${this.nextId++}`;
    this.messages.get(chatId)?.push({ id, ...message, createdAt: new Date() });
    return id;
  }

  async recentMessages(chatId: string, take: number): Promise<WebChatMessage[]> {
    return (this.messages.get(chatId) ?? []).slice(-take);
  }

  async setTyping(chatId: string, aiTyping: boolean): Promise<void> {
    this.typing.push(aiTyping);
    const chat = this.chats.get(chatId);
    if (chat) chat.aiTyping = aiTyping;
  }

  async setPreferredLanguage(chatId: string, preferredLanguage: string): Promise<void> {
    const chat = this.chats.get(chatId);
    if (chat) chat.preferredLanguage = preferredLanguage;
  }

  async issueToken(chatId: string): Promise<string> {
    return `token:${webChatUid(chatId)}`;
  }

  async verifyToken(idToken: string): Promise<string | null> {
    return idToken.startsWith('token:') ? idToken.slice('token:'.length) : null;
  }

  // The texts of a chat's messages, oldest first, prefixed with who sent them.
  transcript(chatId: string): string[] {
    return (this.messages.get(chatId) ?? []).map((m) => `${m.sender}: ${m.text}`);
  }
}
