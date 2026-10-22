import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { PartnerId } from '../assistance/guards/assistance-request';
import { PartnerGuard } from '../assistance/guards/partner.guard';
import { SendWebChatMessageDto } from './dto/send-web-chat-message.dto';
import { StartWebChatDto } from './dto/start-web-chat.dto';
import { WebChatStartResponse } from './dto/web-chat.response';
import { WebChatService } from './web-chat.service';

const START_LIMIT = { default: { limit: 10, ttl: 60_000 } };
const MESSAGE_LIMIT = { default: { limit: 20, ttl: 60_000 } };

// The help chat widget on ladder-assistance. Public to SessionGuard, like the other assistance
// routes. Messages are read from Firestore; sending needs the Firebase ID token of the chat.
@Public()
@Controller('assistance/help-chat')
@UseGuards(PartnerGuard)
export class WebChatController {
  constructor(private readonly webChatService: WebChatService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle(START_LIMIT)
  @ResponseMessage('Chat opened.')
  start(
    @PartnerId() partnerId: string,
    @Body() dto: StartWebChatDto,
  ): Promise<WebChatStartResponse> {
    return this.webChatService.startChat(partnerId, dto.reference);
  }

  // Answered once the message is stored; Ladder's reply arrives in Firestore.
  @Post(':chatId/messages')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle(MESSAGE_LIMIT)
  @ResponseMessage('Message sent.')
  send(
    @PartnerId() partnerId: string,
    @Param('chatId') chatId: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() dto: SendWebChatMessageDto,
  ): Promise<void> {
    const idToken = authorization?.match(/^Bearer (.+)$/)?.[1] ?? '';
    return this.webChatService.sendMessage(partnerId, chatId, idToken, dto.text);
  }
}
