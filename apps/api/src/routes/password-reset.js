import { clerkClient } from '@clerk/express';
import { Router } from 'express';
import { z } from 'zod';
import { getConfig } from '../lib/config.js';
import { asyncHandler, HttpError } from '../lib/errors.js';
import { formatClerkError } from '../lib/passwords.js';
import { createServiceClient } from '../lib/supabase.js';
import { audit, clientIp } from '../services/audit.js';
import { sendPasswordResetOtpEmail } from '../services/notifications.js';
import { consumeResetCode, findResetProfile, issueResetCode, parseIdentifier, verifyResetCode } from '../services/password-reset.js';
import { sendPasswordResetOtpSms } from '../services/sms.js';

// Answers never depend on whether the identifier has an account: every request
// gets the same reply after the same minimum time, and every failed
// confirmation the same error. Sending mail takes time, so without the floor
// the response time alone would reveal an account.
export const passwordResetTiming = { requestMinimumMs: 3_000, confirmFailureMinimumMs: 1_000 };

const identifierSchema = z.string().trim().min(3).max(255);
const requestSchema = z.object({ identifier: identifierSchema }).strict();
const confirmSchema = z.object({
  identifier: identifierSchema,
  otpCode: z.string().regex(/^\d{6}$/),
  newPassword: z.string().min(15, 'Mật khẩu mới phải có ít nhất 15 ký tự.').max(256)
}).strict();

function waitUntilElapsed(startedAt, minimumMs) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, minimumMs - (Date.now() - startedAt))));
}

function invalidIdentifier() {
  return new HttpError(422, 'Vui lòng nhập email hoặc số điện thoại di động Việt Nam hợp lệ.', 'INVALID_IDENTIFIER');
}

export const passwordResetRouter = Router();

passwordResetRouter.post('/request-otp', asyncHandler(async (req, res) => {
  const startedAt = Date.now();
  const identifier = parseIdentifier(requestSchema.parse(req.body).identifier);
  if (!identifier) throw invalidIdentifier();
  const { smtp, sms } = getConfig();
  if (!smtp && !sms) throw new HttpError(503, 'Chức năng khôi phục mật khẩu chưa được cấu hình. Vui lòng liên hệ quản trị viên.', 'PASSWORD_RESET_UNAVAILABLE');

  try {
    const profile = await findResetProfile(identifier);
    const code = profile && await issueResetCode(profile);
    if (code) {
      // SMS goes to the number the user typed, which matched their profile.
      if (identifier.phone && sms) await sendPasswordResetOtpSms({ to: identifier.phone, code });
      else await sendPasswordResetOtpEmail({ to: profile.email, fullName: profile.full_name, code });
      await audit(profile.id, 'PASSWORD_RESET_CODE_SENT', { channel: identifier.phone && sms ? 'SMS' : 'EMAIL' }, clientIp(req));
    }
  } catch (error) {
    // These failures only happen for existing accounts, so they are logged
    // for the operator and never change the reply.
    console.error('Password reset code was not delivered.', error);
  }

  await waitUntilElapsed(startedAt, passwordResetTiming.requestMinimumMs);
  res.json({
    message: 'Nếu thông tin khớp với một tài khoản đang hoạt động, mã xác thực đã được gửi.',
    data: { retryAfterSeconds: 60 }
  });
}));

passwordResetRouter.post('/confirm', asyncHandler(async (req, res) => {
  const startedAt = Date.now();
  const body = confirmSchema.parse(req.body);
  const identifier = parseIdentifier(body.identifier);
  if (!identifier) throw invalidIdentifier();

  const profile = await findResetProfile(identifier);
  if (!profile || !(await verifyResetCode(profile, body.otpCode))) {
    await waitUntilElapsed(startedAt, passwordResetTiming.confirmFailureMinimumMs);
    throw new HttpError(400, 'Mã xác thực không đúng hoặc đã hết hạn.', 'INVALID_OTP');
  }

  try {
    await clerkClient.users.updateUser(profile.clerk_user_id, { password: body.newPassword, signOutOfOtherSessions: true });
  } catch (error) {
    // The code stays valid so the user can retry with a stronger password.
    throw new HttpError(422, formatClerkError(error), 'PASSWORD_REJECTED');
  }
  await consumeResetCode(profile);
  if (profile.is_temporary_password) {
    await clerkClient.users.updateUserMetadata(profile.clerk_user_id, { publicMetadata: { workshiftTemporaryPassword: false } });
    const { error } = await createServiceClient().from('users').update({ is_temporary_password: false }).eq('id', profile.id);
    if (error) throw new HttpError(502, 'Không thể hoàn tất đặt lại mật khẩu.', 'DATABASE_ERROR');
  }
  await audit(profile.id, 'PASSWORD_RESET_COMPLETED', {}, clientIp(req));
  res.json({ message: 'Đặt lại mật khẩu thành công. Bạn có thể đăng nhập bằng mật khẩu mới.' });
}));
