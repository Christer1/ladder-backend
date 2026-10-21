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
  PIN_ALREADY_SET: { status: HttpStatus.CONFLICT, message: 'Your PIN has already been created.' },
  PIN_MISMATCH: { status: HttpStatus.BAD_REQUEST, message: 'PINs do not match.' },
  PIN_REQUIRED: { status: HttpStatus.FORBIDDEN, message: 'Create your PIN first.' },

  ALREADY_VERIFIED: {
    status: HttpStatus.CONFLICT,
    message: 'This credential is already verified.',
  },
  BVN_MISMATCH: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'We could not verify this BVN.',
  },
  NIN_MISMATCH: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'We could not verify this NIN.',
  },
  DOCUMENT_REJECTED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'We could not verify this document.',
  },
  FILE_REQUIRED: { status: HttpStatus.BAD_REQUEST, message: 'Please attach a file.' },
  FILE_TYPE_INVALID: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Only PNG, JPG or PDF files are allowed.',
  },
  FILE_TOO_LARGE: { status: HttpStatus.BAD_REQUEST, message: 'File must be 5 MB or smaller.' },
  CREDENTIAL_REQUIRED: {
    status: HttpStatus.FORBIDDEN,
    message: 'Verify a BVN, NIN or Government ID first.',
  },
  LIVENESS_FAILED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Liveness check failed. Please try again.',
  },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;
