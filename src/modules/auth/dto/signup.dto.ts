import { Transform } from 'class-transformer';
import { IsDateString, IsEmail } from 'class-validator';

export class SignupDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'Enter a valid email address.' })
  email: string;

  @IsDateString({ strict: true }, { message: 'Enter a valid date (YYYY-MM-DD).' })
  dateOfBirth: string;
}
