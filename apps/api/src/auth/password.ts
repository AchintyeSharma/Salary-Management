import crypto from 'node:crypto';

const KEY_LENGTH = 64;
const SCRYPT_OPTIONS: crypto.ScryptOptions = { N: 16384, r: 8, p: 1 };

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, KEY_LENGTH, SCRYPT_OPTIONS).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }
  const [, salt, expectedHex] = parts;
  if (!salt || !expectedHex) {
    return false;
  }
  const derived = crypto.scryptSync(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(derived, expected);
}
