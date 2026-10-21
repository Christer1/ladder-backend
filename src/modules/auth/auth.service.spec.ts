import { ConfigService } from '@nestjs/config';
import { Otp, OtpPurpose, Session, User } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { hashSecret, sha256 } from '../../common/utils/crypto';
import { MailService } from '../../integrations/mail/mail.service';
import { UsersService } from '../users/users.service';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';

const user = (overrides: Partial<User> = {}): User => ({
  id: 'user-1',
  email: 'ada@example.com',
  dateOfBirth: new Date('1990-01-01'),
  pinHash: null,
  emailVerifiedAt: null,
  ladderId: null,
  status: 'PENDING',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const otp = (overrides: Partial<Otp> = {}): Otp => ({
  id: 'otp-1',
  email: 'ada@example.com',
  codeHash: '',
  purpose: OtpPurpose.SIGNUP,
  expiresAt: new Date(Date.now() + 60_000),
  attempts: 0,
  consumedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const expectCode = async (promise: Promise<unknown>, code: string) => {
  await expect(promise).rejects.toBeInstanceOf(AppError);
  await expect(promise).rejects.toMatchObject({ code });
};

describe('AuthService', () => {
  let repo: jest.Mocked<AuthRepository>;
  let users: jest.Mocked<UsersService>;
  let mail: jest.Mocked<MailService>;
  let service: AuthService;

  beforeEach(() => {
    repo = {
      findLatestOtp: jest.fn(),
      replaceOtp: jest.fn(),
      incrementOtpAttempts: jest.fn(),
      consumeOtp: jest.fn(),
      createSession: jest.fn(),
      findSessionByTokenHash: jest.fn(),
      revokeSession: jest.fn(),
    } as unknown as jest.Mocked<AuthRepository>;
    users = {
      createPending: jest.fn(),
      findByEmail: jest.fn(),
      findById: jest.fn(),
      markEmailVerified: jest.fn(),
      setPinHash: jest.fn(),
    } as unknown as jest.Mocked<UsersService>;
    mail = { sendOtp: jest.fn() } as unknown as jest.Mocked<MailService>;
    const config = { get: jest.fn().mockReturnValue(24) } as unknown as ConfigService;

    service = new AuthService(repo, users, mail, config as never);
  });

  describe('signup', () => {
    it('creates a pending user and emails a 6-digit code', async () => {
      users.createPending.mockResolvedValue(user());

      const result = await service.signup({ email: 'ada@example.com', dateOfBirth: '1990-01-01' });

      expect(result.otpExpiresIn).toBeGreaterThan(0);
      expect(repo.replaceOtp).toHaveBeenCalled();
      expect(mail.sendOtp).toHaveBeenCalledWith(
        'ada@example.com',
        expect.stringMatching(/^\d{6}$/),
        expect.any(Number),
      );
    });

    it('rejects users under the minimum age', async () => {
      const today = new Date().toISOString().slice(0, 10);
      await expectCode(
        service.signup({ email: 'ada@example.com', dateOfBirth: today }),
        'VALIDATION_FAILED',
      );
    });
  });

  describe('verifyOtp', () => {
    it('creates a session for a correct code', async () => {
      users.findByEmail.mockResolvedValue(user());
      repo.findLatestOtp.mockResolvedValue(otp({ codeHash: await hashSecret('123456') }));

      const session = await service.verifyOtp({ email: 'ada@example.com', code: '123456' });

      expect(session.token).toBeTruthy();
      expect(repo.consumeOtp).toHaveBeenCalledWith('otp-1');
      expect(repo.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', tokenHash: sha256(session.token) }),
      );
    });

    it('counts a wrong code as an attempt', async () => {
      users.findByEmail.mockResolvedValue(user());
      repo.findLatestOtp.mockResolvedValue(otp({ codeHash: await hashSecret('123456') }));
      repo.incrementOtpAttempts.mockResolvedValue(otp({ attempts: 1 }));

      await expectCode(
        service.verifyOtp({ email: 'ada@example.com', code: '000000' }),
        'OTP_INVALID',
      );
    });

    it('rejects an expired code', async () => {
      users.findByEmail.mockResolvedValue(user());
      repo.findLatestOtp.mockResolvedValue(otp({ expiresAt: new Date(Date.now() - 1000) }));

      await expectCode(
        service.verifyOtp({ email: 'ada@example.com', code: '123456' }),
        'OTP_EXPIRED',
      );
    });

    it('locks after too many attempts', async () => {
      users.findByEmail.mockResolvedValue(user());
      repo.findLatestOtp.mockResolvedValue(otp({ attempts: 5 }));

      await expectCode(
        service.verifyOtp({ email: 'ada@example.com', code: '123456' }),
        'OTP_LOCKED',
      );
    });
  });

  describe('resendOtp', () => {
    it('blocks resend during the cooldown', async () => {
      users.findByEmail.mockResolvedValue(user());
      repo.findLatestOtp.mockResolvedValue(otp({ createdAt: new Date() }));

      await expectCode(service.resendOtp({ email: 'ada@example.com' }), 'OTP_RESEND_TOO_SOON');
    });

    it('does not reveal unknown emails', async () => {
      users.findByEmail.mockResolvedValue(null);

      await expect(service.resendOtp({ email: 'nobody@example.com' })).resolves.toHaveProperty(
        'otpExpiresIn',
      );
      expect(mail.sendOtp).not.toHaveBeenCalled();
    });
  });

  describe('createPin', () => {
    it('hashes and stores the PIN', async () => {
      users.findById.mockResolvedValue(user());

      await service.createPin('user-1', { pin: '123456', confirmPin: '123456' });

      const [, pinHash] = users.setPinHash.mock.calls[0];
      expect(pinHash).not.toContain('123456');
    });

    it('rejects mismatched PINs', async () => {
      await expectCode(
        service.createPin('user-1', { pin: '123456', confirmPin: '654321' }),
        'PIN_MISMATCH',
      );
    });

    it('rejects setting a PIN twice', async () => {
      users.findById.mockResolvedValue(user({ pinHash: 'hash' }));
      await expectCode(
        service.createPin('user-1', { pin: '123456', confirmPin: '123456' }),
        'PIN_ALREADY_SET',
      );
    });
  });

  describe('validateSession', () => {
    it('rejects revoked sessions', async () => {
      repo.findSessionByTokenHash.mockResolvedValue({
        id: 's-1',
        userId: 'user-1',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      } as Session);

      await expectCode(service.validateSession('token'), 'UNAUTHENTICATED');
    });
  });
});
