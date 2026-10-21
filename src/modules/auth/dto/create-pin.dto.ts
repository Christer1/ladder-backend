import { Matches } from 'class-validator';

export class CreatePinDto {
  @Matches(/^\d{6}$/, { message: 'PIN must be 6 digits.' })
  pin: string;

  @Matches(/^\d{6}$/, { message: 'PIN must be 6 digits.' })
  confirmPin: string;
}
