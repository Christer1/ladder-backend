import { randomInt } from 'crypto';

// No 0/O/1/I/L to avoid misreading.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

const block = (length: number): string =>
  Array.from({ length }, () => ALPHABET[randomInt(0, ALPHABET.length)]).join('');

// Format shown on the Verified screen: LID-7F3A-9K2D.
export const generateLadderId = (): string => `LID-${block(4)}-${block(4)}`;
