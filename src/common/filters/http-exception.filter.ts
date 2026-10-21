import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Response } from 'express';
import { AppError } from '../errors/app-error';
import { ERROR_CODES, ErrorCode } from '../errors/error-codes';

export interface ApiErrorBody {
  success: false;
  message: string;
  code: string;
  errors?: Record<string, string[]>;
}

const STATUS_TO_CODE: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_FAILED',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
};

// Turns every thrown error into the error envelope. Never leaks raw messages or stack traces.
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.toBody(exception);
    res.status(status).json(body);
  }

  private toBody(exception: unknown): { status: number; body: ApiErrorBody } {
    if (exception instanceof AppError) {
      return {
        status: exception.status,
        body: {
          success: false,
          message: exception.message,
          code: exception.code,
          ...(exception.fieldErrors && { errors: exception.fieldErrors }),
        },
      };
    }

    if (exception instanceof ThrottlerException) {
      return this.fromCode('RATE_LIMITED');
    }

    if (exception instanceof HttpException) {
      const code = STATUS_TO_CODE[exception.getStatus()];
      if (code) return this.fromCode(code);
    }

    // Log only the error name and stack location; request bodies may hold identity data.
    this.logger.error(exception instanceof Error ? exception.stack : 'Unknown error');
    return this.fromCode('INTERNAL_ERROR');
  }

  private fromCode(code: ErrorCode): { status: number; body: ApiErrorBody } {
    const { status, message } = ERROR_CODES[code];
    return { status, body: { success: false, message, code } };
  }
}
