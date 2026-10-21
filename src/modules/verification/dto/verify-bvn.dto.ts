import { Matches } from 'class-validator';

export class VerifyBvnDto {
  @Matches(/^\d{11}$/, { message: 'BVN must be 11 digits.' })
  bvn: string;
}
