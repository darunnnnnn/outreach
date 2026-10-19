import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  parseDurationToSeconds,
  signAccessToken,
  verifyAccessToken,
} from '../../src/modules/auth/tokens';
import { UnauthenticatedError } from '../../src/http/errors';

describe('parseDurationToSeconds', () => {
  it('parses each supported unit', () => {
    expect(parseDurationToSeconds('45')).toBe(45);
    expect(parseDurationToSeconds('30s')).toBe(30);
    expect(parseDurationToSeconds('15m')).toBe(900);
    expect(parseDurationToSeconds('2h')).toBe(7200);
    expect(parseDurationToSeconds('1d')).toBe(86_400);
    expect(parseDurationToSeconds(' 15m ')).toBe(900);
  });

  it('rejects anything it cannot parse instead of guessing', () => {
    expect(() => parseDurationToSeconds('15 minutes')).toThrow(/Invalid duration/);
    expect(() => parseDurationToSeconds('')).toThrow(/Invalid duration/);
    expect(() => parseDurationToSeconds('-5m')).toThrow(/Invalid duration/);
  });
});

describe('access tokens', () => {
  it('round-trips the user and session id', () => {
    const token = signAccessToken('user_1', 'session_1');
    expect(verifyAccessToken(token)).toEqual({ sub: 'user_1', sid: 'session_1' });
  });

  it('carries no role or organisation, so authorisation cannot go stale', () => {
    const decoded = jwt.decode(signAccessToken('user_1', 'session_1')) as Record<string, unknown>;
    expect(Object.keys(decoded).sort()).toEqual(['exp', 'iat', 'sid', 'sub']);
  });

  it('expires according to ACCESS_TOKEN_TTL', () => {
    const decoded = jwt.decode(signAccessToken('user_1', 'session_1')) as {
      iat: number;
      exp: number;
    };
    expect(decoded.exp - decoded.iat).toBe(ACCESS_TOKEN_TTL_SECONDS);
    expect(ACCESS_TOKEN_TTL_SECONDS).toBeLessThanOrEqual(3600);
  });

  it('rejects a token signed with another secret', () => {
    const forged = jwt.sign({ sub: 'user_1', sid: 'session_1' }, 'a-different-secret-value-here');
    expect(() => verifyAccessToken(forged)).toThrow(UnauthenticatedError);
  });

  it('rejects an expired token', () => {
    const expired = jwt.sign(
      { sub: 'user_1', sid: 'session_1' },
      process.env.JWT_SECRET ?? 'test-only-secret-at-least-32-characters-long',
      { expiresIn: -10 },
    );
    expect(() => verifyAccessToken(expired)).toThrow(/expired/i);
  });

  it('rejects a token missing the session claim', () => {
    const noSid = jwt.sign(
      { sub: 'user_1' },
      process.env.JWT_SECRET ?? 'test-only-secret-at-least-32-characters-long',
    );
    expect(() => verifyAccessToken(noSid)).toThrow(UnauthenticatedError);
  });

  it('rejects an unsigned (alg=none) token', () => {
    const unsigned = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
      'base64url',
    )}.${Buffer.from(JSON.stringify({ sub: 'user_1', sid: 'session_1' })).toString('base64url')}.`;
    expect(() => verifyAccessToken(unsigned)).toThrow(UnauthenticatedError);
  });

  it('rejects garbage', () => {
    expect(() => verifyAccessToken('not.a.token')).toThrow(UnauthenticatedError);
  });
});
