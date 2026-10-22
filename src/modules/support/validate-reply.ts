// Checks an AI reply before it reaches the customer. Any problem: the AI is asked to rewrite once;
// if it still fails, a fixed reply is sent instead.

const MAX_LENGTH = 1500;
const LONG_DIGITS = /\d{8,}/;
const SECRET_REQUEST =
  /\b(send|share|give|tell|provide|type|enter|drop)\b[^.?!\n]{0,40}\b(otp|pin|password|passcode|cvv|card number|card details)\b/gi;
const NEGATION = /\b(never|don't|dont|do not|no|not|abeg no)\b[^.?!\n]{0,20}$/i;
const APPROVAL_CLAIM =
  /\b(account (is |has been )?(now )?(open|opened|approved|created|activated)|account don (open|ready)|you('ve| have) been approved|we (have )?opened)\b/i;

export function replyProblems(reply: string): string[] {
  const text = reply.trim();
  const problems: string[] = [];

  if (!text) problems.push('empty');
  if (text.length > MAX_LENGTH) problems.push('too_long');
  if (LONG_DIGITS.test(text)) problems.push('long_digit_string');

  for (const match of text.matchAll(SECRET_REQUEST)) {
    const before = text.slice(Math.max(0, match.index - 25), match.index);
    if (!NEGATION.test(before)) {
      problems.push('asks_for_secret');
      break;
    }
  }

  if (APPROVAL_CLAIM.test(text)) problems.push('claims_account_open');
  return problems;
}

// Runs of 10+ digits (BVN, NIN, account and card numbers) never reach the database or the AI.
export const maskLongNumbers = (text: string): string =>
  text.replace(/\d[\d -]{8,}\d/g, (run) =>
    run.replace(/\D/g, '').length >= 10 ? '[number removed]' : run,
  );
