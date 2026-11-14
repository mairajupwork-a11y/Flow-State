/**
 * Two-factor sign-in codes (TOTP, RFC 6238) — the 6-digit codes from Google
 * Authenticator, Microsoft Authenticator, Authy, 1Password and similar apps.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const newSecret = () => base32Encode(randomBytes(20));

/** The code for one 30-second step. `algo` defaults to SHA-1, which every authenticator app uses. */
export function codeAt(secret, step, { digits = 6, algo = 'sha1', key = null } = {}) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac(algo, key ?? base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  const bin = ((mac[offset] & 127) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/** Accepts the current code and one step either side (clock drift). Returns the matched step or -1. */
export function verifyCode(secret, code, now = Date.now()) {
  const clean = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return -1;
  const step = Math.floor(now / 30000);
  for (const s of [step, step - 1, step + 1]) {
    const want = Buffer.from(codeAt(secret, s));
    if (timingSafeEqual(want, Buffer.from(clean))) return s;
  }
  return -1;
}

export const otpauthUri = (secret, email) =>
  `otpauth://totp/${encodeURIComponent(`WorkMars:${email}`)}?secret=${secret}&issuer=WorkMars&algorithm=SHA1&digits=6&period=30`;

const hashCode = (c) => createHash('sha256').update(String(c).toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');
/** Ten one-time recovery codes like "7KQ2-M9XD"; only their hashes are stored. */
export function newRecoveryCodes() {
  const codes = Array.from({ length: 10 }, () => { const s = base32Encode(randomBytes(5)).slice(0, 8); return `${s.slice(0, 4)}-${s.slice(4)}`; });
  return { codes, hashes: codes.map(hashCode) };
}
/** Returns the remaining hashes if `code` is an unused recovery code, else null. */
export function useRecoveryCode(hashesJson, code) {
  let hashes = [];
  try { hashes = JSON.parse(hashesJson || '[]'); } catch { /* none */ }
  const h = hashCode(code);
  const i = hashes.indexOf(h);
  return i < 0 ? null : hashes.filter((_, k) => k !== i);
}
