import { ConfigService } from '@nestjs/config';
import { User, Verification, VerificationStatus, VerificationType } from '@prisma/client';
import { randomBytes } from 'crypto';
import { decrypt } from '../../common/utils/crypto';
import { IdentityProvider } from '../../integrations/identity/identity.provider';
import { UsersService } from '../users/users.service';
import { VerificationRepository } from './verification.repository';
import { VerificationService } from './verification.service';

const KEY = randomBytes(32).toString('base64');
const DOB = '1990-05-17';

const readyUser = { id: 'user-1', pinHash: 'hash', dateOfBirth: null, ladderId: null } as User;

const verification = (type: VerificationType, status: VerificationStatus): Verification =>
  ({ id: `v-${type}`, type, status }) as Verification;

const expectCode = async (promise: Promise<unknown>, code: string) => {
  await expect(promise).rejects.toMatchObject({ code });
};

describe('VerificationService', () => {
  let repo: jest.Mocked<VerificationRepository>;
  let users: jest.Mocked<UsersService>;
  let provider: jest.Mocked<IdentityProvider>;
  let service: VerificationService;

  beforeEach(() => {
    repo = {
      findAllByUser: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(async (_userId, type, data) => verification(type, data.status!)),
    } as unknown as jest.Mocked<VerificationRepository>;
    users = {
      findById: jest.fn().mockResolvedValue(readyUser),
      completeVerification: jest
        .fn()
        .mockResolvedValue({ ...readyUser, ladderId: 'LID-ABCD-EFGH' }),
    } as unknown as jest.Mocked<UsersService>;
    provider = {
      name: 'test',
      verifyBvn: jest.fn().mockResolvedValue({ isVerified: true, providerRef: 'rec-1' }),
      verifyNin: jest.fn().mockResolvedValue({ isVerified: true, providerRef: 'rec-2' }),
    };
    const config = { get: jest.fn().mockReturnValue(KEY) } as unknown as ConfigService;

    service = new VerificationService(repo, users, provider, config as never);
  });

  it('verifies a BVN with its date of birth and issues the Ladder ID', async () => {
    await expect(service.verifyBvn('user-1', '22345678901', DOB)).resolves.toEqual({
      status: 'VERIFIED',
      ladderId: 'LID-ABCD-EFGH',
    });

    expect(provider.verifyBvn).toHaveBeenCalledWith('22345678901', DOB);
    expect(users.completeVerification).toHaveBeenCalledWith('user-1', new Date(DOB));
  });

  it('stores the number encrypted with only the last 4 in clear', async () => {
    await service.verifyNin('user-1', '71234568901', DOB);

    const [, , data] = repo.upsert.mock.calls[0];
    expect(data.last4).toBe('8901');
    expect(data.valueEncrypted).not.toContain('71234568901');
    expect(decrypt(data.valueEncrypted!, KEY)).toBe('71234568901');
  });

  it.each([
    ['NOT_FOUND', 'BVN_NOT_FOUND'],
    ['INVALID', 'BVN_INVALID'],
    ['DOB_MISMATCH', 'BVN_DOB_MISMATCH'],
  ] as const)('maps a %s result to %s and records the failure', async (failure, code) => {
    provider.verifyBvn.mockResolvedValue({ isVerified: false, failure });

    await expectCode(service.verifyBvn('user-1', '22345678901', DOB), code);
    expect(repo.upsert).toHaveBeenCalledWith(
      'user-1',
      'BVN',
      expect.objectContaining({ status: 'FAILED', failureReason: failure }),
    );
    expect(users.completeVerification).not.toHaveBeenCalled();
  });

  it('uses NIN error codes for NIN failures', async () => {
    provider.verifyNin.mockResolvedValue({ isVerified: false, failure: 'INVALID' });
    await expectCode(service.verifyNin('user-1', '71234568901', DOB), 'NIN_INVALID');
  });

  it('requires the second credential to match the already verified date of birth', async () => {
    users.findById.mockResolvedValue({ ...readyUser, dateOfBirth: new Date(DOB) });

    await expectCode(service.verifyNin('user-1', '71234568901', '1985-01-01'), 'NIN_DOB_MISMATCH');
    expect(provider.verifyNin).not.toHaveBeenCalled();
  });

  it('requires a PIN before verification', async () => {
    users.findById.mockResolvedValue({ ...readyUser, pinHash: null });
    await expectCode(service.verifyBvn('user-1', '22345678901', DOB), 'PIN_REQUIRED');
  });

  it('rejects re-verifying a verified credential', async () => {
    repo.findOne.mockResolvedValue(verification('BVN', 'VERIFIED'));
    await expectCode(service.verifyBvn('user-1', '22345678901', DOB), 'ALREADY_VERIFIED');
  });

  it('reports NOT_STARTED for credentials with no attempt', async () => {
    repo.findAllByUser.mockResolvedValue([verification('BVN', 'VERIFIED')]);

    await expect(service.getStatus('user-1')).resolves.toEqual({
      bvn: 'VERIFIED',
      nin: 'NOT_STARTED',
      ladderId: null,
    });
  });
});
