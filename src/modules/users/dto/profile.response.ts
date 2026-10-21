import { UserStatus, VerificationStatus, VerificationType } from '@prisma/client';

export interface VerificationSummary {
  type: VerificationType;
  status: VerificationStatus;
  maskedValue: string | null;
  verifiedAt: string | null;
}

export interface ProfileResponse {
  id: string;
  email: string;
  dateOfBirth: string; // YYYY-MM-DD
  ladderId: string | null;
  status: UserStatus;
  verifications: VerificationSummary[];
}
