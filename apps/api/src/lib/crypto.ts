import crypto from 'node:crypto';
import { env } from '../config/env';

/** URL-safe random token. 48 bytes -> 64 base64url characters of entropy. */
export function generateToken(bytes = 48): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/**
 * Refresh and invitation tokens are stored only as a digest, so a database dump
 * does not yield usable credentials. SHA-256 is correct here (not bcrypt): the
 * input is already high-entropy, and lookups must be fast and indexable.
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison for any secret compared in application code. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const ALGORITHM = 'aes-256-gcm';

function encryptionKey(): Buffer {
  if (!env.ENCRYPTION_KEY) {
    throw new Error(
      'ENCRYPTION_KEY is not configured. Required to store provider credentials.',
    );
  }
  return Buffer.from(env.ENCRYPTION_KEY, 'base64');
}

/**
 * AES-256-GCM for data that must come back out: OAuth refresh tokens and provider
 * API keys (Phase 4+). Format `iv:tag:ciphertext`, all base64. Unused in Phase 1,
 * but shipped and tested now so no phase has to invent its own scheme.
 */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 3) throw new Error('Malformed encrypted payload');
  const [ivB64, tagB64, dataB64] = parts as [string, string, string];
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    encryptionKey(),
    Buffer.from(ivB64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** Slug for an organisation name, with a short random suffix to avoid collisions. */
export function slugify(input: string): string {
  const base = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const stem = base.length >= 2 ? base : 'org';
  return `${stem}-${crypto.randomBytes(3).toString('hex')}`;
}
