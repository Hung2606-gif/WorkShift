import { HttpError } from '../lib/errors.js';
import { createServiceClient } from '../lib/supabase.js';

function requestIp(req) {
  const ip = req.ip || req.socket?.remoteAddress;
  return ip?.startsWith('::ffff:') ? ip.slice(7) : ip;
}

/** Enforce configured global CIDR rules once their migration is present. */
export async function assertGlobalIpAllowed(req) {
  const ip = requestIp(req);
  if (!ip) return;
  const { data, error } = await createServiceClient().rpc('is_global_ip_allowed', { p_ip: ip });
  // Keep existing deployments usable until the system-admin migration is run.
  if (error?.code === 'PGRST202') return;
  if (error) throw new HttpError(502, 'Không thể kiểm tra chính sách IP toàn cục.', 'GLOBAL_IP_CHECK_FAILED');
  if (data === false) throw new HttpError(403, 'Địa chỉ IP này bị chặn bởi chính sách hệ thống.', 'GLOBAL_IP_DENIED');
}

/** A locked tenant cannot keep using active application sessions. */
export async function assertTenantActive(profile) {
  if (profile.role === 'ADMIN') return;
  const db = createServiceClient();
  const { data: user, error: userError } = await db.from('users').select('company_id').eq('id', profile.id).maybeSingle();
  if (userError?.code === '42703' || userError?.code === 'PGRST204') return;
  if (userError) throw new HttpError(502, 'Không thể kiểm tra trạng thái công ty.', 'TENANT_CHECK_FAILED');
  if (!user?.company_id) throw new HttpError(403, 'Tài khoản chưa được gán vào công ty.', 'COMPANY_NOT_ASSIGNED');
  const { data: company, error: companyError } = await db.from('companies').select('is_active').eq('id', user.company_id).maybeSingle();
  if (companyError?.code === 'PGRST205') return;
  if (companyError) throw new HttpError(502, 'Không thể kiểm tra trạng thái công ty.', 'TENANT_CHECK_FAILED');
  if (!company?.is_active) throw new HttpError(403, 'Công ty của bạn đang bị tạm khóa.', 'COMPANY_LOCKED');
}
