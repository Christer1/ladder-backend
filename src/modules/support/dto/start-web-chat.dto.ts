import { Transform } from 'class-transformer';
import { IsOptional, Matches } from 'class-validator';

export class StartWebChatDto {
  // The help reference returned with a failed identify. Left out by the "couldn't load your
  // details" screen, which has none.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^LDR-[2-9A-HJKMNP-Z]{6}$/, { message: 'Help reference looks like LDR-XXXXXX.' })
  reference?: string;
}
