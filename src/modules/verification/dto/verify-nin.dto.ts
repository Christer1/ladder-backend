import { Matches } from 'class-validator';

export class VerifyNinDto {
  @Matches(/^\d{11}$/, { message: 'NIN must be 11 digits.' })
  nin: string;
}
