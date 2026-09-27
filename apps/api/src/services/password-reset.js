import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { clerkClient } from '@clerk/express';
import { normalizeEmail } from '../lib/access.js';
import { getConfig } from '../lib/config.js';
import { HttpError } from '../lib/errors.js';
import { normalizeVietnameseMobile } from '../lib/phone.js';
import { createServiceClient } from '../lib/supabase.js';
import { isAuthorizedProfile } from '../middleware/auth.js';

export const OTP_TTL_MS = 5 * 60_000;
export const OTP_RESEND_COOLDOWN_MS = 60_000;
export const OTP_DAILY_LIMIT = 5;
export const OTP_MAX_ATTEMPTS = 5;

// Reset state lives in the Clerk user's privateMetadata, which only the
// backend can read. Only a keyed hash of the code is stored.
const stateKey = 'workshiftPasswordReset';

/** `{ email }` or `{ phone }` (E.164) for what the user typed, or null. */
export function parseIdentifier(value) {
  if (typeof value !== 'string') return null;
  if (value.includes('@')) {
    const email = normalizeEmail(value);
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 255 ? { email } : null;
  }
  const phone = normalizeVietnameseMobile(value);
  return phone ? { phone } : null;
}

/** The single active, authorized account the identifier belongs to, or null. */
export async function findResetProfile(identifier) {
  let query = createServiceClient().from('users')
    .select('id, clerk_user_id, email, full_name, role, is_active, is_temporary_password');
  // Profiles may store the local 0xxx form or E.164.
  query = identifier.email
    ? query.eq('email', identifier.email)
    : query.in('phone', [identifier.phone, `0${identifier.phone.slice(3)}`]);
  const { data, error } = await query.limit(2);
  if (error) throw new HttpError(502, 'Không thể tải hồ sơ WorkShift.', 'DATABASE_ERROR');
  // A phone number shared by two profiles must not reset whichever comes first.
  if (data.length !== 1) return null;
  const [profile] = data;
  return profile.clerk_user_id && isAuthorizedProfile(profile) ? profile : null;
}

function hashCode(profileId, code) {
  return createHmac('sha256', getConfig().otpPepper).update(`password-reset:${profileId}:${code}`).digest();
}

async function readState(profile) {
  const user = await clerkClient.users.getUser(profile.clerk_user_id);
  return user.privateMetadata?.[stateKey] ?? null;
}

function writeState(profile, state) {
  return clerkClient.users.updateUserMetadata(profile.clerk_user_id, { privateMetadata: { [stateKey]: state } });
}

/**
 * Creates and stores a new 6-digit code, or returns null while the resend
 * cooldown or the daily limit applies.
 */
export async function issueResetCode(profile, now = Date.now()) {
  const state = await readState(profile);
  const day = new Date(now).toISOString().slice(0, 10);
  const sentToday = state?.day === day ? state.sentToday : 0;
  if (state?.sentAt && now - state.sentAt < OTP_RESEND_COOLDOWN_MS) return null;
  if (sentToday >= OTP_DAILY_LIMIT) return null;

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await writeState(profile, {
    codeHash: hashCode(profile.id, code).toString('hex'),
    expiresAt: now + OTP_TTL_MS,
    attempts: 0,
    sentAt: now,
    day,
    sentToday: sentToday + 1
  });
  return code;
}

/** True only for the current, unexpired code; a wrong code uses up an attempt. */
export async function verifyResetCode(profile, code, now = Date.now()) {
  const state = await readState(profile);
  if (!state?.codeHash || now > state.expiresAt || state.attempts >= OTP_MAX_ATTEMPTS) return false;
  if (timingSafeEqual(Buffer.from(state.codeHash, 'hex'), hashCode(profile.id, code))) return true;
  await writeState(profile, { ...state, attempts: state.attempts + 1 });
  return false;
}

/** Makes the code single-use while keeping the daily send count. */
export async function consumeResetCode(profile) {
  const state = await readState(profile);
  await writeState(profile, { ...state, codeHash: null, expiresAt: 0 });
}
