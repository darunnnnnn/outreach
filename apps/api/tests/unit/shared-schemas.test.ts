import { describe, expect, it } from 'vitest';
import {
  emailSchema,
  loginSchema,
  paginationSchema,
  passwordSchema,
  registerSchema,
  roleAtLeast,
  updateOrganizationSchema,
} from '@outreach/shared';

describe('roleAtLeast', () => {
  it('treats the role order as a privilege rank', () => {
    expect(roleAtLeast('OWNER', 'ADMIN')).toBe(true);
    expect(roleAtLeast('ADMIN', 'ADMIN')).toBe(true);
    expect(roleAtLeast('MEMBER', 'ADMIN')).toBe(false);
    expect(roleAtLeast('VIEWER', 'MEMBER')).toBe(false);
    expect(roleAtLeast('VIEWER', 'VIEWER')).toBe(true);
  });
});

describe('emailSchema', () => {
  it('normalises case and surrounding whitespace', () => {
    expect(emailSchema.parse('  Ada@Example.COM ')).toBe('ada@example.com');
  });

  it('rejects malformed addresses', () => {
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
    expect(emailSchema.safeParse('a@b').success).toBe(false);
  });
});

describe('passwordSchema', () => {
  it('requires at least 10 characters', () => {
    expect(passwordSchema.safeParse('Short1').success).toBe(false);
    expect(passwordSchema.safeParse('LongEnough1').success).toBe(true);
  });

  it('rejects passwords on the common deny-list regardless of case', () => {
    expect(passwordSchema.safeParse('password123').success).toBe(false);
    expect(passwordSchema.safeParse('Password123').success).toBe(false);
    expect(passwordSchema.safeParse('Outreach123').success).toBe(false);
  });

  it('rejects leading or trailing whitespace', () => {
    expect(passwordSchema.safeParse(' LongEnough1').success).toBe(false);
    expect(passwordSchema.safeParse('LongEnough1 ').success).toBe(false);
  });

  it('accepts a long passphrase with spaces inside it', () => {
    expect(passwordSchema.safeParse('correct horse battery staple').success).toBe(true);
  });
});

describe('registerSchema', () => {
  it('defaults the timezone and normalises the email', () => {
    const parsed = registerSchema.parse({
      name: 'Ada Lovelace',
      email: 'ADA@example.com',
      password: 'CorrectHorseBattery7',
      organizationName: 'Analytical Engines',
    });
    expect(parsed.timezone).toBe('UTC');
    expect(parsed.email).toBe('ada@example.com');
  });

  it('requires an organisation name', () => {
    const result = registerSchema.safeParse({
      name: 'Ada',
      email: 'ada@example.com',
      password: 'CorrectHorseBattery7',
      organizationName: '   ',
    });
    expect(result.success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('does not apply password policy to logins', () => {
    // An existing weak password must still be able to sign in and then be changed.
    expect(loginSchema.safeParse({ email: 'a@example.com', password: 'x' }).success).toBe(true);
  });
});

describe('paginationSchema', () => {
  it('coerces strings and applies defaults', () => {
    expect(paginationSchema.parse({})).toEqual({ page: 1, pageSize: 25 });
    expect(paginationSchema.parse({ page: '3', pageSize: '50' })).toEqual({
      page: 3,
      pageSize: 50,
    });
  });

  it('caps pageSize so a client cannot request the whole table', () => {
    expect(paginationSchema.safeParse({ pageSize: 1000 }).success).toBe(false);
  });
});

describe('updateOrganizationSchema', () => {
  it('rejects an empty patch', () => {
    expect(updateOrganizationSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a single field', () => {
    expect(updateOrganizationSchema.parse({ timezone: 'Europe/Berlin' })).toEqual({
      timezone: 'Europe/Berlin',
    });
  });
});
