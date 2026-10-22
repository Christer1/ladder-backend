import { randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { DeliveryStatus } from '@prisma/client';
import { WhatsAppProvider, WhatsAppSendResult } from './whatsapp.provider';

// Local development and tests: logs messages instead of sending them.
@Injectable()
export class ConsoleWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'console';
  private readonly logger = new Logger(ConsoleWhatsAppProvider.name);

  sendText(to: string, body: string): Promise<WhatsAppSendResult> {
    this.logger.log(`WhatsApp → ${to}\n${body}`);
    return Promise.resolve({
      providerMessageId: `console-${randomUUID()}`,
      status: DeliveryStatus.SENT,
    });
  }
}
