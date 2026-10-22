import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { WEB_CHAT_MESSAGE_MAX_LENGTH } from '../../../config/app.config';

export class SendWebChatMessageDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, WEB_CHAT_MESSAGE_MAX_LENGTH, {
    message: `Write a message of up to ${WEB_CHAT_MESSAGE_MAX_LENGTH} characters.`,
  })
  text: string;
}
