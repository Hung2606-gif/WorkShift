import { createServiceClient } from '../lib/supabase.js';

export async function audit(actorUserId, action, metadata, ipAddress) {
  const { error } = await createServiceClient().from('audit_logs').insert({
    actor_user_id: actorUserId,
    action,
    metadata,
    ip_address: ipAddress ?? null
  });
  if (error) console.error('Unable to write audit log:', error.message);
}

/**
 * Resolve the public client address after Express has applied its `trust proxy`
 * policy.  Never read X-Forwarded-For directly here: it can be forged when the
 * request did not come through a trusted reverse proxy.
 */
export function clientIp(req, legacyFallback) {
  if (!req) return legacyFallback || null;
  if (typeof req === 'string') return req.split(',')[0]?.trim() || legacyFallback || null;
  const ip = req.ip || req.socket?.remoteAddress;
  if (!ip) return legacyFallback || null;

  // Node reports IPv4 peers as IPv4-mapped IPv6 addresses in some deployments.
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}
