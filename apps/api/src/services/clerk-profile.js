import { isAllowedEmailForRole, isSystemAdminEmail, normalizeEmail } from '../lib/access.js';
import { HttpError } from '../lib/errors.js';
import { createServiceClient } from '../lib/supabase.js';

const profileColumns = 'id, clerk_user_id, office_id, full_name, email, role, is_active, is_temporary_password';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function primaryEmail(user) {
  const addresses = Array.isArray(user.email_addresses) ? user.email_addresses : user.emailAddresses;
  const primaryId = user.primary_email_address_id ?? user.primaryEmailAddressId;
  const address = Array.isArray(addresses) ? addresses.find((item) => item.id === primaryId) ?? addresses[0] : null;
  return normalizeEmail(address?.email_address ?? address?.emailAddress);
}

function fullName(user, email) {
  const firstNameValue = user.first_name ?? user.firstName;
  const lastNameValue = user.last_name ?? user.lastName;
  const firstName = typeof firstNameValue === 'string' ? firstNameValue.trim() : '';
  const lastName = typeof lastNameValue === 'string' ? lastNameValue.trim() : '';
  return [firstName, lastName].filter(Boolean).join(' ') || user.username || email.split('@')[0] || 'WorkShift user';
}

function invitationMetadata(user) {
  const metadata = user.public_metadata ?? user.publicMetadata;
  if (!metadata?.workshiftProvisioned || !['HR', 'EMPLOYEE'].includes(metadata.workshiftRole)) return null;
  const officeId = typeof metadata.workshiftOfficeId === 'string' && uuidPattern.test(metadata.workshiftOfficeId)
    ? metadata.workshiftOfficeId
    : null;
  const name = typeof metadata.workshiftFullName === 'string' && metadata.workshiftFullName.trim().length >= 2
    ? metadata.workshiftFullName.trim().slice(0, 100)
    : null;
  const companyId = typeof metadata.workshiftCompanyId === 'string' && uuidPattern.test(metadata.workshiftCompanyId)
    ? metadata.workshiftCompanyId
    : null;
  return {
    role: metadata.workshiftRole,
    officeId,
    companyId,
    name,
    isTemporaryPassword: metadata.workshiftTemporaryPassword === true
  };
}

// Works with both Clerk webhooks (snake_case) and Backend API users
// (camelCase), allowing OAuth exchange to provision a profile without waiting
// for the asynchronously delivered webhook.
export async function syncClerkUser(user) {
  const email = primaryEmail(user);
  if (!email) return { status: 'pending_email' };
  const supabase = createServiceClient();
  const { data: existing, error: lookupError } = await supabase.from('users')
    .select(profileColumns)
    .eq('clerk_user_id', user.id)
    .maybeSingle();
  if (lookupError) throw new HttpError(502, 'Không thể tải hồ sơ WorkShift.', 'DATABASE_ERROR');

  if (existing) {
    const validEmail = isAllowedEmailForRole(email, existing.role);
    const update = validEmail
      ? { full_name: fullName(user, email), email, ...(isSystemAdminEmail(email) ? { role: 'ADMIN', is_active: true } : {}) }
      : { is_active: false };
    const { error } = await supabase.from('users').update(update).eq('id', existing.id);
    if (error) throw new HttpError(409, 'Không thể đồng bộ hồ sơ tài khoản.', 'PROFILE_SYNC_CONFLICT');
    return { status: 'synced' };
  }

  const invitation = invitationMetadata(user);
  const role = isSystemAdminEmail(email) ? 'ADMIN' : invitation?.role;
  if (!role || !isAllowedEmailForRole(email, role)) return { status: 'not_authorized' };
  const profile = {
    clerk_user_id: user.id,
    office_id: invitation?.officeId ?? null,
    company_id: invitation?.companyId ?? null,
    full_name: invitation?.name ?? fullName(user, email),
    email,
    role,
    is_active: true,
    is_temporary_password: invitation?.isTemporaryPassword ?? false
  };
  const { error } = await supabase.from('users').insert(profile);
  if (error?.code === '23505') return { status: 'synced' };
  if (error) throw new HttpError(502, 'Không thể tạo hồ sơ WorkShift.', 'DATABASE_ERROR');
  return { status: 'provisioned' };
}

export async function deactivateClerkUser(clerkUserId) {
  const { error } = await createServiceClient().from('users').update({ is_active: false }).eq('clerk_user_id', clerkUserId);
  if (error) throw new HttpError(502, 'Không thể vô hiệu hóa hồ sơ WorkShift.', 'DATABASE_ERROR');
}
