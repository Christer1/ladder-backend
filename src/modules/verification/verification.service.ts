import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User, Verification, VerificationStatus, VerificationType } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { encrypt } from '../../common/utils/crypto';
import { detectMimeType } from '../../common/utils/file-signature';
import { last4 } from '../../common/utils/mask';
import { UPLOAD_MAX_BYTES } from '../../config/app.config';
import { EnvironmentVariables } from '../../config/env.validation';
import {
  IDENTITY_PROVIDER,
  IdentityProvider,
  IdentityResult,
} from '../../integrations/identity/identity.provider';
import { StorageService } from '../../integrations/storage/storage.service';
import { UsersService } from '../users/users.service';
import { GovernmentIdType } from './dto/upload-government-id.dto';
import {
  LivenessResponse,
  StepStatus,
  VerificationResultResponse,
  VerificationStatusResponse,
} from './dto/verification.response';
import { VerificationRepository } from './verification.repository';

const DOCUMENT_MIME_TYPES = ['image/png', 'image/jpeg', 'application/pdf'];
const SELFIE_MIME_TYPES = ['image/png', 'image/jpeg'];
// Any one of these verified is enough to move on to liveness (open question: confirm with product).
const CREDENTIAL_TYPES: VerificationType[] = [
  VerificationType.BVN,
  VerificationType.NIN,
  VerificationType.GOVERNMENT_ID,
];

interface CheckedFile {
  buffer: Buffer;
  size: number;
  mimeType: string;
}

@Injectable()
export class VerificationService {
  constructor(
    private readonly verificationRepository: VerificationRepository,
    private readonly usersService: UsersService,
    private readonly storageService: StorageService,
    @Inject(IDENTITY_PROVIDER) private readonly identityProvider: IdentityProvider,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async verifyBvn(userId: string, bvn: string): Promise<VerificationResultResponse> {
    const user = await this.getReadyUser(userId, VerificationType.BVN);
    const result = await this.identityProvider.verifyBvn(bvn, user);
    return this.saveNumberResult(user.id, VerificationType.BVN, bvn, result, 'BVN_MISMATCH');
  }

  async verifyNin(userId: string, nin: string): Promise<VerificationResultResponse> {
    const user = await this.getReadyUser(userId, VerificationType.NIN);
    const result = await this.identityProvider.verifyNin(nin, user);
    return this.saveNumberResult(user.id, VerificationType.NIN, nin, result, 'NIN_MISMATCH');
  }

  async uploadGovernmentId(
    userId: string,
    idType: GovernmentIdType,
    file: Express.Multer.File | undefined,
  ): Promise<VerificationResultResponse> {
    const user = await this.getReadyUser(userId, VerificationType.GOVERNMENT_ID);
    const { buffer, size, mimeType } = this.readFile(file, DOCUMENT_MIME_TYPES);

    const storageKey = await this.storageService.upload(
      `documents/${user.id}/${randomUUID()}`,
      buffer,
      mimeType,
    );
    const result = await this.identityProvider.verifyDocument({ idType, file: buffer, mimeType });
    const verification = await this.saveResult(user.id, VerificationType.GOVERNMENT_ID, result);
    await this.verificationRepository.createDocument({
      verificationId: verification.id,
      idType,
      storageKey,
      mimeType,
      sizeBytes: size,
    });

    if (!result.isVerified) throw new AppError('DOCUMENT_REJECTED');
    return { status: verification.status };
  }

  async submitLiveness(
    userId: string,
    selfie: Express.Multer.File | undefined,
  ): Promise<LivenessResponse> {
    const user = await this.getReadyUser(userId, VerificationType.LIVENESS);
    const verifications = await this.verificationRepository.findAllByUser(user.id);
    const hasCredential = verifications.some(
      (v) => CREDENTIAL_TYPES.includes(v.type) && v.status === VerificationStatus.VERIFIED,
    );
    if (!hasCredential) throw new AppError('CREDENTIAL_REQUIRED');

    const { buffer, mimeType } = this.readFile(selfie, SELFIE_MIME_TYPES);
    // The selfie is sent to the provider only; we do not store it.
    const result = await this.identityProvider.checkLiveness({ selfie: buffer, mimeType });
    const verification = await this.saveResult(user.id, VerificationType.LIVENESS, result);
    if (!result.isVerified) throw new AppError('LIVENESS_FAILED');

    const verifiedUser = await this.usersService.completeVerification(user.id);
    return { status: verification.status, ladderId: verifiedUser.ladderId };
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
    };
  }

  // The user must have finished the PIN step and not already have this step verified.
  private async getReadyUser(userId: string, type: VerificationType): Promise<User> {
    const user = await this.usersService.findById(userId);
    if (!user.pinHash) throw new AppError('PIN_REQUIRED');

    const existing = await this.verificationRepository.findOne(userId, type);
    if (existing?.status === VerificationStatus.VERIFIED) throw new AppError('ALREADY_VERIFIED');
    return user;
  }

  private async saveNumberResult(
    userId: string,
    type: VerificationType,
    value: string,
    result: IdentityResult,
    failureCode: ErrorCode,
  ): Promise<VerificationResultResponse> {
    const verification = await this.saveResult(userId, type, result, {
      valueEncrypted: encrypt(value, this.config.get('ENCRYPTION_KEY', { infer: true })),
      last4: last4(value),
    });
    if (!result.isVerified) throw new AppError(failureCode);
    return { status: verification.status };
  }

  private saveResult(
    userId: string,
    type: VerificationType,
    result: IdentityResult,
    extra: { valueEncrypted?: string; last4?: string } = {},
  ): Promise<Verification> {
    return this.verificationRepository.upsert(userId, type, {
      ...extra,
      status: result.isVerified ? VerificationStatus.VERIFIED : VerificationStatus.FAILED,
      provider: this.identityProvider.name,
      providerRef: result.providerRef ?? null,
      failureReason: result.failureReason ?? null,
      verifiedAt: result.isVerified ? new Date() : null,
    });
  }

  // Size is also capped by multer; the real type is read from the file's bytes.
  private readFile(file: Express.Multer.File | undefined, allowed: string[]): CheckedFile {
    if (!file) throw new AppError('FILE_REQUIRED');
    if (file.size > UPLOAD_MAX_BYTES) throw new AppError('FILE_TOO_LARGE');
    const mimeType = detectMimeType(file.buffer);
    if (!mimeType || !allowed.includes(mimeType)) throw new AppError('FILE_TYPE_INVALID');
    return { buffer: file.buffer, size: file.size, mimeType };
  }
}
