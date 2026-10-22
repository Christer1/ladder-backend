import { randomInt } from 'crypto';

// No 0/O/1/I/L to avoid misreading. Also used for WhatsApp help references.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export const randomBlock = (length: number): string =>
  Array.from({ length }, () => ALPHABET[randomInt(0, ALPHABET.length)]).join('');

// Format shown on the Verified screen: LID-7F3A-9K2D.
export const generateLadderId = (): string => `LID-${randomBlock(4)}-${randomBlock(4)}`;
