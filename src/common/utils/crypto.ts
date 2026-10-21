import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from 'crypto';
import * as argon2 from 'argon2';

// One-way hash for secrets the user types (PIN, OTP).
export const hashSecret = (value: string): Promise<string> =>
  argon2.hash(value, { type: argon2.argon2id });

export const verifySecret = (hash: string, value: string): Promise<boolean> =>
  argon2.verify(hash, value);

// Fast hash for high-entropy tokens (session tokens) so they can be looked up by hash.
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export const randomDigits = (length: number): string =>
  Array.from({ length }, () => randomInt(0, 10)).join('');

// AES-256-GCM for identity numbers we must be able to read back. Output: iv.tag.ciphertext (base64).
export function encrypt(plain: string, keyBase64: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyBase64, 'base64'), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((b) => b.toString('base64')).join('.');
}

export function decrypt(payload: string, keyBase64: string): string {
  const [iv, tag, data] = payload.split('.').map((part) => Buffer.from(part, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyBase64, 'base64'), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
