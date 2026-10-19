import { describe, expect, it } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  generateToken,
  hashToken,
  safeEqual,
  slugify,
} from '../../src/lib/crypto';

describe('generateToken', () => {
  it('produces url-safe, non-repeating tokens', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(43);
  });
});

describe('hashToken', () => {
  it('is deterministic and never returns the input', () => {
    const token = 'some-refresh-token';
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toContain(token);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('separates tokens that differ by one character', () => {
    expect(hashToken('token-a')).not.toBe(hashToken('token-b'));
  });
});

describe('safeEqual', () => {
  it('compares equal and unequal values without throwing on length mismatch', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcdef')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});

describe('AES-256-GCM helpers', () => {
  it('round-trips a secret', () => {
    const plaintext = 'ya29.a0AfH6SMB-oauth-refresh-token';
    const encrypted = encryptSecret(plaintext);
    expect(encrypted).not.toContain(plaintext);
    expect(encrypted.split(':')).toHaveLength(3);
    expect(decryptSecret(encrypted)).toBe(plaintext);
  });

  it('uses a fresh IV, so the same input encrypts differently each time', () => {
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'));
  });

  it('rejects a tampered payload rather than returning garbage', () => {
    const [iv, tag, data] = encryptSecret('sensitive').split(':') as [string, string, string];
    const flipped = Buffer.from(data, 'base64');
    flipped[0] = (flipped[0] ?? 0) ^ 0xff;
    expect(() => decryptSecret([iv, tag, flipped.toString('base64')].join(':'))).toThrow();
  });

  it('rejects a malformed payload', () => {
    expect(() => decryptSecret('not-a-payload')).toThrow(/Malformed/);
  });
});

describe('slugify', () => {
  it('produces a url-safe slug with a disambiguating suffix', () => {
    const slug = slugify('Nordwind Textiles GmbH');
    expect(slug).toMatch(/^nordwind-textiles-gmbh-[0-9a-f]{6}$/);
  });

  it('handles accents, symbols and non-latin input', () => {
    expect(slugify('Café Ümlaut & Co.')).toMatch(/^cafe-umlaut-co-[0-9a-f]{6}$/);
    expect(slugify('株式会社')).toMatch(/^org-[0-9a-f]{6}$/);
  });

  it('never collides for the same name', () => {
    expect(slugify('Acme')).not.toBe(slugify('Acme'));
  });
});
