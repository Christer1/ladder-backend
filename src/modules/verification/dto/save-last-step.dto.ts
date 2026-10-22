import { OnboardingStep } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class SaveLastStepDto {
  @IsEnum(OnboardingStep, { message: 'Unknown onboarding step.' })
  step: OnboardingStep;
}
