import { Module } from '@nestjs/common';
import { FirebaseModule } from '../../integrations/firebase/firebase.module';
import { LlmModule } from '../../integrations/llm/llm.module';
import { WhatsAppModule } from '../../integrations/whatsapp/whatsapp.module';
import { PartnerGuard } from '../assistance/guards/partner.guard';
import { HelpChatAgent } from './help-chat.agent';
import { InfobipWebhooksController } from './infobip-webhooks.controller';
import { SupportRepository } from './support.repository';
import { SupportService } from './support.service';
import { WebChatController } from './web-chat.controller';
import { WebChatService } from './web-chat.service';
import { WebChatStore } from './web-chat.store';

// Help chat for failed assistance identifies, answered by Groq: on WhatsApp (Infobip) and in the
// web widget (Firestore).
@Module({
  imports: [WhatsAppModule, LlmModule, FirebaseModule],
  controllers: [InfobipWebhooksController, WebChatController],
  providers: [
    SupportService,
    SupportRepository,
    HelpChatAgent,
    WebChatService,
    WebChatStore,
    PartnerGuard,
  ],
  exports: [SupportService],
})
export class SupportModule {}
