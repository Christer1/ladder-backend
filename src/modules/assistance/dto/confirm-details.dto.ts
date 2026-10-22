import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length } from 'class-validator';

export class ConfirmDetailsDto {
  // Only needed when the provider has no address on file.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(5, 200, { message: 'Enter your residential address (5 to 200 characters).' })
  residentialAddress?: string;
}
