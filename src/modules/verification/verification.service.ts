import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User, VerificationStatus, VerificationType } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { encrypt } from '../../common/utils/crypto';
import { last4 } from '../../common/utils/mask';
import { EnvironmentVariables } from '../../config/env.validation';
import {
  IDENTITY_PROVIDER,
  IdentityFailure,
  IdentityProvider,
  IdentityResult,
} from '../../integrations/identity/identity.provider';
import { UsersService } from '../users/users.service';
import {
  StepStatus,
  VerificationResultResponse,
  VerificationStatusResponse,
} from './dto/verification.response';
import { VerificationRepository } from './verification.repository';

const FAILURE_CODES: Record<VerificationType, Record<IdentityFailure, ErrorCode>> = {
  BVN: { NOT_FOUND: 'BVN_NOT_FOUND', INVALID: 'BVN_INVALID', DOB_MISMATCH: 'BVN_DOB_MISMATCH' },
  NIN: { NOT_FOUND: 'NIN_NOT_FOUND', INVALID: 'NIN_INVALID', DOB_MISMATCH: 'NIN_DOB_MISMATCH' },
};

@Injectable()
export class VerificationService {
  constructor(
    private readonly verificationRepository: VerificationRepository,
    private readonly usersService: UsersService,
    @Inject(IDENTITY_PROVIDER) private readonly identityProvider: IdentityProvider,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  verifyBvn(userId: string, bvn: string, dateOfBirth: string): Promise<VerificationResultResponse> {
    return this.verify(userId, VerificationType.BVN, bvn, dateOfBirth);
  }

  verifyNin(userId: string, nin: string, dateOfBirth: string): Promise<VerificationResultResponse> {
    return this.verify(userId, VerificationType.NIN, nin, dateOfBirth);
  }

  async getStatus(userId: string): Promise<VerificationStatusResponse> {
    const user = await this.usersService.findById(userId);
    const verifications = await this.verificationRepository.findAllByUser(userId);
    const statusOf = (type: VerificationType): StepStatus =>
      verifications.find((v) => v.type === type)?.status ?? 'NOT_STARTED';

    return {
      bvn: statusOf(VerificationType.BVN),
      nin: statusOf(VerificationType.NIN),
      ladderId: user.ladderId,
    };
  }

  // Every attempt is recorded (number encrypted); the first match issues the Ladder ID.
  private async verify(
    userId: string,
    type: VerificationType,
    number: string,
    dateOfBirth: string,
  ): Promise<VerificationResultResponse> {
    const user = await this.getReadyUser(userId, type);
    const result = this.matchesVerifiedDob(user, dateOfBirth)
      ? await this.lookup(type, number, dateOfBirth)
      : { isVerified: false, failure: 'DOB_MISMATCH' as const };

    const verification = await this.verificationRepository.upsert(userId, type, {
      status: result.isVerified ? VerificationStatus.VERIFIED : VerificationStatus.FAILED,
      valueEncrypted: encrypt(number, this.config.get('ENCRYPTION_KEY', { infer: true })),
      last4: last4(number),
      provider: this.identityProvider.name,
      providerRef: result.providerRef ?? null,
      failureReason: result.failure ?? null,
      verifiedAt: result.isVerified ? new Date() : null,
    });
    if (!result.isVerified) throw new AppError(FAILURE_CODES[type][result.failure ?? 'NOT_FOUND']);

    const verifiedUser = await this.usersService.completeVerification(
      userId,
      new Date(dateOfBirth),
    );
    return { status: verification.status, ladderId: verifiedUser.ladderId };
  }

  private lookup(
    type: VerificationType,
    number: string,
    dateOfBirth: string,
  ): Promise<IdentityResult> {
    return type === VerificationType.BVN
      ? this.identityProvider.verifyBvn(number, dateOfBirth)
      : this.identityProvider.verifyNin(number, dateOfBirth);
  }

  // Once one credential is verified, the second must belong to the same date of birth.
  private matchesVerifiedDob(user: User, dateOfBirth: string): boolean {
    return !user.dateOfBirth || user.dateOfBirth.toISOString().slice(0, 10) === dateOfBirth;
  }

  // The user must have created their PIN and not already have this credential verified.
  private async getReadyUser(userId: string, type: VerificationType): Promise<User> {
    const user = await this.usersService.findById(userId);
    if (!user.pinHash) throw new AppError('PIN_REQUIRED');

    const existing = await this.verificationRepository.findOne(userId, type);
    if (existing?.status === VerificationStatus.VERIFIED) throw new AppError('ALREADY_VERIFIED');
    return user;
  }
}
