import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import { EnvironmentVariables } from '../../config/env.validation';

@Injectable()
export class MailService {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    const user = config.get('SMTP_USER', { infer: true });
    const pass = config.get('SMTP_PASSWORD', { infer: true });

    this.from = config.get('MAIL_FROM', { infer: true });
    this.transporter = createTransport({
      host: config.get('SMTP_HOST', { infer: true }),
      port: config.get('SMTP_PORT', { infer: true }),
      ...(user && pass && { auth: { user, pass } }),
    });
  }

  async sendOtp(to: string, code: string, expiresInSeconds: number): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to,
      subject: 'Your Ladder verification code',
      text: `Your Ladder code is ${code}. It expires in ${expiresInSeconds} seconds. Do not share it with anyone.`,
    });
  }
}
