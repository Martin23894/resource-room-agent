// Password hashing using Node's built-in crypto.scrypt — no extra
// native dependency needed. scrypt is memory-hard and is one of the
// algorithms recommended by OWASP for password storage.
//
// Encoded format:    scrypt$N$r$p$<saltHex>$<hashHex>
// Default cost:      N=16384, r=8, p=1   (~80–120ms on commodity hardware)
// Salt:              16 random bytes
// Derived key:       64 bytes
//
// Comparing hashes uses crypto.timingSafeEqual to avoid leaking the
// per-byte position of the first mismatch.

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);

const N = 16384;
const r = 8;
const p = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;
// scrypt's internal buffer scales with N*r — at N=16384, r=8 that's 16 MiB,
// well above the default 32 MiB cap, but bumping it once here makes the
// boundary explicit and lets us raise N later without surprises.
const MAXMEM = 64 * 1024 * 1024;

// OWASP guidance for 2024+: passphrases should be 8+ chars; we go to 10
// because teachers often pick "Password1" otherwise. The cap stops abuse
// of the hash function with a 1MB body.
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 200;

/** Validate a password before hashing. Throws with a user-safe message. */
export function validatePassword(password) {
  if (typeof password !== 'string') {
    throw new Error('Password must be a string');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`Password must be at most ${MAX_PASSWORD_LENGTH} characters`);
  }
  // Reject pure whitespace.
  if (!/\S/.test(password)) {
    throw new Error('Password cannot be only whitespace');
  }
}

/** Hash a plaintext password. Returns the encoded string to store in DB. */
export async function hashPassword(password) {
  validatePassword(password);
  const salt = randomBytes(SALT_LEN);
  const derived = await scrypt(password, salt, KEY_LEN, { N, r, p, maxmem: MAXMEM });
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/**
 * Verify a plaintext password against a stored encoded hash.
 * Returns false on any malformed input or mismatch — never throws.
 */
export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || typeof encoded !== 'string') return false;
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const cN = Number(parts[1]);
  const cR = Number(parts[2]);
  const cP = Number(parts[3]);
  if (!Number.isInteger(cN) || !Number.isInteger(cR) || !Number.isInteger(cP)) return false;
  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[4], 'hex');
    expected = Buffer.from(parts[5], 'hex');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;
  let derived;
  try {
    derived = await scrypt(password, salt, expected.length, {
      N: cN, r: cR, p: cP, maxmem: MAXMEM,
    });
  } catch {
    return false;
  }
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
