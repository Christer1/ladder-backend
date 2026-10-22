import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeliveryStatus } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { API_PREFIX } from '../../config/app.config';
import { EnvironmentVariables } from '../../config/env.validation';
import { mapInfobipStatus, toInfobipNumber } from './infobip.mapping';
import { WhatsAppProvider, WhatsAppSendResult } from './whatsapp.provider';

const SEND_PATH = '/whatsapp/1/message/text';
const REQUEST_TIMEOUT_MS = 15_000;

// Infobip WhatsApp over their REST API. Auth: "Authorization: App <API key>" against the
// account's own base URL.
@Injectable()
export class InfobipWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'infobip';
  private readonly logger = new Logger(InfobipWhatsAppProvider.name);

  constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {}

  async sendText(to: string, body: string): Promise<WhatsAppSendResult> {
    const notifyUrl = this.reportUrl();
    const data = (await this.post(SEND_PATH, {
      from: this.config.get('INFOBIP_WHATSAPP_SENDER', { infer: true }),
      to: toInfobipNumber(to),
      content: { text: body },
      ...(notifyUrl && { notifyUrl }),
    })) as { messageId?: string; status?: { groupName?: string; name?: string } } | null;

    if (!data?.messageId) {
      this.logger.error('Infobip returned no messageId');
      throw new AppError('WHATSAPP_SEND_FAILED');
    }
    const status = mapInfobipStatus(data.status?.groupName);
    if (status === DeliveryStatus.FAILED) {
      this.logger.error(`Infobip rejected the message: ${data.status?.name ?? 'unknown'}`);
      throw new AppError('WHATSAPP_SEND_FAILED');
    }
    return { providerMessageId: data.messageId, status };
  }

  // Infobip cannot reach localhost, so reports are only requested from a public URL.
  private reportUrl(): string | undefined {
    const base = this.config.get('PUBLIC_BASE_URL', { infer: true });
    const token = this.config.get('INFOBIP_WEBHOOK_TOKEN', { infer: true });
    if (!base || !token || /localhost|127\.0\.0\.1/.test(base)) return undefined;
    return `${base}/${API_PREFIX}/webhooks/infobip/reports?token=${encodeURIComponent(token)}`;
  }

  private async post(path: string, payload: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${this.config.get('INFOBIP_BASE_URL', { infer: true })}${path}`, {
        method: 'POST',
        headers: {
          authorization: `App ${this.config.get('INFOBIP_API_KEY', { infer: true })}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.error(`Infobip request failed: ${(error as Error).name}`);
      throw new AppError('WHATSAPP_SEND_FAILED');
    }

    const text = await response.text();
    if (!response.ok) {
      // Infobip's error body names the problem (e.g. outside the 24-hour window), no message text.
      this.logger.error(`Infobip rejected the request: ${response.status} ${text}`);
      throw new AppError('WHATSAPP_SEND_FAILED');
    }
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  }
}
