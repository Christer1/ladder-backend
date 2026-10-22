import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { IdentityPerson, IdentityProvider, IdentityResult } from './identity.provider';

// No database needed; used by tests. Numbers ending in "0000" are not found, "1111" are invalid.
@Injectable()
export class MockIdentityProvider implements IdentityProvider {
  readonly name = 'mock';

  async verifyBvn(bvn: string): Promise<IdentityResult> {
    return this.check(bvn);
  }

  async verifyNin(nin: string): Promise<IdentityResult> {
    return this.check(nin);
  }

  // Every verified number belongs to the same sample person.
  async getPerson(providerRef: string): Promise<IdentityPerson | null> {
    if (!providerRef.startsWith('mock_')) return null;
    return {
      firstName: 'Ada',
      lastName: 'Okafor',
      dateOfBirth: '1990-05-17',
      gender: 'Female',
      phoneNumber: '08012345678',
      email: 'ada.okafor@example.com',
      stateOfOrigin: 'Anambra',
      stateOfResidence: 'Lagos',
      town: 'Ikeja',
      residentialAddress: '12 Allen Avenue, Ikeja',
    };
  }

  private check(value: string): IdentityResult {
    if (value.endsWith('0000')) return { isVerified: false, failure: 'NOT_FOUND' };
    if (value.endsWith('1111')) return { isVerified: false, failure: 'INVALID' };
    return { isVerified: true, providerRef: `mock_${randomUUID()}` };
  }
}
