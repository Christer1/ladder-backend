import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnboardingStep, User, VerificationStatus, VerificationType } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { encrypt } from '../../common/utils/crypto';
import { last4 } from '../../common/utils/mask';
import {
  GOVERNMENT_ID_SIDES,
  GovernmentIdType,
  ID_FILE_TYPES,
  SELFIE_FILE_TYPES,
} from '../../config/app.config';
import { EnvironmentVariables } from '../../config/env.validation';
import {
  IDENTITY_PROVIDER,
  IdentityFailure,
  IdentityProvider,
  IdentityResult,
} from '../../integrations/identity/identity.provider';
import { UsersService } from '../users/users.service';
import { LivenessChallenge } from './dto/submit-liveness.dto';
import {
  StepStatus,
  VerificationResultResponse,
  VerificationStatusResponse,
} from './dto/verification.response';
import { VerificationRepository } from './verification.repository';

// What the service needs from an uploaded file (a Multer file satisfies this).
export interface UploadedImage {
  mimetype: string;
  size: number;
}

type IdNumberType = typeof VerificationType.BVN | typeof VerificationType.NIN;

const FAILURE_CODES: Record<IdNumberType, Record<IdentityFailure, ErrorCode>> = {
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
      governmentId: statusOf(VerificationType.GOVERNMENT_ID),
      liveness: statusOf(VerificationType.LIVENESS),
      ladderId: user.ladderId,
      lastStep: user.lastOnboardingStep,
    };
  }

  // Remembers which onboarding page the user is on, so signing back in (on any device) returns
  // them there. ladder-web decides when it applies: users with a Ladder ID go to their profile.
  async saveLastStep(userId: string, step: OnboardingStep): Promise<void> {
    await this.usersService.setLastOnboardingStep(userId, step);
  }

  // PLACEHOLDER: checks that the right images arrived (sides, type, size via Multer) and records the
  // step as verified. The files are discarded: there is no document storage or review yet.
  async uploadGovernmentId(
    userId: string,
    idType: GovernmentIdType,
    files: Partial<Record<'front' | 'back', UploadedImage>>,
  ): Promise<VerificationResultResponse> {
    await this.assertNotVerified(userId, VerificationType.GOVERNMENT_ID);

    const missing: Record<string, string[]> = {};
    const wrongType: Record<string, string[]> = {};
    for (const side of GOVERNMENT_ID_SIDES[idType]) {
      const file = files[side];
      if (!file) missing[side] = [`Add a photo of the ${side} of your ID.`];
      else if (!isOneOf(file.mimetype, ID_FILE_TYPES))
        wrongType[side] = ['Use a PNG, JPG or PDF file.'];
    }
    if (Object.keys(missing).length) throw new AppError('FILE_REQUIRED', missing);
    if (Object.keys(wrongType).length) throw new AppError('FILE_TYPE_INVALID', wrongType);

    const verification = await this.verificationRepository.upsert(
      userId,
      VerificationType.GOVERNMENT_ID,
      {
        status: VerificationStatus.VERIFIED,
        provider: 'placeholder',
        documentType: idType,
        verifiedAt: new Date(),
        valueEncrypted: null,
        last4: null,
        providerRef: null,
        failureReason: null,
      },
    );
    const user = await this.usersService.findById(userId);
    return { status: verification.status, ladderId: user.ladderId };
  }

  // The on-device check (blink / smile / head turns) runs in ladder-web; this records the result.
  // PLACEHOLDER: the selfie is checked for type/size and discarded until a liveness provider exists.
  // Completing liveness issues the Ladder ID for users who verified with a Government ID.
  async submitLiveness(
    userId: string,
    selfie: UploadedImage | undefined,
    challenges: LivenessChallenge[] = [],
  ): Promise<VerificationResultResponse> {
    if (!selfie) throw new AppError('FILE_REQUIRED', { selfie: ['We did not receive a photo.'] });
    if (!isOneOf(selfie.mimetype, SELFIE_FILE_TYPES)) {
      throw new AppError('FILE_TYPE_INVALID', { selfie: ['The photo must be a JPG or PNG.'] });
    }

    const verifications = await this.verificationRepository.findAllByUser(userId);
    const isVerified = (type: VerificationType) =>
      verifications.some((v) => v.type === type && v.status === VerificationStatus.VERIFIED);
    const hasIdentity =
      isVerified(VerificationType.BVN) ||
      isVerified(VerificationType.NIN) ||
      isVerified(VerificationType.GOVERNMENT_ID);
    if (!hasIdentity) throw new AppError('IDENTITY_REQUIRED');

    const verification = await this.verificationRepository.upsert(
      userId,
      VerificationType.LIVENESS,
      {
        status: VerificationStatus.VERIFIED,
        provider: 'on-device',
        providerRef: challenges.join(',') || null,
        verifiedAt: new Date(),
        valueEncrypted: null,
        last4: null,
        documentType: null,
        failureReason: null,
      },
    );
    const user = await this.usersService.completeVerification(userId, null);
    return { status: verification.status, ladderId: user.ladderId };
  }

  // Every attempt is recorded (number encrypted); the first match issues the Ladder ID.
  private async verify(
    userId: string,
    type: IdNumberType,
    number: string,
    dateOfBirth: string,
  ): Promise<VerificationResultResponse> {
    await this.assertNotVerified(userId, type);
    const user = await this.usersService.findById(userId);
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

  private lookup(type: IdNumberType, number: string, dateOfBirth: string): Promise<IdentityResult> {
    return type === VerificationType.BVN
      ? this.identityProvider.verifyBvn(number, dateOfBirth)
      : this.identityProvider.verifyNin(number, dateOfBirth);
  }

  // Once one credential is verified, the second must belong to the same date of birth.
  private matchesVerifiedDob(user: User, dateOfBirth: string): boolean {
    return !user.dateOfBirth || user.dateOfBirth.toISOString().slice(0, 10) === dateOfBirth;
  }

  private async assertNotVerified(userId: string, type: VerificationType): Promise<void> {
    const existing = await this.verificationRepository.findOne(userId, type);
    if (existing?.status === VerificationStatus.VERIFIED) throw new AppError('ALREADY_VERIFIED');
  }
}

const isOneOf = (value: string, allowed: readonly string[]): boolean => allowed.includes(value);
