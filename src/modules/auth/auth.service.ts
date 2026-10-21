import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpPurpose } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { AppError } from '../../common/errors/app-error';
import {
  hashSecret,
  randomDigits,
  randomToken,
  sha256,
  verifySecret,
} from '../../common/utils/crypto';
import {
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_SECONDS,
} from '../../config/app.config';
import { EnvironmentVariables } from '../../config/env.validation';
import { MailService } from '../../integrations/mail/mail.service';
import { UsersService } from '../users/users.service';
import { AuthRepository } from './auth.repository';
import { OtpSentResponse, SessionResponse } from './dto/auth.response';
import { CreatePinDto } from './dto/create-pin.dto';
import { LoginDto } from './dto/login.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { SignupDto } from './dto/signup.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly usersService: UsersService,
    private readonly mailService: MailService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  private readonly dummyHash = hashSecret('ladder-dummy-password');

  async signup(dto: SignupDto): Promise<OtpSentResponse> {
    await this.usersService.createPending(dto.email, await hashSecret(dto.password));
    return this.issueOtp(dto.email);
  }

  async login(dto: LoginDto): Promise<SessionResponse> {
    const user = await this.usersService.findByEmail(dto.email);
    // Verify against a dummy hash for unknown emails so response time does not reveal which exist.
    const isMatch = await verifySecret(user?.passwordHash ?? (await this.dummyHash), dto.password);
    if (!user || !isMatch) throw new AppError('INVALID_CREDENTIALS');
    if (!user.emailVerifiedAt) throw new AppError('EMAIL_NOT_VERIFIED');

    return this.createSession(user.id);
  }

  async resendOtp(dto: ResendOtpDto): Promise<OtpSentResponse> {
    const user = await this.usersService.findByEmail(dto.email);
    // Same response for unknown or already verified accounts, so the endpoint cannot be used to probe emails.
    if (!user || user.emailVerifiedAt) return this.otpSentResponse();

    const latest = await this.authRepository.findLatestOtp(dto.email, OtpPurpose.SIGNUP);
    if (latest && secondsSince(latest.createdAt) < OTP_RESEND_COOLDOWN_SECONDS) {
      throw new AppError('OTP_RESEND_TOO_SOON');
    }
    return this.issueOtp(dto.email);
  }

  async verifyOtp(dto: VerifyOtpDto): Promise<SessionResponse> {
    const user = await this.usersService.findByEmail(dto.email);
    const otp = await this.authRepository.findLatestOtp(dto.email, OtpPurpose.SIGNUP);
    if (!user || !otp || otp.consumedAt) throw new AppError('OTP_INVALID');
    if (otp.attempts >= OTP_MAX_ATTEMPTS) throw new AppError('OTP_LOCKED');
    if (otp.expiresAt < new Date()) throw new AppError('OTP_EXPIRED');

    if (!(await verifySecret(otp.codeHash, dto.code))) {
      const { attempts } = await this.authRepository.incrementOtpAttempts(otp.id);
      throw new AppError(attempts >= OTP_MAX_ATTEMPTS ? 'OTP_LOCKED' : 'OTP_INVALID');
    }

    await this.authRepository.consumeOtp(otp.id);
    await this.usersService.markEmailVerified(user.id);
    return this.createSession(user.id);
  }

  async createPin(userId: string, dto: CreatePinDto): Promise<void> {
    if (dto.pin !== dto.confirmPin) {
      throw new AppError('PIN_MISMATCH', { confirmPin: ['PINs do not match.'] });
    }

    const user = await this.usersService.findById(userId);
    if (user.pinHash) throw new AppError('PIN_ALREADY_SET');

    await this.usersService.setPinHash(userId, await hashSecret(dto.pin));
  }

  async validateSession(token: string): Promise<AuthUser> {
    const session = await this.authRepository.findSessionByTokenHash(sha256(token));
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new AppError('UNAUTHENTICATED');
    }
    return { id: session.userId, sessionId: session.id };
  }

  async logout(sessionId: string): Promise<void> {
    await this.authRepository.revokeSession(sessionId);
  }

  private async issueOtp(email: string): Promise<OtpSentResponse> {
    const code = randomDigits(OTP_LENGTH);
    await this.authRepository.replaceOtp({
      email,
      purpose: OtpPurpose.SIGNUP,
      codeHash: await hashSecret(code),
      expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
    });
    await this.mailService.sendOtp(email, code, OTP_TTL_SECONDS);
    return this.otpSentResponse();
  }

  private otpSentResponse(): OtpSentResponse {
    return { otpExpiresIn: OTP_TTL_SECONDS, resendAvailableIn: OTP_RESEND_COOLDOWN_SECONDS };
  }

  private async createSession(userId: string): Promise<SessionResponse> {
    const token = randomToken();
    const ttlHours = this.config.get('SESSION_TTL_HOURS', { infer: true });
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    await this.authRepository.createSession({ userId, tokenHash: sha256(token), expiresAt });
    return { token, expiresAt };
  }
}

const secondsSince = (date: Date): number => (Date.now() - date.getTime()) / 1000;
