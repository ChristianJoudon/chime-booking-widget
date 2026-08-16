import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * scrypt from node:crypto rather than bcrypt or argon2, so administrator
 * sign-in adds no native dependency to a server that currently has none.
 *
 * Parameters are stored with each hash, so they can be raised later without
 * invalidating passwords set under the old ones.
 */
const CURRENT = { N: 2 ** 15, r: 8, p: 1 };
const KEY_LENGTH = 64;
// scrypt needs roughly 128 * N * r bytes; the default 32MB cap is below what
// N = 2^15 requires, so state it explicitly rather than tripping over it.
const MAX_MEMORY = 128 * CURRENT.N * CURRENT.r * 2;

export const MINIMUM_PASSWORD_LENGTH = 12;

/** Encoded as scrypt$N$r$p$salt_b64$hash_b64. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password.normalize('NFKC'), salt, KEY_LENGTH, {
    ...CURRENT,
    maxmem: MAX_MEMORY,
  });
  return [
    'scrypt',
    CURRENT.N,
    CURRENT.r,
    CURRENT.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

/**
 * Always performs the full derivation before comparing, and compares in
 * constant time, so a wrong password costs the same as a right one.
 */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  // Refuse absurd stored parameters rather than letting a tampered row consume
  // the process.
  if (N > 2 ** 20 || r > 32 || p > 16) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], 'base64');
    expected = Buffer.from(parts[5], 'base64');
  } catch {
    return false;
  }
  if (!salt.length || !expected.length) return false;

  const derived = await scryptAsync(password.normalize('NFKC'), salt, expected.length, {
    N,
    r,
    p,
    maxmem: 128 * N * r * 2,
  });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/**
 * Rejects only what is genuinely unsafe. Length dominates strength, so this
 * checks length and obvious reuse of the account name rather than imposing
 * character-class rules that push people toward predictable substitutions.
 */
export function describePasswordProblem(password: string, email?: string): string | null {
  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    return `Password must be at least ${MINIMUM_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 512) {
    return 'Password must be shorter than 512 characters.';
  }
  if (email && password.toLowerCase().includes(email.split('@')[0].toLowerCase())) {
    return 'Password must not contain the account name.';
  }
  return null;
}
