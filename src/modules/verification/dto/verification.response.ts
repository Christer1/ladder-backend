import { OnboardingStep, VerificationStatus } from '@prisma/client';

export type StepStatus = VerificationStatus | 'NOT_STARTED';

export interface VerificationResultResponse {
  status: VerificationStatus;
  ladderId: string | null;
}

export interface VerificationStatusResponse {
  bvn: StepStatus;
  nin: StepStatus;
  governmentId: StepStatus;
  liveness: StepStatus;
  ladderId: string | null;
  /** The onboarding page the user was last on (null until they open one). */
  lastStep: OnboardingStep | null;
}
