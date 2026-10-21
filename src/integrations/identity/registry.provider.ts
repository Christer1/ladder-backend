import { Injectable } from '@nestjs/common';
import { VerificationType } from '@prisma/client';
import { IdentityRecordRepository } from './identity-record.repository';
import { IdentityProvider, IdentityResult } from './identity.provider';

// Test-only provider: checks BVN/NIN against the seeded identity_records table.
@Injectable()
export class RegistryIdentityProvider implements IdentityProvider {
  readonly name = 'registry';

  constructor(private readonly records: IdentityRecordRepository) {}

  verifyBvn(bvn: string, dateOfBirth: string): Promise<IdentityResult> {
    return this.check(VerificationType.BVN, bvn, dateOfBirth);
  }

  verifyNin(nin: string, dateOfBirth: string): Promise<IdentityResult> {
    return this.check(VerificationType.NIN, nin, dateOfBirth);
  }

  private async check(
    type: VerificationType,
    number: string,
    dateOfBirth: string,
  ): Promise<IdentityResult> {
    const record = await this.records.findByNumber(type, number);
    if (!record) return { isVerified: false, failure: 'NOT_FOUND' };
    if (!record.isValid) return { isVerified: false, failure: 'INVALID', providerRef: record.id };

    // @db.Date columns come back as UTC midnight, so the ISO date part is the stored date.
    const recordDob = record.dateOfBirth.toISOString().slice(0, 10);
    if (recordDob !== dateOfBirth) {
      return { isVerified: false, failure: 'DOB_MISMATCH', providerRef: record.id };
    }
    return { isVerified: true, providerRef: record.id };
  }
}
