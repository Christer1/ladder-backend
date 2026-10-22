import { AssistanceSession, User, Verification } from '@prisma/client';
import { sha256 } from '../../common/utils/crypto';
import { IdentityPerson, IdentityProvider } from '../../integrations/identity/identity.provider';
import { SupportService } from '../support/support.service';
import { UserWithVerifications } from '../users/users.repository';
import { UsersService } from '../users/users.service';
import { AssistanceRepository } from './assistance.repository';
import { AssistanceService } from './assistance.service';

const DOB = '1990-05-17';

const person = (overrides: Partial<IdentityPerson> = {}): IdentityPerson => ({
  firstName: 'Ada',
  lastName: 'Okafor',
  dateOfBirth: DOB,
  phoneNumber: '08012345678',
  residentialAddress: '12 Allen Avenue, Ikeja',
  ...overrides,
});

const session = (overrides: Partial<AssistanceSession> = {}): AssistanceSession =>
  ({
    id: 'session-1',
    partnerId: 'zenith',
    method: 'BVN',
    providerRef: 'rec-1',
    userId: null,
    livenessVerifiedAt: new Date(),
    confirmedAt: null,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  }) as AssistanceSession;

const ladderUser = (verifications: Partial<Verification>[]): UserWithVerifications =>
  ({
    id: 'user-1',
    email: 'ada.ladder@example.com',
    status: 'VERIFIED',
    ladderId: 'LID-ABCD-EFGH',
    verifications,
  }) as UserWithVerifications;

const HELP = { helpReference: 'LDR-7K3QX9', whatsappUrl: 'https://wa.me/447860088970?text=x' };

const expectCode = async (promise: Promise<unknown>, code: string) => {
  await expect(promise).rejects.toMatchObject({ code });
};

describe('AssistanceService', () => {
  let repo: jest.Mocked<AssistanceRepository>;
  let users: jest.Mocked<UsersService>;
  let provider: jest.Mocked<IdentityProvider>;
  let support: jest.Mocked<SupportService>;
  let service: AssistanceService;

  beforeEach(() => {
    repo = {
      createSession: jest.fn(),
      findSessionByTokenHash: jest.fn(),
      updateSession: jest.fn(),
    } as unknown as jest.Mocked<AssistanceRepository>;
    users = {
      findById: jest.fn(),
      findByLadderId: jest.fn(),
    } as unknown as jest.Mocked<UsersService>;
    provider = {
      name: 'registry',
      verifyBvn: jest.fn().mockResolvedValue({ isVerified: true, providerRef: 'rec-bvn' }),
      verifyNin: jest.fn().mockResolvedValue({ isVerified: true, providerRef: 'rec-nin' }),
      getPerson: jest.fn().mockResolvedValue(person()),
    };
    support = {
      openIssue: jest.fn().mockResolvedValue(HELP),
    } as unknown as jest.Mocked<SupportService>;
    service = new AssistanceService(repo, users, provider, support);
  });

  describe('identify with BVN or NIN', () => {
    it('starts a session that stores only a hash of the token and the provider ref', async () => {
      const started = await service.identifyBvn('zenith', '22345678901', DOB);

      expect(provider.verifyBvn).toHaveBeenCalledWith('22345678901', DOB);
      expect(repo.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          tokenHash: sha256(started.token),
          partnerId: 'zenith',
          method: 'BVN',
          providerRef: 'rec-bvn',
        }),
      );
      expect(JSON.stringify(repo.createSession.mock.calls)).not.toContain('22345678901');
    });

    it.each(['NOT_FOUND', 'INVALID', 'DOB_MISMATCH'] as const)(
      'answers %s with INFORMATION_MISMATCH',
      async (failure) => {
        provider.verifyNin.mockResolvedValue({ isVerified: false, failure });
        await expectCode(service.identifyNin('zenith', '71234568901', DOB), 'INFORMATION_MISMATCH');
        expect(repo.createSession).not.toHaveBeenCalled();
      },
    );

    it('logs the real reason as a help issue and returns the WhatsApp link with the error', async () => {
      provider.verifyBvn.mockResolvedValue({ isVerified: false, failure: 'DOB_MISMATCH' });

      await expect(service.identifyBvn('zenith', '22345678901', DOB)).rejects.toMatchObject({
        code: 'INFORMATION_MISMATCH',
        details: HELP,
      });
      expect(support.openIssue).toHaveBeenCalledWith({
        partnerId: 'zenith',
        method: 'BVN',
        failedType: 'BVN',
        reason: 'DOB_MISMATCH',
        enteredValue: '22345678901',
      });
    });

    it('still answers INFORMATION_MISMATCH, without a link, when the issue cannot be logged', async () => {
      provider.verifyBvn.mockResolvedValue({ isVerified: false, failure: 'NOT_FOUND' });
      support.openIssue.mockRejectedValue(new Error('database down'));

      const error = await service.identifyBvn('zenith', '22345678901', DOB).catch((e) => e);
      expect(error).toMatchObject({ code: 'INFORMATION_MISMATCH' });
      expect(error.details).toBeUndefined();
    });
  });

  describe('identify with BVN and NIN', () => {
    it('starts a session when both numbers belong to the same person', async () => {
      await service.identifyBvnAndNin('zenith', '22345678901', '71234568901', DOB);
      expect(repo.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'BVN_AND_NIN', providerRef: 'rec-bvn' }),
      );
    });

    it('rejects a BVN and NIN that belong to different people', async () => {
      provider.getPerson.mockImplementation(async (ref) =>
        ref === 'rec-nin' ? person({ firstName: 'Chinedu' }) : person(),
      );
      await expectCode(
        service.identifyBvnAndNin('zenith', '22345678901', '71234568901', DOB),
        'INFORMATION_MISMATCH',
      );
      expect(support.openIssue).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'BVN_AND_NIN', reason: 'DIFFERENT_PEOPLE' }),
      );
    });

    it('rejects when either number fails', async () => {
      provider.verifyNin.mockResolvedValue({ isVerified: false, failure: 'DOB_MISMATCH' });
      await expectCode(
        service.identifyBvnAndNin('zenith', '22345678901', '71234568901', DOB),
        'INFORMATION_MISMATCH',
      );
    });
  });

  describe('identify with a Ladder ID', () => {
    const verifiedBvn = {
      type: 'BVN',
      status: 'VERIFIED',
      provider: 'registry',
      providerRef: 'rec-bvn',
    } as const;

    it('uses the person behind the verified BVN and remembers the user', async () => {
      users.findByLadderId.mockResolvedValue(ladderUser([verifiedBvn]));

      await service.identifyLadderId('zenith', 'LID-ABCD-EFGH');

      expect(repo.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'LADDER_ID', providerRef: 'rec-bvn', userId: 'user-1' }),
      );
    });

    it.each([
      ['unknown', null],
      ['not verified', { ...ladderUser([verifiedBvn]), status: 'PENDING' }],
      ['without a BVN or NIN', ladderUser([{ type: 'GOVERNMENT_ID', status: 'VERIFIED' }])],
      ['with a failed BVN', ladderUser([{ ...verifiedBvn, status: 'FAILED' }])],
    ])('rejects a Ladder ID that is %s with one error', async (_case, user) => {
      users.findByLadderId.mockResolvedValue(user as UserWithVerifications | null);
      await expectCode(service.identifyLadderId('zenith', 'LID-ABCD-EFGH'), 'LADDER_ID_NOT_FOUND');
      expect(support.openIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'LADDER_ID',
          failedType: null,
          reason: user ? 'LADDER_ID_NOT_VERIFIED' : 'LADDER_ID_UNKNOWN',
        }),
      );
    });
  });

  describe('session', () => {
    it('rejects missing, expired, revoked and other-partner sessions', async () => {
      await expectCode(service.validateSession('', 'zenith'), 'ASSISTANCE_SESSION_EXPIRED');

      for (const found of [
        null,
        session({ expiresAt: new Date(Date.now() - 1) }),
        session({ revokedAt: new Date() }),
        session({ partnerId: 'other' }),
      ]) {
        repo.findSessionByTokenHash.mockResolvedValue(found);
        await expectCode(service.validateSession('token', 'zenith'), 'ASSISTANCE_SESSION_EXPIRED');
      }
    });

    it('reports the method and liveness progress', () => {
      expect(
        service.getStatus(session({ method: 'BVN_AND_NIN', livenessVerifiedAt: null })),
      ).toEqual({ method: 'bvn-and-nin', identity: 'verified', liveness: 'not_started' });
    });
  });

  describe('liveness and details', () => {
    it('records liveness for a JPG or PNG selfie', async () => {
      await expect(
        service.submitLiveness(session(), { mimetype: 'image/jpeg', size: 1000 }),
      ).resolves.toEqual({ status: 'verified' });
      expect(repo.updateSession).toHaveBeenCalledWith('session-1', {
        livenessVerifiedAt: expect.any(Date),
      });

      await expectCode(service.submitLiveness(session(), undefined), 'FILE_REQUIRED');
    });

    it('returns no details before liveness', async () => {
      await expectCode(
        service.getDetails(session({ livenessVerifiedAt: null })),
        'LIVENESS_REQUIRED',
      );
      expect(provider.getPerson).not.toHaveBeenCalled();
    });

    it('returns the details on file, with placeholders for the rest, after liveness', async () => {
      await expect(service.getDetails(session())).resolves.toEqual({
        fullName: 'Ada Okafor',
        dateOfBirth: DOB,
        gender: 'Male',
        phoneNumber: '08012345678',
        email: 'customer@example.com',
        stateOfOrigin: 'Oyo',
        stateOfResidence: 'Oyo',
        town: 'Ibadan',
        residentialAddress: '12 Allen Avenue, Ikeja',
      });
    });

    it('shows a Ladder user their account email', async () => {
      users.findById.mockResolvedValue({ email: 'ada.ladder@example.com' } as User);
      await expect(
        service.getDetails(session({ method: 'LADDER_ID', userId: 'user-1' })),
      ).resolves.toHaveProperty('email', 'ada.ladder@example.com');
    });

    it('needs a typed address on confirm only when none is on file', async () => {
      provider.getPerson.mockResolvedValue(person({ residentialAddress: null }));
      await expectCode(service.confirmDetails(session()), 'VALIDATION_FAILED');

      await service.confirmDetails(session(), '3 Broad Street, Lagos');
      expect(repo.updateSession).toHaveBeenCalledWith('session-1', {
        confirmedAt: expect.any(Date),
      });
    });
  });
});
