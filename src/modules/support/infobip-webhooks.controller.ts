import { Body, Controller, HttpCode, HttpStatus, Logger, Post, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { AppError } from '../../common/errors/app-error';
import { safeEqual } from '../../common/utils/crypto';
import { EnvironmentVariables } from '../../config/env.validation';
import {
  InfobipInbound,
  parseInbound,
  parseReports,
} from '../../integrations/whatsapp/infobip.mapping';
import { SupportService } from './support.service';

// Infobip calls these. It does not sign webhooks, so the URLs carry ?token=INFOBIP_WEBHOOK_TOKEN.
// Public to SessionGuard and not rate limited: Infobip sends from a few shared addresses.
@Public()
@SkipThrottle()
@Controller('webhooks/infobip')
export class InfobipWebhooksController {
  private readonly logger = new Logger(InfobipWebhooksController.name);

  constructor(
    private readonly supportService: SupportService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  // Customer messages. Answered at once and handled afterwards, so a slow AI reply never makes
  // Infobip retry the webhook.
  @Post('inbound')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Received.')
  receiveInbound(@Query('token') token: unknown, @Body() body: unknown): { received: number } {
    this.checkToken(token);
    const messages = parseInbound(body);
    if (messages.length === 0) {
      // Names only, never content: shows which payload shape the forwarding setup sends.
      const keys = body && typeof body === 'object' ? Object.keys(body).join(', ') : typeof body;
      this.logger.warn(`Inbound webhook had no readable messages (top-level keys: ${keys})`);
    }
    void this.handleInOrder(messages);
    return { received: messages.length };
  }

  // Delivery and seen reports for the replies Ladder sent.
  @Post('reports')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Processed.')
  async receiveReports(
    @Query('token') token: unknown,
    @Body() body: unknown,
  ): Promise<{ processed: number }> {
    this.checkToken(token);
    const reports = parseReports(body);
    await this.supportService.handleReports(reports);
    return { processed: reports.length };
  }

  private async handleInOrder(messages: InfobipInbound[]): Promise<void> {
    for (const message of messages) {
      await this.supportService
        .handleInbound(message)
        .catch((error: Error) => this.logger.error(`Inbound message failed: ${error.stack}`));
    }
  }

  private checkToken(token: unknown): void {
    const expected = this.config.get('INFOBIP_WEBHOOK_TOKEN', { infer: true });
    if (!expected || typeof token !== 'string' || !safeEqual(token, expected)) {
      throw new AppError('FORBIDDEN');
    }
  }
}
