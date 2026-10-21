import { Prisma, User } from '@prisma/client';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

const user = (overrides: Partial<User> = {}): User =>
  ({ id: 'user-1', email: 'ada@example.com', pinHash: null, ladderId: null, ...overrides }) as User;

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

  it('rejects signup for an email that finished onboarding', async () => {
    repo.findByEmail.mockResolvedValue(user({ pinHash: 'hash' }));
    await expect(service.createPending('ada@example.com', new Date())).rejects.toMatchObject({
      code: 'EMAIL_TAKEN',
    });
  });

  it('issues a Ladder ID in the LID-XXXX-XXXX format', async () => {
    repo.findById.mockResolvedValue(user());
    repo.update.mockImplementation(async (_id, data) =>
      user({ ladderId: data.ladderId as string }),
    );

    const result = await service.completeVerification('user-1');

    expect(result.ladderId).toMatch(/^LID-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
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

    await expect(service.completeVerification('user-1')).resolves.toHaveProperty(
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
