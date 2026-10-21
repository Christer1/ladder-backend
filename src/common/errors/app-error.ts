import { ERROR_CODES, ErrorCode } from './error-codes';

export type FieldErrors = Record<string, string[]>;

// The only error services should throw. The exception filter turns it into the error envelope.
export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    readonly fieldErrors?: FieldErrors,
  ) {
    super(ERROR_CODES[code].message);
    this.status = ERROR_CODES[code].status;
  }
}
