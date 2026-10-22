import { IsDateString, Matches } from 'class-validator';

export class IdentifyBvnAndNinDto {
  @Matches(/^\d{11}$/, { message: 'BVN must be 11 digits.' })
  bvn: string;

  @Matches(/^\d{11}$/, { message: 'NIN must be 11 digits.' })
  nin: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Enter a valid date (YYYY-MM-DD).' })
  @IsDateString({ strict: true }, { message: 'Enter a valid date (YYYY-MM-DD).' })
  dateOfBirth: string;
}
