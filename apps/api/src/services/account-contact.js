import { clerkClient } from '@clerk/express';
import { normalizeEmail } from '../lib/access.js';
import { HttpError } from '../lib/errors.js';
import { formatClerkError } from '../lib/passwords.js';

export function normalizePhone(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

/**
 * Re-authenticate a signed-in user before a security-sensitive contact change.
 * Password verification is intentionally server-side, so a browser cannot
 * bypass it by calling the profile endpoint directly.
 */
export async function verifyCurrentPassword(profile, currentPassword) {
  if (!currentPassword) {
    throw new HttpError(422, 'Vui lòng nhập mật khẩu hiện tại để thay đổi email hoặc số điện thoại.', 'CURRENT_PASSWORD_REQUIRED');
  }
  if (!profile?.clerk_user_id) {
    throw new HttpError(409, 'Tài khoản chưa sẵn sàng để xác minh mật khẩu. Vui lòng liên hệ quản trị viên.', 'CLERK_ACCOUNT_NOT_LINKED');
  }

  try {
    await clerkClient.users.verifyPassword({ userId: profile.clerk_user_id, password: currentPassword });
  } catch {
    throw new HttpError(401, 'Mật khẩu hiện tại không đúng.', 'INVALID_CURRENT_PASSWORD');
  }
}

/**
 * Makes an email the Clerk primary identifier. WorkShift deliberately keeps a
 * previous Clerk email as a recovery identity; API password sign-in is still
 * gated by the email stored in the WorkShift users table.
 */
export async function promoteClerkEmailAddress({ clerkUserId, email }) {
  let clerkUser;
  try {
    clerkUser = await clerkClient.users.getUser(clerkUserId);
  } catch (error) {
    console.error('Unable to load Clerk user before email update.', error);
    throw new HttpError(502, 'Không thể đồng bộ email với hệ thống xác thực.', 'CLERK_SYNC_FAILED');
  }

  const emailAddresses = clerkUser.emailAddresses ?? clerkUser.email_addresses ?? [];
  const primaryEmailAddressId = clerkUser.primaryEmailAddressId ?? clerkUser.primary_email_address_id ?? null;
  const nextEmail = normalizeEmail(email);
  const existingAddress = emailAddresses.find((address) => normalizeEmail(address.emailAddress ?? address.email_address) === nextEmail);

  try {
    const address = existingAddress
      ? await clerkClient.emailAddresses.updateEmailAddress(existingAddress.id, { verified: true, primary: true })
      : await clerkClient.emailAddresses.createEmailAddress({
        userId: clerkUserId,
        emailAddress: nextEmail,
        verified: true,
        primary: true
      });

    return {
      previousPrimaryEmailAddressId: primaryEmailAddressId,
      nextEmailAddressId: address.id
    };
  } catch (error) {
    console.error('Unable to promote Clerk email address.', error);
    throw new HttpError(422, formatClerkError(error), 'EMAIL_UPDATE_REJECTED');
  }
}

// There is no database transaction spanning Clerk and Supabase. If the local
// update fails after Clerk succeeds, restore the previous primary identifier
// as a best-effort compensation.
export async function restoreClerkPrimaryEmail({ previousPrimaryEmailAddressId, nextEmailAddressId }) {
  if (!previousPrimaryEmailAddressId || previousPrimaryEmailAddressId === nextEmailAddressId) return;
  try {
    await clerkClient.emailAddresses.updateEmailAddress(previousPrimaryEmailAddressId, { primary: true });
  } catch (error) {
    console.error('Unable to restore previous Clerk primary email after database failure.', error);
  }
}
