import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class SignupDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'Enter a valid email address.' })
  email: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  @MaxLength(128, { message: 'Password must be at most 128 characters.' })
  @Matches(/(?=.*[A-Za-z])(?=.*\d)/, { message: 'Password must contain a letter and a number.' })
  password: string;

  // Checked against `password` in AuthService.signup (PASSWORD_MISMATCH).
  @IsString()
  @MaxLength(128)
  confirmPassword: string;
}
