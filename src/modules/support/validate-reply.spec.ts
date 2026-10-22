import { maskLongNumbers, replyProblems } from './validate-reply';

describe('replyProblems', () => {
  it('accepts a normal reply, including a warning not to share secrets', () => {
    expect(
      replyProblems(
        'The date of birth did not match your BVN ending 8901. Please never share your OTP or PIN.',
      ),
    ).toEqual([]);
  });

  it.each([
    ['', 'empty'],
    ['x'.repeat(1501), 'too_long'],
    ['Your BVN is 22345678901.', 'long_digit_string'],
    ['Please send your OTP so we can check.', 'asks_for_secret'],
    ['Good news, your account is now open!', 'claims_account_open'],
  ])('flags %j as %s', (reply, problem) => {
    expect(replyProblems(reply)).toContain(problem);
  });
});

describe('maskLongNumbers', () => {
  it('removes ID-length numbers, with or without spaces, and keeps short ones', () => {
    expect(maskLongNumbers('My BVN is 22345678901 and NIN 7123 4568 901, born 1990')).toBe(
      'My BVN is [number removed] and NIN [number removed], born 1990',
    );
    expect(maskLongNumbers('Ref: LDR-7K3QX9')).toBe('Ref: LDR-7K3QX9');
  });
});
