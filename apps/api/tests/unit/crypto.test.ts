import { describe, expect, it } from 'vitest';
import { hashPassword, randomToken, sha256, shortCode, verifyPassword } from '../../src/utils/crypto.js';

describe('crypto utils', () => {
  it('hashes and verifies passwords with scrypt', async () => {
    const hash = await hashPassword('Password123!');
    expect(hash.startsWith('scrypt$16384$8$1$')).toBe(true);
    expect(await verifyPassword('Password123!', hash)).toBe(true);
    expect(await verifyPassword('password123!', hash)).toBe(false);
    expect(await verifyPassword('x', null)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });

  it('produces unique salted hashes', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    expect(a).not.toBe(b);
  });

  it('generates short codes and tokens', () => {
    const code = shortCode();
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(randomToken(32)).toHaveLength(43);
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
