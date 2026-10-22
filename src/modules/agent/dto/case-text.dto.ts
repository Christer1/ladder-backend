import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { AGENT_NOTE_MAX_LENGTH, WEB_CHAT_MESSAGE_MAX_LENGTH } from '../../../config/app.config';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class AddCaseNoteDto {
  @Transform(trim)
  @IsString()
  @Length(1, AGENT_NOTE_MAX_LENGTH, {
    message: `Write a note of up to ${AGENT_NOTE_MAX_LENGTH} characters.`,
  })
  text: string;
}

export class SendCaseMessageDto {
  @Transform(trim)
  @IsString()
  @Length(1, WEB_CHAT_MESSAGE_MAX_LENGTH, {
    message: `Write a message of up to ${WEB_CHAT_MESSAGE_MAX_LENGTH} characters.`,
  })
  text: string;
}
