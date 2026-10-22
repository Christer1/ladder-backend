import { Inject, Injectable } from '@nestjs/common';
import {
  AssistanceMethod,
  AssistanceSession,
  UserStatus,
  VerificationStatus,
  VerificationType,
} from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { randomToken, sha256 } from '../../common/utils/crypto';
import { ASSISTANCE_SESSION_TTL_MINUTES, SELFIE_FILE_TYPES } from '../../config/app.config';
import {
  IDENTITY_PROVIDER,
  IdentityPerson,
  IdentityProvider,
} from '../../integrations/identity/identity.provider';
import { UsersService } from '../users/users.service';
import { UploadedImage } from '../verification/verification.service';
import {
  AssistanceDetailsResponse,
  AssistanceMethodName,
  AssistanceStatusResponse,
  AssistanceStepResponse,
} from './dto/assistance.response';
import { AssistanceRepository } from './assistance.repository';

export interface StartedAssistanceSession {
  token: string;
  expiresAt: Date;
}

const METHOD_NAMES: Record<AssistanceMethod, AssistanceMethodName> = {
  BVN: 'bvn',
  NIN: 'nin',
  BVN_AND_NIN: 'bvn-and-nin',
  LADDER_ID: 'ladder-id',
};

// PLACEHOLDER: shown to everyone until we decide where these come from. Not stored with BVN/NIN
// records, which hold only what verification needs.
const PLACEHOLDER_PROFILE = {
  gender: 'Male',
  email: 'customer@example.com',
  stateOfOrigin: 'Oyo',
  stateOfResidence: 'Oyo',
  town: 'Ibadan',
} as const;

// Ladder ID lookups read the person behind the user's verified BVN, else NIN.
const LADDER_ID_SOURCES: readonly VerificationType[] = [VerificationType.BVN, VerificationType.NIN];

// Partner account opening (ladder-assistance): identify with BVN/NIN or a Ladder ID, pass liveness,
// then review the details on file. Nothing personal is returned until liveness passes.
@Injectable()
export class AssistanceService {
  constructor(
    private readonly assistanceRepository: AssistanceRepository,
    private readonly usersService: UsersService,
    @Inject(IDENTITY_PROVIDER) private readonly identityProvider: IdentityProvider,
  ) {}

  async identifyBvn(
    partnerId: string,
    bvn: string,
    dateOfBirth: string,
  ): Promise<StartedAssistanceSession> {
    const providerRef = await this.match(VerificationType.BVN, bvn, dateOfBirth);
    return this.startSession(partnerId, AssistanceMethod.BVN, providerRef);
  }

  async identifyNin(
    partnerId: string,
    nin: string,
    dateOfBirth: string,
  ): Promise<StartedAssistanceSession> {
    const providerRef = await this.match(VerificationType.NIN, nin, dateOfBirth);
    return this.startSession(partnerId, AssistanceMethod.NIN, providerRef);
  }

  // Both numbers must match the date of birth and belong to the same person (same name).
  async identifyBvnAndNin(
    partnerId: string,
    bvn: string,
    nin: string,
    dateOfBirth: string,
  ): Promise<StartedAssistanceSession> {
    const bvnRef = await this.match(VerificationType.BVN, bvn, dateOfBirth);
    const ninRef = await this.match(VerificationType.NIN, nin, dateOfBirth);
    const [bvnPerson, ninPerson] = await Promise.all([
      this.identityProvider.getPerson(bvnRef),
      this.identityProvider.getPerson(ninRef),
    ]);
    if (!bvnPerson || !ninPerson || !isSamePerson(bvnPerson, ninPerson)) {
      throw new AppError('INFORMATION_MISMATCH');
    }
    return this.startSession(partnerId, AssistanceMethod.BVN_AND_NIN, bvnRef);
  }

  // A Ladder ID qualifies once its owner is verified with a BVN or NIN, the source of the details.
  // Unknown and unverified IDs get the same error so IDs can't be probed.
  async identifyLadderId(partnerId: string, ladderId: string): Promise<StartedAssistanceSession> {
    const user = await this.usersService.findByLadderId(ladderId);
    const source =
      user?.status === UserStatus.VERIFIED
        ? LADDER_ID_SOURCES.map((type) =>
            user.verifications.find(
              (v) =>
                v.type === type &&
                v.status === VerificationStatus.VERIFIED &&
                v.provider === this.identityProvider.name,
            ),
          ).find((v) => v?.providerRef)
        : undefined;
    if (!user || !source?.providerRef) throw new AppError('LADDER_ID_NOT_FOUND');

    return this.startSession(partnerId, AssistanceMethod.LADDER_ID, source.providerRef, user.id);
  }

  async validateSession(token: string, partnerId: string): Promise<AssistanceSession> {
    const session = token
      ? await this.assistanceRepository.findSessionByTokenHash(sha256(token))
      : null;
    const isActive =
      session &&
      !session.revokedAt &&
      session.expiresAt > new Date() &&
      session.partnerId === partnerId;
    if (!isActive) throw new AppError('ASSISTANCE_SESSION_EXPIRED');
    return session;
  }

  getStatus(session: AssistanceSession): AssistanceStatusResponse {
    return {
      method: METHOD_NAMES[session.method],
      identity: 'verified',
      liveness: session.livenessVerifiedAt ? 'verified' : 'not_started',
    };
  }

  // PLACEHOLDER, like /verification/liveness: the selfie is checked for type (size via Multer) and
  // discarded. No face comparison exists yet, so FACE_MISMATCH is never returned.
  async submitLiveness(
    session: AssistanceSession,
    selfie: UploadedImage | undefined,
  ): Promise<AssistanceStepResponse> {
    if (!selfie) throw new AppError('FILE_REQUIRED', { selfie: ['We did not receive a photo.'] });
    if (!(SELFIE_FILE_TYPES as readonly string[]).includes(selfie.mimetype)) {
      throw new AppError('FILE_TYPE_INVALID', { selfie: ['The photo must be a JPG or PNG.'] });
    }

    await this.assistanceRepository.updateSession(session.id, { livenessVerifiedAt: new Date() });
    return { status: 'verified' };
  }

  async getDetails(session: AssistanceSession): Promise<AssistanceDetailsResponse> {
    const person = await this.getVerifiedPerson(session);
    // A Ladder user's own account email replaces the placeholder.
    const user = session.userId ? await this.usersService.findById(session.userId) : null;

    return {
      ...PLACEHOLDER_PROFILE,
      fullName: `${person.firstName} ${person.lastName}`,
      dateOfBirth: person.dateOfBirth,
      phoneNumber: person.phoneNumber,
      email: user?.email ?? PLACEHOLDER_PROFILE.email,
      residentialAddress: person.residentialAddress,
    };
  }

  // Records that the customer reviewed their details. Handing them to the partner is not built yet
  // (open question), so a typed address is validated but not stored.
  async confirmDetails(session: AssistanceSession, residentialAddress?: string): Promise<void> {
    const person = await this.getVerifiedPerson(session);
    if (!person.residentialAddress && !residentialAddress) {
      throw new AppError('VALIDATION_FAILED', {
        residentialAddress: ['Enter your residential address.'],
      });
    }
    await this.assistanceRepository.updateSession(session.id, { confirmedAt: new Date() });
  }

  async endSession(session: AssistanceSession): Promise<void> {
    await this.assistanceRepository.updateSession(session.id, { revokedAt: new Date() });
  }

  // Not found, invalid and wrong date of birth all answer INFORMATION_MISMATCH.
  private async match(
    type: typeof VerificationType.BVN | typeof VerificationType.NIN,
    number: string,
    dateOfBirth: string,
  ): Promise<string> {
    const result =
      type === VerificationType.BVN
        ? await this.identityProvider.verifyBvn(number, dateOfBirth)
        : await this.identityProvider.verifyNin(number, dateOfBirth);
    if (!result.isVerified || !result.providerRef) throw new AppError('INFORMATION_MISMATCH');
    return result.providerRef;
  }

  private async startSession(
    partnerId: string,
    method: AssistanceMethod,
    providerRef: string,
    userId?: string,
  ): Promise<StartedAssistanceSession> {
    const token = randomToken();
    const expiresAt = new Date(Date.now() + ASSISTANCE_SESSION_TTL_MINUTES * 60_000);
    await this.assistanceRepository.createSession({
      tokenHash: sha256(token),
      partnerId,
      method,
      providerRef,
      userId: userId ?? null,
      expiresAt,
    });
    return { token, expiresAt };
  }

  private async getVerifiedPerson(session: AssistanceSession): Promise<IdentityPerson> {
    if (!session.livenessVerifiedAt) throw new AppError('LIVENESS_REQUIRED');
    const person = await this.identityProvider.getPerson(session.providerRef);
    if (!person) throw new AppError('NOT_FOUND');
    return person;
  }
}

const normalizeName = (value: string): string => value.trim().toLowerCase();

const isSamePerson = (a: IdentityPerson, b: IdentityPerson): boolean =>
  normalizeName(a.firstName) === normalizeName(b.firstName) &&
  normalizeName(a.lastName) === normalizeName(b.lastName) &&
  a.dateOfBirth === b.dateOfBirth;
