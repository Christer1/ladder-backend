// Contract every identity vendor adapter implements. Services depend on this, never on a vendor SDK.
export const IDENTITY_PROVIDER = Symbol('IDENTITY_PROVIDER');

export interface PersonMatch {
  email: string;
  dateOfBirth: Date;
}

export interface IdentityResult {
  isVerified: boolean;
  providerRef?: string;
  failureReason?: string;
}

export interface IdentityProvider {
  readonly name: string;
  verifyBvn(bvn: string, person: PersonMatch): Promise<IdentityResult>;
  verifyNin(nin: string, person: PersonMatch): Promise<IdentityResult>;
  verifyDocument(input: {
    idType: string;
    file: Buffer;
    mimeType: string;
  }): Promise<IdentityResult>;
  checkLiveness(input: { selfie: Buffer; mimeType: string }): Promise<IdentityResult>;
}
