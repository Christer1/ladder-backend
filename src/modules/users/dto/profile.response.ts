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
  dateOfBirth: string | null; // YYYY-MM-DD, set once a BVN or NIN is verified
  ladderId: string | null;
  status: UserStatus;
  verifications: VerificationSummary[];
}
