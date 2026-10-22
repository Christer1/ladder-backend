export const API_PREFIX = 'api/v1';

export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 10 * 60;
export const OTP_RESEND_COOLDOWN_SECONDS = 45; // the 00:45 timer on the OTP screen
export const OTP_MAX_ATTEMPTS = 5;

// ladder-assistance: one customer's identify → liveness → details visit.
export const ASSISTANCE_SESSION_TTL_MINUTES = 30;
export const PARTNER_ID_HEADER = 'x-partner-id';

// WhatsApp help chat for failed identifies. An unclaimed reference expires after a day; a claimed
// one keeps the chat going for a week. Free-form replies only work within WhatsApp's 24-hour window.
export const HELP_REFERENCE_TTL_HOURS = 24;
export const HELP_CHAT_TTL_DAYS = 7;
export const HELP_TRANSCRIPT_MESSAGES = 12;

// Web help chat (Firestore). A chat for a reference can be reopened for HELP_CHAT_TTL_DAYS.
export const WEB_CHAT_COLLECTION = 'helpChats';
export const WEB_CHAT_MESSAGE_MAX_LENGTH = 1000;

// Government ID and liveness uploads. Files are checked, then discarded: no document storage or
// provider check exists yet (AIUsage.md §5).
export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const ID_FILE_TYPES = ['image/png', 'image/jpeg', 'application/pdf'] as const;
export const SELFIE_FILE_TYPES = ['image/jpeg', 'image/png'] as const;

// Which images each ID type needs. Passports only have a photo page (sent as "front").
export const GOVERNMENT_ID_SIDES = {
  'national-id-card': ['front', 'back'],
  'international-passport': ['front'],
  'drivers-licence': ['front', 'back'],
  'voters-card': ['front', 'back'],
} as const;
export type GovernmentIdType = keyof typeof GOVERNMENT_ID_SIDES;
