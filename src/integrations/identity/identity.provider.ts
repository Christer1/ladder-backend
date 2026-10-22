// Contract every identity vendor adapter implements. Services depend on this, never on a vendor SDK.
export const IDENTITY_PROVIDER = Symbol('IDENTITY_PROVIDER');

export type IdentityFailure = 'NOT_FOUND' | 'INVALID' | 'DOB_MISMATCH';

export interface IdentityResult {
  isVerified: boolean;
  providerRef?: string;
  failure?: IdentityFailure;
}

// The profile a provider holds for a verified BVN/NIN. Only shown after liveness.
export interface IdentityPerson {
  firstName: string;
  lastName: string;
  dateOfBirth: string; // YYYY-MM-DD
  gender: string | null;
  phoneNumber: string | null;
  email: string | null;
  stateOfOrigin: string | null;
  stateOfResidence: string | null;
  town: string | null;
  residentialAddress: string | null;
}

export interface IdentityProvider {
  readonly name: string;
  // dateOfBirth is an ISO date string: YYYY-MM-DD.
  verifyBvn(bvn: string, dateOfBirth: string): Promise<IdentityResult>;
  verifyNin(nin: string, dateOfBirth: string): Promise<IdentityResult>;
  // Looks up the person behind a providerRef returned by a successful verify.
  getPerson(providerRef: string): Promise<IdentityPerson | null>;
}
