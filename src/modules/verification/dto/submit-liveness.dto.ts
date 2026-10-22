import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional } from 'class-validator';

export const LIVENESS_CHALLENGES = ['blink', 'smile', 'turnLeft', 'turnRight'] as const;
export type LivenessChallenge = (typeof LIVENESS_CHALLENGES)[number];

// Text part of the multipart upload; the photo arrives as a file named "selfie".
export class SubmitLivenessDto {
  // Sent as a JSON array string, e.g. '["smile","turnLeft","blink"]'.
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  })
  @IsArray({ message: 'Challenges must be a list.' })
  @ArrayMaxSize(LIVENESS_CHALLENGES.length)
  @IsIn(LIVENESS_CHALLENGES, { each: true, message: 'Unknown liveness challenge.' })
  challenges?: LivenessChallenge[];
}
