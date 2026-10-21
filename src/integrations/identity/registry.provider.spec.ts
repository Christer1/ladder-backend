import { IdentityRecord } from '@prisma/client';
import { IdentityRecordRepository } from './identity-record.repository';
import { RegistryIdentityProvider } from './registry.provider';

const record = (overrides: Partial<IdentityRecord> = {}): IdentityRecord =>
  ({
    id: 'rec-1',
    type: 'BVN',
    number: '22345678901',
    dateOfBirth: new Date('1990-05-17'),
    isValid: true,
    ...overrides,
  }) as IdentityRecord;

describe('RegistryIdentityProvider', () => {
  let records: jest.Mocked<IdentityRecordRepository>;
  let provider: RegistryIdentityProvider;

  beforeEach(() => {
    records = { findByNumber: jest.fn() } as unknown as jest.Mocked<IdentityRecordRepository>;
    provider = new RegistryIdentityProvider(records);
  });

  it('verifies a valid number with the matching date of birth', async () => {
    records.findByNumber.mockResolvedValue(record());

    await expect(provider.verifyBvn('22345678901', '1990-05-17')).resolves.toEqual({
      isVerified: true,
      providerRef: 'rec-1',
    });
    expect(records.findByNumber).toHaveBeenCalledWith('BVN', '22345678901');
  });

  it('returns NOT_FOUND for unknown numbers', async () => {
    records.findByNumber.mockResolvedValue(null);
    await expect(provider.verifyNin('70000000000', '1990-05-17')).resolves.toEqual({
      isVerified: false,
      failure: 'NOT_FOUND',
    });
  });

  it('returns INVALID for records flagged invalid, even with the right date of birth', async () => {
    records.findByNumber.mockResolvedValue(record({ isValid: false }));
    await expect(provider.verifyBvn('22345678901', '1990-05-17')).resolves.toMatchObject({
      isVerified: false,
      failure: 'INVALID',
    });
  });

  it('returns DOB_MISMATCH when the date of birth differs', async () => {
    records.findByNumber.mockResolvedValue(record());
    await expect(provider.verifyBvn('22345678901', '1990-05-18')).resolves.toMatchObject({
      isVerified: false,
      failure: 'DOB_MISMATCH',
    });
  });
});
