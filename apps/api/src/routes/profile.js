import { Router } from 'express';
import { z } from 'zod';
import { isAllowedEmailForRole, normalizeEmail } from '../lib/access.js';
import { asyncHandler, HttpError } from '../lib/errors.js';
import { createServiceClient } from '../lib/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { audit, clientIp } from '../services/audit.js';
import { normalizePhone, promoteClerkEmailAddress, restoreClerkPrimaryEmail, verifyCurrentPassword } from '../services/account-contact.js';
import { sendContactDetailsChangedEmail } from '../services/notifications.js';

const ownProfileUpdateSchema = z.object({
  fullName: z.string().trim().min(2).max(100).optional(),
  email: z.string().trim().email().max(100).optional(),
  phone: z.string().trim().min(7).max(30).regex(/^[0-9+().\-\s]+$/, 'Số điện thoại không đúng định dạng.').nullable().optional(),
  currentPassword: z.string().max(256).optional()
}).strict();

export const profileRouter = Router();
profileRouter.use(requireAuth);

async function sendProfile(req, res) {
  const { profile } = req;
  const supabase = createServiceClient();
  const [{ data: office }] = await Promise.all([
    profile.office_id
      ? supabase.from('offices').select('id, name, latitude, longitude, radius_meters').eq('id', profile.office_id).maybeSingle()
      : Promise.resolve({ data: null })
  ]);
  const { clerk_user_id: _clerkUserId, trusted_device_hash: _trustedDeviceHash, ...safeProfile } = profile;
  res.json({ data: { ...safeProfile, office } });
}

// `/me` is the current API contract. Keep `/profile` as a protected alias so
// existing clients and smoke-test scripts do not receive a misleading 404.
profileRouter.get(['/me', '/profile'], asyncHandler(sendProfile));

// This is intentionally a shared self-service endpoint for HR and EMPLOYEE.
// It supersedes the employee-only contact update route so the re-authentication
// rule cannot be bypassed by calling a role-specific API directly.
profileRouter.patch('/profile', asyncHandler(async (req, res) => {
  const body = ownProfileUpdateSchema.parse(req.body);
  const { profile } = req;
  const currentEmail = normalizeEmail(profile.email);
  const currentPhone = normalizePhone(profile.phone);
  const nextEmail = body.email === undefined ? currentEmail : normalizeEmail(body.email);
  const nextPhone = body.phone === undefined ? currentPhone : normalizePhone(body.phone);
  const nextFullName = body.fullName === undefined ? profile.full_name : body.fullName;
  const emailChanged = nextEmail !== currentEmail;
  const phoneChanged = nextPhone !== currentPhone;
  const fullNameChanged = nextFullName !== profile.full_name;

  if (!emailChanged && !phoneChanged && !fullNameChanged) {
    throw new HttpError(422, 'Không có thông tin nào thay đổi.', 'NO_PROFILE_CHANGES');
  }

  const contactChanged = emailChanged || phoneChanged;
  if (contactChanged) {
    if (!['HR', 'EMPLOYEE'].includes(profile.role)) {
      throw new HttpError(403, 'Chỉ tài khoản HR hoặc nhân viên được phép tự thay đổi thông tin liên hệ.', 'CONTACT_CHANGE_FORBIDDEN');
    }
    await verifyCurrentPassword(profile, body.currentPassword);
    if (emailChanged && !isAllowedEmailForRole(nextEmail, profile.role)) {
      const requiredDomain = profile.role === 'HR' ? '@company.com' : '@gmail.com';
      throw new HttpError(422, `Email ${profile.role} phải thuộc domain ${requiredDomain}.`, 'EMAIL_DOMAIN_FORBIDDEN');
    }
  }

  const supabase = createServiceClient();
  if (emailChanged) {
    const { data: existingProfile, error: lookupError } = await supabase.from('users')
      .select('id')
      .eq('email', nextEmail)
      .neq('id', profile.id)
      .maybeSingle();
    if (lookupError) throw new HttpError(502, 'Không thể kiểm tra email mới.', 'DATABASE_ERROR');
    if (existingProfile) throw new HttpError(409, 'Email này đã được sử dụng bởi một tài khoản WorkShift khác.', 'EMAIL_ALREADY_IN_USE');
  }

  let clerkEmailChange;
  if (emailChanged) {
    clerkEmailChange = await promoteClerkEmailAddress({ clerkUserId: profile.clerk_user_id, email: nextEmail });
  }

  const update = {
    ...(fullNameChanged && { full_name: nextFullName }),
    ...(emailChanged && { email: nextEmail }),
    ...(phoneChanged && { phone: nextPhone })
  };
  const { data, error } = await supabase.from('users')
    .update(update)
    .eq('id', profile.id)
    .select('id, full_name, email, phone')
    .single();
  if (error || !data) {
    if (clerkEmailChange) await restoreClerkPrimaryEmail(clerkEmailChange);
    if (error?.code === '23505') {
      throw new HttpError(409, 'Email này đã được sử dụng bởi một tài khoản WorkShift khác.', 'EMAIL_ALREADY_IN_USE');
    }
    throw new HttpError(502, 'Không thể cập nhật hồ sơ.', 'DATABASE_ERROR');
  }

  let notificationSent = false;
  if (contactChanged) {
    try {
      await sendContactDetailsChangedEmail({
        recipients: emailChanged ? [currentEmail, nextEmail] : [currentEmail],
        fullName: data.full_name,
        emailChanged,
        phoneChanged
      });
      notificationSent = true;
    } catch (notificationError) {
      // A mail outage must not undo an already-completed identity change. The
      // audit record below preserves an operational trace for follow-up.
      console.warn('Unable to send profile contact-change confirmation.', notificationError);
    }
  }

  await audit(profile.id, 'SELF_PROFILE_UPDATED', {
    fields: Object.keys(update),
    emailChanged,
    phoneChanged,
    notificationSent
  }, clientIp(req));
  res.json({
    message: notificationSent ? 'Đã cập nhật hồ sơ và gửi email xác nhận.' : 'Đã cập nhật hồ sơ thành công.',
    data: { ...data, notificationSent }
  });
}));
