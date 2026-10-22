import { AssistanceIssue, AssistanceMethod, VerificationType } from '@prisma/client';
import {
  DETAILS_UNAVAILABLE_GUIDANCE,
  issueGuidance,
  IssueGuidance,
  OfficeVisit,
  RECORD_FIXES,
} from './help-chat.knowledge';

// What the AI is told about the customer's problem (its ISSUE DATA), and the fixed reply sent when
// the AI can't answer. Shared by the WhatsApp and web chats.
export interface HelpChatContext {
  data: Record<string, unknown>;
  fallback: string;
}

type IdType = typeof VerificationType.BVN | typeof VerificationType.NIN;

const METHOD_LABELS: Record<AssistanceMethod, string> = {
  BVN: 'BVN',
  NIN: 'NIN',
  BVN_AND_NIN: 'BVN and NIN',
  LADDER_ID: 'Ladder ID',
};

export const partnerName = (partnerId: string): string =>
  partnerId.charAt(0).toUpperCase() + partnerId.slice(1);

// A failed identify, looked up by its reference.
export function issueContext(
  issue: AssistanceIssue,
  preferredLanguage: string | null,
): HelpChatContext {
  const guidance = issueGuidance(issue.reason, issue.failedType as IdType | null);
  return {
    data: {
      reference: issue.reference,
      partner: partnerName(issue.partnerId),
      checked_with: METHOD_LABELS[issue.method],
      failed_id: issue.failedType ?? 'Ladder ID',
      value_entered_ends_with: issue.maskedValue.slice(-4),
      logged_on: issue.createdAt.toISOString().slice(0, 10),
      preferred_language: preferredLanguage,
      what_went_wrong: guidance.whatWentWrong,
      how_to_fix: guidance.howToFix,
      // Where to go and what to bring if the record itself must be fixed.
      office_visit: guidance.officeVisits ? officeVisitData(guidance.officeVisits) : null,
      // For follow-up questions about changing something else on the same record.
      other_record_fixes: issue.failedType
        ? { [issue.failedType]: officeVisitData(RECORD_FIXES[issue.failedType as IdType]) }
        : null,
    },
    fallback: fixedReply(guidance, `We found your request (ref ${issue.reference}).`),
  };
}

const officeVisitData = (visits: Record<string, OfficeVisit>) =>
  Object.fromEntries(
    Object.entries(visits).map(([key, visit]) => [
      key,
      { where: visit.where, bring: visit.bring, notes: visit.notes },
    ]),
  );

// The web chat opened from the "couldn't load your details" screen, which has no reference.
export function detailsUnavailableContext(
  partnerId: string,
  preferredLanguage: string | null,
): HelpChatContext {
  const guidance = DETAILS_UNAVAILABLE_GUIDANCE;
  return {
    data: {
      partner: partnerName(partnerId),
      preferred_language: preferredLanguage,
      what_went_wrong: guidance.whatWentWrong,
      how_to_fix: guidance.howToFix,
    },
    fallback: fixedReply(guidance),
  };
}

// Sent when the AI is not configured, unavailable, or keeps breaking the rules.
function fixedReply(guidance: IssueGuidance, found?: string): string {
  const steps = guidance.howToFix.map((step, i) => `${i + 1}. ${step}`).join('\n');
  const visits = Object.entries(guidance.officeVisits ?? {}).map(
    ([id, visit]) =>
      `*If your ${id} record needs fixing,* visit ${OFFICE[id] ?? 'the office'} with:\n${visit.bring
        .map((item) => `- ${item}`)
        .join('\n')}`,
  );
  return [
    `Hi, this is Ladder.${found ? ` ${found}` : ''}`,
    `*What went wrong:* ${guidance.whatWentWrong}`,
    `*How to fix it:*\n${steps}`,
    ...visits,
    'Please never send your BVN, NIN, PIN or OTP in this chat.',
  ].join('\n\n');
}

const OFFICE: Record<string, string> = { NIN: 'an NIMC enrolment centre', BVN: 'your bank' };
