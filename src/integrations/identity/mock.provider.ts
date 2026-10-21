import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { IdentityProvider, IdentityResult } from './identity.provider';

// Development/test only (blocked in production by env validation).
// Numbers ending in "0000" fail so error states can be exercised.
@Injectable()
export class MockIdentityProvider implements IdentityProvider {
  readonly name = 'mock';

  async verifyBvn(bvn: string): Promise<IdentityResult> {
    return this.resultFor(!bvn.endsWith('0000'), 'BVN not found');
  }

  async verifyNin(nin: string): Promise<IdentityResult> {
    return this.resultFor(!nin.endsWith('0000'), 'NIN not found');
  }

  async verifyDocument(): Promise<IdentityResult> {
    return this.resultFor(true);
  }

  async checkLiveness(): Promise<IdentityResult> {
    return this.resultFor(true);
  }

  private resultFor(isVerified: boolean, failureReason?: string): IdentityResult {
    return isVerified
      ? { isVerified, providerRef: `mock_${randomUUID()}` }
      : { isVerified, failureReason };
  }
}
