import { AssistanceIssueReason, VerificationType } from '@prisma/client';

// What went wrong and how to fix it, per failure. The AI answers only from this, so every fact
// a customer is told about fixing a record lives here.
//
// REVIEW: the office visit facts (RECORD_FIXES) were drafted from public NIMC and CBN/bank guidance
// on 2026-10-22 and must be confirmed with NIMC and the partner bank before production. Fees and
// processing times are left out on purpose: they change, and the AI must never guess them.

// A change to an ID record that the customer has to make in person.
export interface OfficeVisit {
  where: string;
  bring: string[];
  notes: string[];
}

export interface IssueGuidance {
  whatWentWrong: string;
  howToFix: string[];
  // Where to go and what to bring when the record itself must be fixed.
  officeVisits?: Record<string, OfficeVisit>;
}

type IdType = typeof VerificationType.BVN | typeof VerificationType.NIN;

export type RecordFix = 'date_of_birth' | 'name' | 'phone_number' | 'record_status';

const NO_FEES = 'The office will confirm any fee and how long the change takes.';

const NIMC = 'Any NIMC enrolment centre, or a NIMC-licensed enrolment partner.';
const BANK =
  'A branch of their bank, ideally the bank where the BVN was registered. Any bank where they have an account can usually help.';

// Per ID and per kind of change: where to go and what to bring.
export const RECORD_FIXES: Record<IdType, Record<RecordFix, OfficeVisit>> = {
  NIN: {
    date_of_birth: {
      where: NIMC,
      bring: [
        'NIN slip or NIN',
        'A valid photo ID (international passport, driver’s licence or voter’s card)',
        'Birth certificate, or a sworn declaration of age if there is no birth certificate',
        'The phone with the number registered with NIMC',
      ],
      notes: ['NIMC allows the date of birth on a NIN to be changed only once.', NO_FEES],
    },
    name: {
      where: NIMC,
      bring: [
        'NIN slip or NIN',
        'A valid photo ID',
        'A sworn affidavit for the change or correction of name',
        'A newspaper publication of the change of name',
        'Marriage certificate, if changing to a married name',
      ],
      notes: ['NIMC will say which of these documents the change needs.', NO_FEES],
    },
    phone_number: {
      where: NIMC,
      bring: ['NIN slip or NIN', 'A valid photo ID', 'The phone with the new number'],
      notes: [NO_FEES],
    },
    record_status: {
      where: NIMC,
      bring: ['NIN slip, or the enrolment slip from registration', 'A valid photo ID'],
      notes: ['Ask NIMC to check the status of the NIN record and why it cannot be used.'],
    },
  },
  BVN: {
    date_of_birth: {
      where: BANK,
      bring: [
        'BVN',
        'NIN: banks check BVN details against the NIN',
        'A valid photo ID',
        'Birth certificate, or a sworn declaration of age',
      ],
      notes: [
        'The bank gives them a BVN update form to fill at the branch.',
        'If the date of birth on their NIN is also wrong, fix the NIN at NIMC first.',
        NO_FEES,
      ],
    },
    name: {
      where: BANK,
      bring: [
        'BVN',
        'NIN',
        'A valid photo ID',
        'A sworn affidavit for the change or correction of name',
        'A newspaper publication of the change of name',
        'Marriage certificate, if changing to a married name',
      ],
      notes: [
        'The bank gives them a BVN update form to fill at the branch.',
        'The name on the BVN should match the name on the NIN.',
        NO_FEES,
      ],
    },
    phone_number: {
      where: BANK,
      bring: ['BVN', 'A valid photo ID', 'The phone with the new number'],
      notes: ['The bank gives them a BVN update form to fill at the branch.'],
    },
    record_status: {
      where: BANK,
      bring: ['BVN', 'A valid photo ID'],
      notes: ['Ask the bank why the BVN cannot be used. It may be restricted or flagged.'],
    },
  },
};

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
  const type = failedType ?? VerificationType.BVN;
  const id = ID_FACTS[type];

  switch (reason) {
    case AssistanceIssueReason.NOT_FOUND:
      return {
        whatWentWrong: `No ${id.name} matches the number that was entered.`,
        howToFix: [
          `Check all 11 digits of the ${id.name}.`,
          id.retrieve,
          RETRY,
          `If the number is right and it still fails, visit ${id.correctAt} to check the record.`,
        ],
        officeVisits: { [id.name]: RECORD_FIXES[type].record_status },
      };
    case AssistanceIssueReason.INVALID:
      return {
        whatWentWrong: `The ${id.name} exists but is not currently valid, so it cannot be used to open an account.`,
        howToFix: [`Visit ${id.correctAt} to find out why and have it fixed.`, RETRY],
        officeVisits: { [id.name]: RECORD_FIXES[type].record_status },
      };
    case AssistanceIssueReason.DOB_MISMATCH:
      return {
        whatWentWrong: `The date of birth entered does not match the date of birth on the ${id.name} record.`,
        howToFix: [
          'Check the date of birth entered: day, month and year.',
          `If the date on the ${id.name} record itself is wrong, it must be corrected at ${id.correctAt} first.`,
          RETRY,
        ],
        officeVisits: { [id.name]: RECORD_FIXES[type].date_of_birth },
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
        officeVisits: { BVN: RECORD_FIXES.BVN.name, NIN: RECORD_FIXES.NIN.name },
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
