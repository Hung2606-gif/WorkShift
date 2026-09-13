import { createHmac, timingSafeEqual } from 'node:crypto';
import { getConfig } from './config.js';

const issuer = 'workshift-api';
const lifetimeSeconds = 8 * 60 * 60;

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signature(value) {
  return createHmac('sha256', getConfig().appJwtSecret).update(value).digest('base64url');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function issueAppToken(profile, { expiresInSeconds = lifetimeSeconds, impersonationSessionId } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: issuer,
    sub: profile.id,
    role: profile.role,
    iat: now,
    exp: now + expiresInSeconds,
    ...(impersonationSessionId && { impersonationSessionId })
  };
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}`;
  return { accessToken: `${unsigned}.${signature(unsigned)}`, expiresIn: expiresInSeconds };
}

export function verifyAppToken(token) {
  if (typeof token !== 'string') return null;
  const [encodedHeader, encodedPayload, receivedSignature, ...extra] = token.split('.');
  if (!encodedHeader || !encodedPayload || !receivedSignature || extra.length) return null;
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  if (!safeEqual(signature(unsigned), receivedSignature)) return null;
  try {
    const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (header.alg !== 'HS256' || header.typ !== 'JWT' || payload.iss !== issuer || typeof payload.sub !== 'string' || !Number.isInteger(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
