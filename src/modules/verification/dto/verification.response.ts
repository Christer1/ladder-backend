import { VerificationStatus } from '@prisma/client';

export type StepStatus = VerificationStatus | 'NOT_STARTED';

export interface VerificationResultResponse {
  status: VerificationStatus;
  ladderId: string | null;
}

export interface VerificationStatusResponse {
  bvn: StepStatus;
  nin: StepStatus;
  ladderId: string | null;
}
