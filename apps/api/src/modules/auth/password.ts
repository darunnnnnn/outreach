import bcrypt from 'bcryptjs';
import { env } from '../../config/env';

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, env.BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * A hash of a throwaway value, generated once at startup at the configured cost.
 * When a login is attempted for an address with no account we compare against
 * this instead of returning early, so response time does not reveal whether the
 * account exists.
 */
const DUMMY_HASH = bcrypt.hashSync('timing-equalisation-placeholder', env.BCRYPT_ROUNDS);

export async function burnTimingBudget(): Promise<void> {
  await bcrypt.compare('timing-equalisation-placeholder', DUMMY_HASH);
}
