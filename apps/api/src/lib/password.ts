import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

// Deliberately explicit rather than defaulted, so a future change is a decision.
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const FORMAT = 'scrypt$1';

/**
 * scrypt from Node's standard library rather than argon2.
 *
 * argon2 needs a native build that fails on minimal images and in CI sandboxes,
 * and a password hash that cannot be installed is a worse outcome than a
 * slightly less fashionable KDF. Local credential auth is development-only in
 * any case: loadConfig refuses AUTH_DRIVER=local in production.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `${FORMAT}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) {
    // Still do the work: an account with no password must not answer faster
    // than one with a password, or the timing reveals which accounts exist.
    await scrypt(password, randomBytes(SALT_LENGTH), KEY_LENGTH);
    return false;
  }
  const [scheme, version, saltB64, hashB64] = stored.split('$');
  if (`${scheme}$${version}` !== FORMAT || !saltB64 || !hashB64) return false;

  const derived = await scrypt(password, Buffer.from(saltB64, 'base64'), KEY_LENGTH);
  const expected = Buffer.from(hashB64, 'base64');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
