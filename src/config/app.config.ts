export const API_PREFIX = 'api/v1';

export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 10 * 60;
export const OTP_RESEND_COOLDOWN_SECONDS = 45; // the 00:45 timer on the OTP screen
export const OTP_MAX_ATTEMPTS = 5;

// ladder-assistance: one customer's identify → liveness → details visit.
export const ASSISTANCE_SESSION_TTL_MINUTES = 30;
export const PARTNER_ID_HEADER = 'x-partner-id';

// Government ID and liveness uploads. Files are checked, then discarded: no document storage or
// provider check exists yet (architeture.md §5).
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
