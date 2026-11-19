import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/auth/password.js';

describe('password hashing', () => {
  it('verifies matching passwords and rejects non-matching passwords', () => {
    const hash = hashPassword('correct-horse-battery-staple');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(verifyPassword('correct-horse-battery-staple', hash)).toBe(true);
    expect(verifyPassword('wrong-password', hash)).toBe(false);
    expect(verifyPassword('anything', 'disabled$not-for-login')).toBe(false);
  });
});
