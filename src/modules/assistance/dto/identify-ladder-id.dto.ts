import { Transform } from 'class-transformer';
import { Matches } from 'class-validator';

// Deliberately loose: the Ladder ID format may change, so only the basic shape is checked here.
// Today's IDs look like LID-7F3A-9K2D; the lookup is case-insensitive.
export class IdentifyLadderIdDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z0-9-]{6,32}$/, {
    message: 'Ladder ID must be 6 to 32 letters, numbers or dashes.',
  })
  ladderId: string;
}
