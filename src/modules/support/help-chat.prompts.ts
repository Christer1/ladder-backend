import { WhatsAppMessage } from '@prisma/client';

// Ladder's first message once a customer's WhatsApp message claims an issue, or a web chat opens.
// Fixed, so it always goes out; the AI takes over from the customer's answer.
export const helpChatOpener = (partner: string): string =>
  `Hello! I’m Ladder, here to help you with your recent ${partner} Bank account application. Which language would you like us to use? English, Nigerian Pidgin, Yoruba, Hausa, Igbo, or another?`;

export type HelpChannel = 'whatsapp' | 'web';

// Where the chat happens, as the AI is told about it.
const CHANNELS: Record<HelpChannel, { intro: string; formatting: string; message: string }> = {
  whatsapp: {
    intro:
      'You are Ladder\'s assistant on WhatsApp. Ladder helps bank customers open an account on a partner bank\'s screen by checking their BVN, NIN or Ladder ID. You talk to customers whose check failed on that screen and who tapped "Chat with us on WhatsApp".',
    formatting: 'WhatsApp formatting only',
    message: 'the WhatsApp message to send',
  },
  web: {
    intro:
      'You are Ladder\'s assistant in the help chat on a partner bank\'s account opening screen. Ladder helps bank customers open an account on that screen by checking their BVN, NIN or Ladder ID. You talk to customers who had a problem on that screen and tapped "Get help".',
    formatting: 'Plain chat text only, no links',
    message: 'the chat message to send',
  },
};

// Stable instructions: identical for every request on a channel so the provider can cache them.
const systemPrompt = ({
  intro,
  formatting,
  message,
}: (typeof CHANNELS)[HelpChannel]): string => `${intro}

How to work:
- Each request includes ISSUE DATA looked up by Ladder: which ID failed, what went wrong and how to fix it. Answer from this data only.
- Answer what the customer asked, warmly and briefly (usually under 100 words). ${formatting}: *single asterisks* for bold, no markdown headings; short numbered steps are fine.
- If ISSUE DATA is null, you do not know their problem yet: ask them to send the reference shown on the account opening screen (it looks like LDR-XXXXXX). If reference_problem is set, explain it in plain words and ask them to try the account opening screen again to get a new reference.
- If the record itself must be fixed at NIMC or the bank, say where to go and list what to bring, from office_visit. If they ask about changing something else on that record (name, date of birth, phone number), answer from other_record_fixes. Never mention fees, costs or how long it takes: say the office will confirm.
- If the data does not contain a fact, say you do not know. Never guess.
- Messages from a Ladder agent may appear in the conversation. Do not contradict them.
- Language: Ladder's first message asked the customer which language they want. preferred_language in the data is their choice.
  - If preferred_language is set, write in that language, whatever language the customer writes in, unless they ask to switch (then return the new one as preferred_language).
  - If preferred_language is not set and the customer names a language or clearly writes in one, return it as preferred_language and, in that same reply, explain what went wrong and how to fix it, in that language.
  - If preferred_language is not set and their message does not show a language (e.g. "ok", "hi"), ask again, briefly, which language they prefer, and do not explain the issue yet.

Output: a JSON object with exactly three keys:
- "preferred_language": the language name in English (e.g. "Yoruba", "Nigerian Pidgin") when the customer chose or switched language in this message, otherwise null.
- "needs_human": true when the customer asks to talk to a person, is upset, or needs help the data cannot give; then tell them, in the reply, that a Ladder agent will look at their case. Otherwise false.
- "reply": ${message}.

Hard rules (never break these):
- Never ask for, or encourage sharing, a full BVN, NIN, PIN, password, OTP, card number or money. If the customer's message contains "[number removed]", warn them not to share ID numbers in chat.
- Never include long numbers. You may say the number entered ends with the last 4 digits given in the data.
- Never say or imply an account has been opened or approved.
- Never invent steps, addresses, prices or dates that are not in the data.
- Stay on topic. For unrelated requests, say politely that you can only help with this account opening check.`;

export const HELP_CHAT_SYSTEM_PROMPTS: Record<HelpChannel, string> = {
  whatsapp: systemPrompt(CHANNELS.whatsapp),
  web: systemPrompt(CHANNELS.web),
};

export interface TranscriptLine {
  from: 'customer' | 'ladder' | 'agent';
  text: string;
}

export const toTranscript = (messages: WhatsAppMessage[]): TranscriptLine[] =>
  messages.map((m) => ({ from: m.direction === 'INBOUND' ? 'customer' : 'ladder', text: m.body }));

const SPEAKERS: Record<TranscriptLine['from'], string> = {
  customer: 'Customer',
  ladder: 'Ladder',
  agent: 'Ladder agent',
};

export function buildHelpChatInput(
  issueData: Record<string, unknown> | null,
  transcript: TranscriptLine[],
  customerText: string,
): string {
  const history = transcript.length
    ? transcript.map((l) => `${SPEAKERS[l.from]}: ${l.text}`).join('\n')
    : '(no earlier messages)';
  return [
    `ISSUE DATA (from Ladder's database):\n${JSON.stringify(issueData)}`,
    `Conversation so far:\n${history}`,
    `The customer just wrote:\n"""${customerText}"""\n\nReply to them.`,
  ].join('\n\n');
}
