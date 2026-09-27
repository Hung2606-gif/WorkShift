import { clerkClient, getAuth } from '@clerk/express';
import { Router } from 'express';
import { z } from 'zod';
import { issueAppToken } from '../lib/app-token.js';
import { asyncHandler, HttpError } from '../lib/errors.js';
import { findAuthorizedProfileByEmail, resolveAuthorizedClerkProfile } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { createServiceClient } from '../lib/supabase.js';
import { formatClerkError } from '../lib/passwords.js';

const loginSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(1).max(256)
});

const changeTemporaryPasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(8, 'Mật khẩu mới phải có tối thiểu 15 ký tự theo chính sách bảo mật hệ thống.').max(256)
}).refine((value) => value.currentPassword !== value.newPassword, {
  message: 'Mật khẩu mới phải khác mật khẩu tạm thời.',
  path: ['newPassword']
});

function sessionResponse(profile) {
  const token = issueAppToken(profile);
  return {
    data: {
      accessToken: token.accessToken,
      tokenType: 'Bearer',
      expiresIn: token.expiresIn,
      role: profile.role,
      mustChangePassword: Boolean(profile.is_temporary_password)
    }
  };
}

export const authRouter = Router();

// Every failed login gets the same status, message and minimum duration, so a
// response does not reveal whether an email address has an account. Without
// the delay, an unknown email would fail faster because it skips the Clerk call.
export const failedLoginMinimumMs = 1_000;

function invalidLogin() {
  return new HttpError(401, 'Email hoặc mật khẩu không đúng, hoặc tài khoản chưa được cấp quyền truy cập.', 'INVALID_CREDENTIALS');
}

authRouter.post('/login', asyncHandler(async (req, res) => {
  const startedAt = Date.now();
  const body = loginSchema.parse(req.body);
  try {
    // Check the WorkShift authorization record before submitting credentials to
    // Clerk. Unauthorized email addresses never receive an application token.
    const profile = await findAuthorizedProfileByEmail(body.email);
    if (!profile.clerk_user_id) throw invalidLogin();
    try {
      await clerkClient.users.verifyPassword({ userId: profile.clerk_user_id, password: body.password });
    } catch {
      throw invalidLogin();
    }
    res.json(sessionResponse(profile));
  } catch (error) {
    // Service failures are not about the account and stay distinguishable.
    if (!(error instanceof HttpError) || error.status >= 500) throw error;
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, failedLoginMinimumMs - (Date.now() - startedAt))));
    throw invalidLogin();
  }
}));

authRouter.post('/oauth/exchange', asyncHandler(async (req, res) => {
  const { isAuthenticated, userId } = getAuth(req);
  if (!isAuthenticated || !userId) {
    // clerkMiddleware records why it rejected the token, e.g. a token issued by
    // another Clerk instance or by a web origin missing from WEB_ORIGIN.
    console.warn('OAuth exchange rejected:', res.getHeader('x-clerk-auth-reason') ?? 'no session token', res.getHeader('x-clerk-auth-message') ?? '');
    throw new HttpError(401, 'Phiên OAuth2 không hợp lệ.', 'UNAUTHENTICATED');
  }
  const profile = await resolveAuthorizedClerkProfile(userId);
  res.json(sessionResponse(profile));
}));

// HR accounts provisioned by the system must replace their first credential
// before the rest of the protected API becomes available.
authRouter.post('/change-temporary-password', requireAuth, asyncHandler(async (req, res) => {
  const body = changeTemporaryPasswordSchema.parse(req.body);
  const profile = req.profile;
  if (!profile.is_temporary_password) {
    throw new HttpError(409, 'Tài khoản này không có mật khẩu tạm thời cần thay đổi.', 'TEMPORARY_PASSWORD_NOT_ACTIVE');
  }
  if (!profile.clerk_user_id) {
    throw new HttpError(409, 'Tài khoản chưa sẵn sàng để đổi mật khẩu.', 'CLERK_ACCOUNT_NOT_LINKED');
  }
  try {
    await clerkClient.users.verifyPassword({ userId: profile.clerk_user_id, password: body.currentPassword });
  } catch {
    throw new HttpError(401, 'Mật khẩu tạm thời không đúng.', 'INVALID_CREDENTIALS');
  }
  try {
    const clerkUser = await clerkClient.users.getUser(profile.clerk_user_id);
    await clerkClient.users.updateUser(profile.clerk_user_id, {
      password: body.newPassword,
      signOutOfOtherSessions: true,
      publicMetadata: {
        ...(clerkUser.publicMetadata || {}),
        workshiftTemporaryPassword: false
      }
    });
  } catch (error) {
    console.error('Unable to replace temporary password in Clerk.', error);
    throw new HttpError(422, formatClerkError(error), 'PASSWORD_REJECTED');
  }
  const { error } = await createServiceClient().from('users')
    .update({ is_temporary_password: false })
    .eq('id', profile.id);
  if (error) throw new HttpError(502, 'Không thể hoàn tất thay đổi mật khẩu.', 'DATABASE_ERROR');
  res.json({ message: 'Đổi mật khẩu thành công.', data: { isTemporaryPassword: false } });
}));
