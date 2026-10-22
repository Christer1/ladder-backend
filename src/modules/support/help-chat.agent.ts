import { Injectable, Logger } from '@nestjs/common';
import { ChatMessage, GroqService, LlmUnavailableError } from '../../integrations/llm/groq.service';
import {
  buildHelpChatInput,
  HELP_CHAT_SYSTEM_PROMPTS,
  HelpChannel,
  TranscriptLine,
} from './help-chat.prompts';
import { replyProblems } from './validate-reply';

export interface HelpChatReplyInput {
  channel: HelpChannel;
  // The ISSUE DATA the AI answers from; null when Ladder doesn't know the problem yet.
  data: Record<string, unknown> | null;
  transcript: TranscriptLine[];
  text: string;
  // Sent when the AI is not configured, unavailable, or keeps breaking the rules.
  fallback: string;
}

export interface HelpChatReply {
  reply: string;
  // The language the customer chose or switched to in this message, as reported by the AI.
  preferredLanguage: string | null;
}

// Writes Ladder's help chat replies with Groq, whatever the channel. Every AI reply is checked
// (validate-reply) before it can reach the customer.
@Injectable()
export class HelpChatAgent {
  private readonly logger = new Logger(HelpChatAgent.name);

  constructor(private readonly groq: GroqService) {}

  async reply(input: HelpChatReplyInput): Promise<HelpChatReply> {
    const fallback = { reply: input.fallback, preferredLanguage: null };
    if (!this.groq.isConfigured) return fallback;

    const messages: ChatMessage[] = [
      { role: 'system', content: HELP_CHAT_SYSTEM_PROMPTS[input.channel] },
      { role: 'user', content: buildHelpChatInput(input.data, input.transcript, input.text) },
    ];
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const raw = await this.groq.complete(messages, { json: true });
        const answer = parseAiReply(raw);
        const problems = answer ? replyProblems(answer.reply) : ['not_the_requested_json'];
        if (answer && problems.length === 0) return answer;

        this.logger.warn(`AI reply rejected: ${problems.join(', ')}`);
        messages.push(
          { role: 'assistant', content: raw },
          {
            role: 'user',
            content: `That reply broke these rules: ${problems.join(', ')}. Rewrite it following every rule.`,
          },
        );
      }
    } catch (error) {
      if (!(error instanceof LlmUnavailableError)) throw error;
    }
    return fallback;
  }
}

// { "preferred_language": string | null, "reply": string }, or null if the AI sent anything else.
function parseAiReply(raw: string): HelpChatReply | null {
  try {
    const data = JSON.parse(raw) as { preferred_language?: unknown; reply?: unknown };
    if (typeof data.reply !== 'string') return null;
    const language =
      typeof data.preferred_language === 'string'
        ? data.preferred_language.trim().slice(0, 40)
        : '';
    // Both channels bold with single asterisks; models often write markdown's double ones.
    const reply = data.reply.trim().replace(/\*\*(.+?)\*\*/g, '*$1*');
    return { reply, preferredLanguage: language || null };
  } catch {
    return null;
  }
}
