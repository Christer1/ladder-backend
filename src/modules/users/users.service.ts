import { Injectable } from '@nestjs/common';
import { OnboardingStep, Prisma, User, UserStatus } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { generateLadderId } from '../../common/utils/ladder-id';
import { maskLast4 } from '../../common/utils/mask';
import { ProfileResponse } from './dto/profile.response';
import { UsersRepository } from './users.repository';

const IDENTITY_NUMBER_LENGTH = 11; // BVN and NIN
const LADDER_ID_MAX_TRIES = 5;

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async findById(id: string): Promise<User> {
    const user = await this.usersRepository.findById(id);
    if (!user) throw new AppError('NOT_FOUND');
    return user;
  }

  findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findByEmail(email);
  }

  // Creates a pending user, or resets the password of one whose email is not verified yet.
  async createPending(email: string, passwordHash: string): Promise<User> {
    const existing = await this.usersRepository.findByEmail(email);
    if (existing?.emailVerifiedAt) throw new AppError('EMAIL_TAKEN');
    return this.usersRepository.upsertByEmail(email, passwordHash);
  }

  markEmailVerified(id: string): Promise<User> {
    return this.usersRepository.update(id, { emailVerifiedAt: new Date() });
  }

  setLastOnboardingStep(id: string, lastOnboardingStep: OnboardingStep): Promise<User> {
    return this.usersRepository.update(id, { lastOnboardingStep });
  }

  // Issues the Ladder ID once. Called after a BVN or NIN matches (with the verified date of birth)
  // and after liveness for users who verified with a Government ID instead (no date of birth).
  async completeVerification(id: string, dateOfBirth: Date | null): Promise<User> {
    const user = await this.findById(id);
    if (user.ladderId) return user;

    for (let attempt = 0; attempt < LADDER_ID_MAX_TRIES; attempt++) {
      try {
        return await this.usersRepository.update(id, {
          ladderId: generateLadderId(),
          ...(dateOfBirth && { dateOfBirth }),
          status: UserStatus.VERIFIED,
        });
      } catch (error) {
        const isCollision =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!isCollision) throw error;
      }
    }
    throw new AppError('INTERNAL_ERROR');
  }

  async getProfile(id: string): Promise<ProfileResponse> {
    const user = await this.usersRepository.findByIdWithVerifications(id);
    if (!user) throw new AppError('NOT_FOUND');

    return {
      id: user.id,
      email: user.email,
      dateOfBirth: user.dateOfBirth?.toISOString().slice(0, 10) ?? null,
      ladderId: user.ladderId,
      status: user.status,
      verifications: user.verifications.map((v) => ({
        type: v.type,
        status: v.status,
        maskedValue: v.last4 ? maskLast4(v.last4, IDENTITY_NUMBER_LENGTH) : null,
        verifiedAt: v.verifiedAt?.toISOString() ?? null,
      })),
    };
  }
}
