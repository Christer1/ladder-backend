import { Injectable } from '@nestjs/common';
import { DocumentSnapshot, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { WEB_CHAT_COLLECTION } from '../../config/app.config';
import { FirebaseService } from '../../integrations/firebase/firebase.service';

// ladder: the AI or a fixed Ladder message. agent: a person on ladder-agent-dashboard.
export type WebChatSender = 'customer' | 'ladder' | 'agent';

// Who answers the customer: the AI, or an agent who took the chat over.
export type WebChatMode = 'ai' | 'agent';

export interface WebChat {
  id: string;
  partnerId: string;
  // The help reference the chat is about; null for the "couldn't load your details" chat.
  reference: string | null;
  preferredLanguage: string | null;
  mode: WebChatMode;
  // The agent who has the chat, while mode is agent.
  agentName: string | null;
  createdAt: Date;
}

export interface WebChatMessage {
  id: string;
  sender: WebChatSender;
  text: string;
  agentName: string | null;
  createdAt: Date;
}

export interface NewWebChatMessage {
  sender: WebChatSender;
  text: string;
  agentName?: string;
}

// The Firebase user a customer's browser signs in as. firestore.rules lets it read only this chat.
export const webChatUid = (chatId: string): string => `help_${chatId}`;

// The web help chat in Firestore: helpChats/{chatId} and its messages subcollection. Only the
// backend writes; browsers read their own chat live (firestore.rules).
@Injectable()
export class WebChatStore {
  constructor(private readonly firebase: FirebaseService) {}

  get isConfigured(): boolean {
    return this.firebase.isConfigured;
  }

  // Creates the chat with its first messages, unless it already exists. Returns the stored chat.
  async createChat(
    chat: Omit<WebChat, 'createdAt' | 'mode' | 'agentName'>,
    messages: NewWebChatMessage[],
  ): Promise<{ chat: WebChat; created: boolean }> {
    const db = this.firebase.firestore;
    const ref = this.chats().doc(chat.id);
    return db.runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      if (existing.exists) return { chat: toChat(existing), created: false };

      // Explicit, increasing times: messages written together must keep their order.
      const now = Date.now();
      const last = messages[messages.length - 1];
      tx.create(ref, {
        partnerId: chat.partnerId,
        reference: chat.reference,
        preferredLanguage: chat.preferredLanguage,
        mode: 'ai',
        agentName: null,
        aiTyping: false,
        lastMessage: last?.text ?? '',
        lastSender: last?.sender ?? null,
        createdAt: Timestamp.fromMillis(now),
        updatedAt: Timestamp.fromMillis(now + messages.length),
      });
      messages.forEach((message, i) =>
        tx.create(ref.collection('messages').doc(), {
          ...toDoc(message),
          createdAt: Timestamp.fromMillis(now + i),
        }),
      );
      return {
        chat: { ...chat, mode: 'ai', agentName: null, createdAt: new Date(now) },
        created: true,
      };
    });
  }

  async findChat(id: string): Promise<WebChat | null> {
    const snapshot = await this.chats().doc(id).get();
    return snapshot.exists ? toChat(snapshot) : null;
  }

  async addMessage(chatId: string, message: NewWebChatMessage): Promise<string> {
    const db = this.firebase.firestore;
    const chatRef = this.chats().doc(chatId);
    const messageRef = chatRef.collection('messages').doc();
    const now = Timestamp.now();
    await db
      .batch()
      .create(messageRef, { ...toDoc(message), createdAt: now })
      .update(chatRef, { lastMessage: message.text, lastSender: message.sender, updatedAt: now })
      .commit();
    return messageRef.id;
  }

  // The latest messages, oldest first.
  async recentMessages(chatId: string, take: number): Promise<WebChatMessage[]> {
    const snapshot = await this.chats()
      .doc(chatId)
      .collection('messages')
      .orderBy('createdAt', 'desc')
      .limit(take)
      .get();
    return snapshot.docs.reverse().map((doc) => ({
      id: doc.id,
      sender: doc.get('sender') as WebChatSender,
      text: doc.get('text') as string,
      agentName: (doc.get('agentName') as string | undefined) ?? null,
      createdAt: (doc.get('createdAt') as Timestamp).toDate(),
    }));
  }

  // An agent takes the chat over (the AI stops answering), or hands it back.
  async setMode(chatId: string, mode: WebChatMode, agentName: string | null): Promise<void> {
    await this.chats()
      .doc(chatId)
      .update({ mode, agentName, aiTyping: false, updatedAt: FieldValue.serverTimestamp() });
  }

  // Shows "Ladder is typing" in the widget while the AI writes.
  async setTyping(chatId: string, aiTyping: boolean): Promise<void> {
    await this.chats().doc(chatId).update({ aiTyping });
  }

  async setPreferredLanguage(chatId: string, preferredLanguage: string): Promise<void> {
    await this.chats()
      .doc(chatId)
      .update({ preferredLanguage, updatedAt: FieldValue.serverTimestamp() });
  }

  // A Firebase custom token for the customer's browser. It signs in as webChatUid(chatId).
  async issueToken(chatId: string): Promise<string> {
    return (await this.firebase.auth()).createCustomToken(webChatUid(chatId));
  }

  // The Firebase uid behind an ID token the browser sent, or null if it isn't valid.
  async verifyToken(idToken: string): Promise<string | null> {
    try {
      return (await (await this.firebase.auth()).verifyIdToken(idToken)).uid;
    } catch {
      return null;
    }
  }

  private chats() {
    return this.firebase.firestore.collection(WEB_CHAT_COLLECTION);
  }
}

function toChat(snapshot: DocumentSnapshot): WebChat {
  return {
    id: snapshot.id,
    partnerId: snapshot.get('partnerId') as string,
    reference: (snapshot.get('reference') as string | null) ?? null,
    preferredLanguage: (snapshot.get('preferredLanguage') as string | null) ?? null,
    // Chats created before agents could reply have no mode: the AI answers them.
    mode: snapshot.get('mode') === 'agent' ? 'agent' : 'ai',
    agentName: (snapshot.get('agentName') as string | null) ?? null,
    createdAt: (snapshot.get('createdAt') as Timestamp).toDate(),
  };
}

// Firestore rejects undefined fields.
const toDoc = ({ sender, text, agentName }: NewWebChatMessage) => ({
  sender,
  text,
  ...(agentName && { agentName }),
});
