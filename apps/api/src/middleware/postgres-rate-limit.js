import { createHash } from 'node:crypto';
import { HttpError } from '../lib/errors.js';
import { createServiceClient } from '../lib/supabase.js';

const localBuckets = new Map();

function clientKey(req, scope) {
  const rawIp = String(req.header('x-forwarded-for') ?? req.ip ?? 'unknown').split(',')[0].trim();
  return createHash('sha256').update(`${scope}:${rawIp}`).digest('hex');
}

function consumeLocal(key, limit, windowMs) {
  const now = Date.now();
  const bucket = localBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    localBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

/**
 * A small distributed limiter backed by PostgreSQL. It avoids Redis while
 * remaining consistent across multiple Node/Vercel API instances.
 */
export function postgresRateLimit({ scope, limit, windowMs }) {
  const windowSeconds = Math.ceil(windowMs / 1_000);
  return (req, _res, next) => {
    void (async () => {
      const key = clientKey(req, scope);
      const { data: allowed, error } = await createServiceClient().rpc('consume_api_rate_limit', {
        p_key_hash: key, p_limit: limit, p_window_seconds: windowSeconds
      });
      // Keep login and recovery available while a new deployment is waiting for
      // its database migration. Production should still apply the migration to
      // get one shared limit across every API instance.
      const isAllowed = error ? consumeLocal(key, limit, windowMs) : allowed;
      if (error) console.warn('PostgreSQL rate limiter unavailable; using local fallback.', error.code);
      if (!isAllowed) throw new HttpError(429, 'Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.', 'RATE_LIMITED');
      next();
    })().catch(next);
  };
}
