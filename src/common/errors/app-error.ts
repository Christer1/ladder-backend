import { ERROR_CODES, ErrorCode } from './error-codes';

export type FieldErrors = Record<string, string[]>;

// Extra data for the client beside the error, e.g. the WhatsApp help link on a failed identify.
export type ErrorDetails = Record<string, unknown>;

// The only error services should throw. The exception filter turns it into the error envelope.
export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    readonly fieldErrors?: FieldErrors,
    readonly details?: ErrorDetails,
  ) {
    super(ERROR_CODES[code].message);
    this.status = ERROR_CODES[code].status;
  }
}
