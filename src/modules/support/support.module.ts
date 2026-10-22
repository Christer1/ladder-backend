import { Module } from '@nestjs/common';
import { LlmModule } from '../../integrations/llm/llm.module';
import { WhatsAppModule } from '../../integrations/whatsapp/whatsapp.module';
import { InfobipWebhooksController } from './infobip-webhooks.controller';
import { SupportRepository } from './support.repository';
import { SupportService } from './support.service';

// WhatsApp help chat for failed assistance identifies (Infobip + Groq).
@Module({
  imports: [WhatsAppModule, LlmModule],
  controllers: [InfobipWebhooksController],
  providers: [SupportService, SupportRepository],
  exports: [SupportService],
})
export class SupportModule {}
