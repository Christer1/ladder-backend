import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../../config/env.validation';

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
// Below Infobip's patience, so a slow model never holds up the WhatsApp reply for long.
const REQUEST_TIMEOUT_MS = 20_000;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// Thrown for any Groq problem: callers fall back to a fixed reply.
export class LlmUnavailableError extends Error {}

// Groq's OpenAI-compatible chat API. Writes the WhatsApp help replies.
@Injectable()
export class GroqService {
  private readonly logger = new Logger(GroqService.name);

  constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {}

  get isConfigured(): boolean {
    return Boolean(this.config.get('GROQ_API_KEY', { infer: true }));
  }

  async complete(messages: ChatMessage[]): Promise<string> {
    if (!this.isConfigured) throw new LlmUnavailableError('GROQ_API_KEY is not set');

    let response: Response;
    try {
      response = await fetch(GROQ_CHAT_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.get('GROQ_API_KEY', { infer: true })}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.get('GROQ_MODEL', { infer: true }),
          temperature: 0.3,
          messages,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.error(`Groq request failed: ${(error as Error).name}`);
      throw new LlmUnavailableError('Groq unreachable');
    }

    if (!response.ok) {
      // Groq's error body names the problem (rate limit, bad key) and echoes no prompt text.
      this.logger.error(`Groq rejected the request: ${response.status} ${await response.text()}`);
      throw new LlmUnavailableError(`Groq ${response.status}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new LlmUnavailableError('Groq returned no text');
    return text;
  }
}
