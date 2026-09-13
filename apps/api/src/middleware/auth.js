import { clerkClient } from '@clerk/express';
import { isAllowedEmailForRole, isSystemAdmin, normalizeEmail } from '../lib/access.js';
import { verifyAppToken } from '../lib/app-token.js';
import { HttpError, asyncHandler } from '../lib/errors.js';
import { createServiceClient } from '../lib/supabase.js';
import { syncClerkUser } from '../services/clerk-profile.js';
import { assertGlobalIpAllowed, assertTenantActive } from '../services/security.js';

// Keep authentication independent of optional feature migrations. In
// particular, OAuth2 must continue to work while a tenant has not yet applied
// the company Wi-Fi migration that adds `company_id`.
const profileColumns = 'id, clerk_user_id, company_id, office_id, full_name, email, role, is_active, is_temporary_password, trusted_device_hash, trusted_device_set_at, biometric_delete_requested_at';
const temporaryPasswordAllowedRoutes = new Set([
  '/api/v1/me',
  '/api/v1/profile',
  '/api/v1/auth/change-temporary-password'
]);
export const accessDeniedMessage = 'Tài khoản của bạn chưa được cấp quyền truy cập vào hệ thống WorkShift. Vui lòng liên hệ Admin/HR.';

export function denyAccess() {
  return new HttpError(403, accessDeniedMessage, 'ACCESS_NOT_AUTHORIZED');
}

export function isAuthorizedProfile(profile) {
  if (!profile?.is_active) return false;
  if (isSystemAdmin(profile)) return true;
  return isAllowedEmailForRole(profile.email, profile.role);
}

export function assertAuthorizedProfile(profile) {
  if (!isAuthorizedProfile(profile)) throw denyAccess();
  return profile;
}

export async function findAuthorizedProfileByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  const { data, error } = await createServiceClient().from('users')
    .select(profileColumns)
    .eq('email', normalizedEmail)
    .maybeSingle();
  if (error) throw new HttpError(502, 'Không thể tải hồ sơ WorkShift.', 'DATABASE_ERROR');
  return assertAuthorizedProfile(data);
}

async function findProfileByClerkUserId(clerkUserId) {
  const { data, error } = await createServiceClient().from('users')
    .select(profileColumns)
    .eq('clerk_user_id', clerkUserId)
    .maybeSingle();
  if (error) throw new HttpError(502, 'Không thể tải hồ sơ WorkShift.', 'DATABASE_ERROR');
  return data;
}

async function linkExistingProfile(profile, clerkUserId) {
  if (profile.clerk_user_id && profile.clerk_user_id !== clerkUserId) throw denyAccess();
  if (profile.clerk_user_id === clerkUserId) return profile;
  const { data, error } = await createServiceClient().from('users')
    .update({ clerk_user_id: clerkUserId })
    .eq('id', profile.id)
    .select(profileColumns)
    .single();
  if (error || !data) throw new HttpError(502, 'Không thể liên kết tài khoản OAuth2.', 'DATABASE_ERROR');
  return data;
}

// OAuth2 identities must map to an authorized database profile. A just-created
// Clerk user is provisioned synchronously when the asynchronous webhook has
// not arrived yet.
export async function resolveAuthorizedClerkProfile(clerkUserId) {
  const user = await clerkClient.users.getUser(clerkUserId);
  const email = normalizeEmail(user.primaryEmailAddress?.emailAddress);
  if (!email) throw denyAccess();

  let profile = await findProfileByClerkUserId(clerkUserId);
  if (!profile) {
    const { data, error } = await createServiceClient().from('users')
      .select(profileColumns)
      .eq('email', email)
      .maybeSingle();
    if (error) throw new HttpError(502, 'Không thể tải hồ sơ WorkShift.', 'DATABASE_ERROR');
    profile = data ? await linkExistingProfile(data, clerkUserId) : null;
  }
  if (!profile) {
    await syncClerkUser(user);
    profile = await findProfileByClerkUserId(clerkUserId);
  }
  if (!profile || normalizeEmail(profile.email) !== email) throw denyAccess();
  return assertAuthorizedProfile(profile);
}

function bearerToken(req) {
  const value = req.get('authorization');
  return value?.startsWith('Bearer ') ? value.slice(7).trim() : null;
}

export const requireAuth = asyncHandler(async (req, _res, next) => {
  const payload = verifyAppToken(bearerToken(req));
  await assertGlobalIpAllowed(req);
  if (!payload) throw new HttpError(401, 'Phiên đăng nhập đã hết hạn.', 'UNAUTHENTICATED');
  const { data, error } = await createServiceClient().from('users')
    .select(profileColumns)
    .eq('id', payload.sub)
    .maybeSingle();
  if (error) throw new HttpError(502, 'Không thể tải hồ sơ WorkShift.', 'DATABASE_ERROR');
  req.profile = assertAuthorizedProfile(data);
  await assertTenantActive(req.profile);
  // A temporary credential can establish a session only to replace itself.
  // The server enforces this so the requirement cannot be bypassed in the UI.
  const route = `${req.baseUrl}${req.path}`.replace(/\/$/, '') || '/';
  if (req.profile.is_temporary_password && !temporaryPasswordAllowedRoutes.has(route)) {
    throw new HttpError(403, 'Bạn phải đổi mật khẩu tạm thời trước khi tiếp tục.', 'TEMPORARY_PASSWORD_CHANGE_REQUIRED');
  }
  next();
});

export function requireRoles(...roles) {
  return (req, _res, next) => {
    const { profile } = req;
    if (!profile || !roles.includes(profile.role) || (profile.role === 'ADMIN' && !isSystemAdmin(profile))) {
      next(new HttpError(403, 'Bạn không có quyền thực hiện thao tác này.', 'FORBIDDEN'));
      return;
    }
    next();
  };
}
