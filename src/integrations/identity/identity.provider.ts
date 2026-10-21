// Contract every identity vendor adapter implements. Services depend on this, never on a vendor SDK.
export const IDENTITY_PROVIDER = Symbol('IDENTITY_PROVIDER');

export type IdentityFailure = 'NOT_FOUND' | 'INVALID' | 'DOB_MISMATCH';

export interface IdentityResult {
  isVerified: boolean;
  providerRef?: string;
  failure?: IdentityFailure;
}

export interface IdentityProvider {
  readonly name: string;
  // dateOfBirth is an ISO date string: YYYY-MM-DD.
  verifyBvn(bvn: string, dateOfBirth: string): Promise<IdentityResult>;
  verifyNin(nin: string, dateOfBirth: string): Promise<IdentityResult>;
}
