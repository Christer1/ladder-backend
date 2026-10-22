import { AssistanceIssueReason, VerificationType } from '@prisma/client';

// What went wrong and how to fix it, per failure. The AI answers only from this, so every fact
// a customer is told about fixing a record lives here.

export interface IssueGuidance {
  whatWentWrong: string;
  howToFix: string[];
}

type IdType = typeof VerificationType.BVN | typeof VerificationType.NIN;

const ID_FACTS: Record<IdType, { name: string; retrieve: string; correctAt: string }> = {
  BVN: {
    name: 'BVN',
    retrieve: 'Dial *565*0# from the phone number linked to the BVN to see it.',
    correctAt: 'their bank (any branch of the bank where the BVN was registered)',
  },
  NIN: {
    name: 'NIN',
    retrieve: 'Dial *346# from the phone number registered with NIMC to see the NIN.',
    correctAt: 'an NIMC enrolment centre',
  },
};

const RETRY = 'Then go back to the account opening screen and try again.';

// The web chat opened from the "couldn't load your details" screen: the check passed, so there is
// no failed ID to explain.
export const DETAILS_UNAVAILABLE_GUIDANCE: IssueGuidance = {
  whatWentWrong:
    'The customer’s check passed, but Ladder could not load their details on the next screen. This is usually a temporary problem on Ladder’s side, not a problem with their BVN, NIN or Ladder ID.',
  howToFix: [
    'Tap "Try again" on the screen.',
    'If it still fails, wait a few minutes, then start again from the account opening screen.',
  ],
};

export function issueGuidance(
  reason: AssistanceIssueReason,
  failedType: IdType | null,
): IssueGuidance {
  const id = ID_FACTS[failedType ?? VerificationType.BVN];

  switch (reason) {
    case AssistanceIssueReason.NOT_FOUND:
      return {
        whatWentWrong: `No ${id.name} matches the number that was entered.`,
        howToFix: [`Check all 11 digits of the ${id.name}.`, id.retrieve, RETRY],
      };
    case AssistanceIssueReason.INVALID:
      return {
        whatWentWrong: `The ${id.name} exists but is not currently valid, so it cannot be used to open an account.`,
        howToFix: [`Visit ${id.correctAt} to find out why and have it fixed.`, RETRY],
      };
    case AssistanceIssueReason.DOB_MISMATCH:
      return {
        whatWentWrong: `The date of birth entered does not match the date of birth on the ${id.name} record.`,
        howToFix: [
          'Check the date of birth entered: day, month and year.',
          `If the date on the ${id.name} record itself is wrong, it must be corrected at ${id.correctAt} first.`,
          RETRY,
        ],
      };
    case AssistanceIssueReason.DIFFERENT_PEOPLE:
      return {
        whatWentWrong:
          'The BVN and the NIN each matched the date of birth, but the names on the two records are different, so they look like two different people.',
        howToFix: [
          'Make sure both numbers are the customer’s own.',
          `If the name is spelt differently on the two records, correct it at ${ID_FACTS.BVN.correctAt} (BVN) or ${ID_FACTS.NIN.correctAt} (NIN).`,
          'Or use only the BVN, or only the NIN, on the account opening screen.',
        ],
      };
    case AssistanceIssueReason.LADDER_ID_UNKNOWN:
      return {
        whatWentWrong: 'No Ladder account has the Ladder ID that was entered.',
        howToFix: [
          'Check the Ladder ID. It looks like LID-XXXX-XXXX and is shown in the Ladder app after verification.',
          'Or use a BVN or NIN on the account opening screen instead.',
          RETRY,
        ],
      };
    case AssistanceIssueReason.LADDER_ID_NOT_VERIFIED:
      return {
        whatWentWrong:
          'The Ladder ID exists, but its owner has not finished verifying a BVN or NIN in Ladder yet.',
        howToFix: [
          'Open the Ladder app and complete BVN or NIN verification.',
          'Or use a BVN or NIN on the account opening screen instead.',
          RETRY,
        ],
      };
  }
}
