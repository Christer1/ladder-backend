import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../../common/errors/app-error';
import { EnvironmentVariables } from '../../config/env.validation';
import { otpEmail } from './templates/otp.template';

const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';
const REQUEST_TIMEOUT_MS = 10_000;

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

// Sends transactional email through the Brevo API.
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly apiKey: string;
  private readonly sender: { email: string; name: string };

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.apiKey = config.get('BREVO_API_KEY', { infer: true });
    this.sender = {
      email: config.get('EMAIL_FROM', { infer: true }),
      name: config.get('EMAIL_FROM_NAME', { infer: true }),
    };
  }

  sendOtp(to: string, code: string, expiresInSeconds: number): Promise<void> {
    return this.send({ to, ...otpEmail(code, expiresInSeconds) });
  }

  private async send(message: EmailMessage): Promise<void> {
    let response: Response;
    try {
      response = await fetch(BREVO_SEND_URL, {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender: this.sender,
          to: [{ email: message.to }],
          subject: message.subject,
          htmlContent: message.html,
          textContent: message.text,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.error(`Brevo request failed: ${(error as Error).name}`);
      throw new AppError('EMAIL_SEND_FAILED');
    }

    if (!response.ok) {
      // Brevo's error body names the problem (e.g. unauthorized sender) and contains no user data.
      this.logger.error(`Brevo rejected email: ${response.status} ${await response.text()}`);
      throw new AppError('EMAIL_SEND_FAILED');
    }
  }
}
