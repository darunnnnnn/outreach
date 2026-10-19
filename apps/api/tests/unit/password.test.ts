import { describe, expect, it } from 'vitest';
import { burnTimingBudget, hashPassword, verifyPassword } from '../../src/modules/auth/password';

describe('password hashing', () => {
  it('never stores the plaintext and verifies correctly', async () => {
    const hash = await hashPassword('CorrectHorseBattery7');
    expect(hash).not.toContain('CorrectHorseBattery7');
    expect(hash.startsWith('$2')).toBe(true);
    expect(await verifyPassword('CorrectHorseBattery7', hash)).toBe(true);
    expect(await verifyPassword('correcthorsebattery7', hash)).toBe(false);
  });

  it('salts, so the same password hashes differently', async () => {
    const a = await hashPassword('CorrectHorseBattery7');
    const b = await hashPassword('CorrectHorseBattery7');
    expect(a).not.toBe(b);
    expect(await verifyPassword('CorrectHorseBattery7', b)).toBe(true);
  });

  it('exposes a timing-equalisation path for unknown accounts', async () => {
    await expect(burnTimingBudget()).resolves.toBeUndefined();
  });
});
