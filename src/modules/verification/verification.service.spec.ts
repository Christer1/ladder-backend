import { ConfigService } from '@nestjs/config';
import { User, Verification, VerificationStatus, VerificationType } from '@prisma/client';
import { randomBytes } from 'crypto';
import { decrypt } from '../../common/utils/crypto';
import { IdentityProvider } from '../../integrations/identity/identity.provider';
import { StorageService } from '../../integrations/storage/storage.service';
import { UsersService } from '../users/users.service';
import { VerificationRepository } from './verification.repository';
import { VerificationService } from './verification.service';

const KEY = randomBytes(32).toString('base64');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

const readyUser = { id: 'user-1', pinHash: 'hash', ladderId: null } as User;

const file = (buffer: Buffer): Express.Multer.File =>
  ({ buffer, size: buffer.length, mimetype: 'image/png' }) as Express.Multer.File;

const verification = (type: VerificationType, status: VerificationStatus): Verification =>
  ({ id: `v-${type}`, type, status }) as Verification;

const expectCode = async (promise: Promise<unknown>, code: string) => {
  await expect(promise).rejects.toMatchObject({ code });
};

describe('VerificationService', () => {
  let repo: jest.Mocked<VerificationRepository>;
  let users: jest.Mocked<UsersService>;
  let storage: jest.Mocked<StorageService>;
  let provider: jest.Mocked<IdentityProvider>;
  let service: VerificationService;

  beforeEach(() => {
    repo = {
      findAllByUser: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(async (_userId, type, data) => verification(type, data.status!)),
      createDocument: jest.fn(),
    } as unknown as jest.Mocked<VerificationRepository>;
    users = {
      findById: jest.fn().mockResolvedValue(readyUser),
      completeVerification: jest
        .fn()
        .mockResolvedValue({ ...readyUser, ladderId: 'LID-ABCD-EFGH' }),
    } as unknown as jest.Mocked<UsersService>;
    storage = {
      upload: jest.fn(async (key: string) => key),
    } as unknown as jest.Mocked<StorageService>;
    provider = {
      name: 'test',
      verifyBvn: jest.fn().mockResolvedValue({ isVerified: true }),
      verifyNin: jest.fn().mockResolvedValue({ isVerified: false, failureReason: 'not found' }),
      verifyDocument: jest.fn().mockResolvedValue({ isVerified: true }),
      checkLiveness: jest.fn().mockResolvedValue({ isVerified: true }),
    };
    const config = { get: jest.fn().mockReturnValue(KEY) } as unknown as ConfigService;

    service = new VerificationService(repo, users, storage, provider, config as never);
  });

  it('stores the BVN encrypted with only the last 4 in clear', async () => {
    await expect(service.verifyBvn('user-1', '12345678901')).resolves.toEqual({
      status: 'VERIFIED',
    });

    const [, , data] = repo.upsert.mock.calls[0];
    expect(data.last4).toBe('8901');
    expect(data.valueEncrypted).not.toContain('12345678901');
    expect(decrypt(data.valueEncrypted!, KEY)).toBe('12345678901');
  });

  it('records a failed NIN and returns NIN_MISMATCH', async () => {
    await expectCode(service.verifyNin('user-1', '12345670000'), 'NIN_MISMATCH');
    expect(repo.upsert).toHaveBeenCalledWith(
      'user-1',
      'NIN',
      expect.objectContaining({ status: 'FAILED' }),
    );
  });

  it('requires a PIN before verification', async () => {
    users.findById.mockResolvedValue({ ...readyUser, pinHash: null });
    await expectCode(service.verifyBvn('user-1', '12345678901'), 'PIN_REQUIRED');
  });

  it('rejects re-verifying a verified step', async () => {
    repo.findOne.mockResolvedValue(verification('BVN', 'VERIFIED'));
    await expectCode(service.verifyBvn('user-1', '12345678901'), 'ALREADY_VERIFIED');
  });

  it('rejects files whose bytes are not PNG/JPEG/PDF', async () => {
    const fake = file(Buffer.from('not really a png'));
    await expectCode(
      service.uploadGovernmentId('user-1', 'NATIONAL_ID_CARD', fake),
      'FILE_TYPE_INVALID',
    );
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('stores the government ID and records the document', async () => {
    await service.uploadGovernmentId('user-1', 'NATIONAL_ID_CARD', file(PNG));

    expect(storage.upload).toHaveBeenCalledWith(
      expect.stringMatching(/^documents\/user-1\//),
      PNG,
      'image/png',
    );
    expect(repo.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({ idType: 'NATIONAL_ID_CARD', mimeType: 'image/png' }),
    );
  });

  it('requires a verified credential before liveness', async () => {
    await expectCode(service.submitLiveness('user-1', file(PNG)), 'CREDENTIAL_REQUIRED');
  });

  it('issues the Ladder ID after liveness passes', async () => {
    repo.findAllByUser.mockResolvedValue([verification('BVN', 'VERIFIED')]);

    await expect(service.submitLiveness('user-1', file(PNG))).resolves.toEqual({
      status: 'VERIFIED',
      ladderId: 'LID-ABCD-EFGH',
    });
  });

  it('reports NOT_STARTED for steps with no attempt', async () => {
    repo.findAllByUser.mockResolvedValue([verification('BVN', 'VERIFIED')]);

    await expect(service.getStatus('user-1')).resolves.toEqual({
      bvn: 'VERIFIED',
      nin: 'NOT_STARTED',
      governmentId: 'NOT_STARTED',
      liveness: 'NOT_STARTED',
      ladderId: null,
    });
  });
});
