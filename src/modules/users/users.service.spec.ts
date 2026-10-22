import { Prisma, User } from '@prisma/client';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

const user = (overrides: Partial<User> = {}): User =>
  ({ id: 'user-1', email: 'ada@example.com', ladderId: null, ...overrides }) as User;

describe('UsersService', () => {
  let repo: jest.Mocked<UsersRepository>;
  let service: UsersService;

  beforeEach(() => {
    repo = {
      findById: jest.fn(),
      findByEmail: jest.fn(),
      findByIdWithVerifications: jest.fn(),
      upsertByEmail: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<UsersRepository>;
    service = new UsersService(repo);
  });

  it('rejects signup for an email that is already verified', async () => {
    repo.findByEmail.mockResolvedValue(user({ emailVerifiedAt: new Date() }));
    await expect(service.createPending('ada@example.com', 'hash')).rejects.toMatchObject({
      code: 'EMAIL_TAKEN',
    });
  });

  it('issues a Ladder ID and stores the verified date of birth', async () => {
    repo.findById.mockResolvedValue(user());
    repo.update.mockImplementation(async (_id, data) =>
      user({ ladderId: data.ladderId as string }),
    );

    const result = await service.completeVerification('user-1', new Date('1990-05-17'));

    expect(result.ladderId).toMatch(/^LID-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(repo.update).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ dateOfBirth: new Date('1990-05-17'), status: 'VERIFIED' }),
    );
  });

  it('issues a Ladder ID without a date of birth (Government ID path)', async () => {
    repo.findById.mockResolvedValue(user());
    repo.update.mockImplementation(async (_id, data) =>
      user({ ladderId: data.ladderId as string }),
    );

    await service.completeVerification('user-1', null);

    const data = repo.update.mock.calls[0][1];
    expect(data).not.toHaveProperty('dateOfBirth');
    expect(data).toMatchObject({ status: 'VERIFIED' });
  });

  it('keeps an existing Ladder ID', async () => {
    repo.findById.mockResolvedValue(user({ ladderId: 'LID-AAAA-BBBB' }));
    await expect(service.completeVerification('user-1', null)).resolves.toHaveProperty(
      'ladderId',
      'LID-AAAA-BBBB',
    );
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('uses the user the caller already loaded instead of fetching it again', async () => {
    repo.update.mockImplementation(async (_id, data) => ({ ...user(), ...data }) as never);

    await service.completeVerification('user-1', null, user());

    expect(repo.findById).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledTimes(1);
  });

  it('retries when a generated Ladder ID already exists', async () => {
    const collision = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'test',
    });
    repo.findById.mockResolvedValue(user());
    repo.update
      .mockRejectedValueOnce(collision)
      .mockResolvedValueOnce(user({ ladderId: 'LID-AAAA-BBBB' }));

    await expect(service.completeVerification('user-1', new Date())).resolves.toHaveProperty(
      'ladderId',
      'LID-AAAA-BBBB',
    );
    expect(repo.update).toHaveBeenCalledTimes(2);
  });

  it('masks identity numbers in the profile', async () => {
    repo.findByIdWithVerifications.mockResolvedValue({
      ...user({ dateOfBirth: new Date('1990-01-01'), status: 'PENDING' }),
      verifications: [{ type: 'BVN', status: 'VERIFIED', last4: '8901', verifiedAt: null }],
    } as never);

    const profile = await service.getProfile('user-1');

    expect(profile.dateOfBirth).toBe('1990-01-01');
    expect(profile.verifications[0].maskedValue).toBe('*******8901');
  });
});
