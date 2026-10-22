import { HttpStatus } from '@nestjs/common';

// Every error the API can return. `message` is shown to users, so keep it plain and safe.
export const ERROR_CODES = {
  VALIDATION_FAILED: { status: HttpStatus.BAD_REQUEST, message: 'Some fields are invalid.' },
  UNAUTHENTICATED: { status: HttpStatus.UNAUTHORIZED, message: 'Please sign in to continue.' },
  FORBIDDEN: { status: HttpStatus.FORBIDDEN, message: 'You cannot perform this action.' },
  NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: 'Resource not found.' },
  RATE_LIMITED: {
    status: HttpStatus.TOO_MANY_REQUESTS,
    message: 'Too many attempts. Try again shortly.',
  },
  INTERNAL_ERROR: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Something went wrong. Please try again.',
  },

  EMAIL_TAKEN: {
    status: HttpStatus.CONFLICT,
    message: 'An account with this email already exists.',
  },
  INVALID_CREDENTIALS: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Email or password is incorrect.',
  },
  EMAIL_NOT_VERIFIED: {
    status: HttpStatus.FORBIDDEN,
    message: 'Verify your email to continue.',
  },
  OTP_INVALID: { status: HttpStatus.BAD_REQUEST, message: 'The code you entered is incorrect.' },
  OTP_EXPIRED: {
    status: HttpStatus.BAD_REQUEST,
    message: 'This code has expired. Request a new one.',
  },
  OTP_LOCKED: {
    status: HttpStatus.TOO_MANY_REQUESTS,
    message: 'Too many wrong attempts. Request a new code.',
  },
  OTP_RESEND_TOO_SOON: {
    status: HttpStatus.TOO_MANY_REQUESTS,
    message: 'Please wait before requesting a new code.',
  },
  PASSWORD_MISMATCH: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Passwords do not match.',
  },

  ALREADY_VERIFIED: {
    status: HttpStatus.CONFLICT,
    message: 'This credential is already verified.',
  },
  BVN_NOT_FOUND: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'We could not find this BVN.',
  },
  BVN_INVALID: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'This BVN is not valid.',
  },
  BVN_DOB_MISMATCH: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'The date of birth does not match this BVN.',
  },
  NIN_NOT_FOUND: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'We could not find this NIN.',
  },
  NIN_INVALID: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'This NIN is not valid.',
  },
  NIN_DOB_MISMATCH: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'The date of birth does not match this NIN.',
  },
  IDENTITY_REQUIRED: {
    status: HttpStatus.CONFLICT,
    message: 'Verify your BVN, NIN or Government ID first.',
  },
  FILE_REQUIRED: { status: HttpStatus.BAD_REQUEST, message: 'Add the required photo.' },
  FILE_TYPE_INVALID: {
    status: HttpStatus.BAD_REQUEST,
    message: 'This file type is not supported.',
  },
  FILE_TOO_LARGE: {
    status: HttpStatus.PAYLOAD_TOO_LARGE,
    message: 'The file must be 5 MB or smaller.',
  },

  // ladder-assistance. Wrong numbers and wrong dates of birth share one answer, so a partner screen
  // can't be used to discover which BVNs, NINs or Ladder IDs exist.
  INFORMATION_MISMATCH: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Information mismatch. The details you entered don’t match our records.',
  },
  LADDER_ID_NOT_FOUND: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'We couldn’t verify this Ladder ID. Check it and try again.',
  },
  LIVENESS_REQUIRED: {
    status: HttpStatus.FORBIDDEN,
    message: 'Complete the liveness check first.',
  },
  ASSISTANCE_SESSION_EXPIRED: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Your session has expired. Please start again.',
  },
  PARTNER_NOT_ALLOWED: {
    status: HttpStatus.FORBIDDEN,
    message: 'This partner is not set up for account opening.',
  },
  EMAIL_SEND_FAILED: {
    status: HttpStatus.BAD_GATEWAY,
    message: 'We could not send the email. Please try again.',
  },
  WHATSAPP_SEND_FAILED: {
    status: HttpStatus.BAD_GATEWAY,
    message: 'We could not send the WhatsApp message.',
  },

  // Web help chat (Firestore).
  HELP_REFERENCE_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: 'We couldn’t find this help request. Please try again on the account opening screen.',
  },
  HELP_REFERENCE_EXPIRED: {
    status: HttpStatus.GONE,
    message: 'This help request has expired. Please try again on the account opening screen.',
  },
  HELP_CHAT_SESSION_INVALID: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'This chat has ended. Tap Get help to open it again.',
  },
  HELP_CHAT_NOT_STARTED: {
    status: HttpStatus.CONFLICT,
    message: 'The customer has not opened the help chat yet.',
  },

  // ladder-agent-dashboard.
  CASE_NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: 'This case was not found.' },
  CASE_RESOLVED: { status: HttpStatus.CONFLICT, message: 'This case is already resolved.' },
  CASE_NOT_ESCALATABLE: {
    status: HttpStatus.CONFLICT,
    message: 'Only open cases can be escalated.',
  },
  HELP_CHAT_UNAVAILABLE: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'Chat is not available right now. Please try again later.',
  },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;
