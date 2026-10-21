import { Transform } from 'class-transformer';
import { IsEmail, Matches } from 'class-validator';

export class VerifyOtpDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'Enter a valid email address.' })
  email: string;

  @Matches(/^\d{6}$/, { message: 'Code must be 6 digits.' })
  code: string;
}
