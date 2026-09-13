import { clerkClient } from '@clerk/express';
import { Router } from 'express';
import { z } from 'zod';
import { isAllowedEmailForRole, normalizeEmail } from '../lib/access.js';
import { asyncHandler, HttpError } from '../lib/errors.js';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { createServiceClient } from '../lib/supabase.js';
import { audit, clientIp } from '../services/audit.js';
import { issueAppToken } from '../lib/app-token.js';
import { formatClerkError, generateStrongTemporaryPassword } from '../lib/passwords.js';
import { getConfig } from '../lib/config.js';
import { verifySmtpConnection, sendTestEmail } from '../services/notifications.js';

// Plans are the source of truth for tenant capacity.  Limits are deliberately
// not accepted from the client, so a forged request cannot grant a tenant a
// larger employee or storage allowance.
const subscriptionPlans = Object.freeze({
  STARTER: { maxEmployees: 20, storageQuotaMb: 2 * 1024 },
  BUSINESS: { maxEmployees: 100, storageQuotaMb: 50 * 1024 },
  ENTERPRISE: { maxEmployees: null, storageQuotaMb: 1000 * 1024 }
});

const companyPlanSchema = z.enum(['STARTER', 'BUSINESS', 'ENTERPRISE']);

const companySchema = z.object({
  name: z.string().trim().min(2, 'Tên công ty phải từ 2 ký tự trở lên.').max(100),
  code: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,40}$/, 'Mã định danh chỉ gồm chữ thường, số và dấu gạch ngang.').optional(),
  companyEmail: z.string().trim().email('Email công ty không đúng định dạng.').max(255),
  temporaryPassword: z.string().trim().max(256).optional().or(z.literal('')),
  plan: companyPlanSchema,
  features: z.record(z.boolean()).default({}),
  subscriptionEndsAt: z.string().datetime({ offset: true }).nullable().optional(),
  supportAccessEnabled: z.boolean().default(false)
});

const settingSchema = z.object({
  namespace: z.enum(['GENERAL', 'HOLIDAYS', 'LEAVE_TYPES', 'SECURITY']),
  key: z.string().trim().regex(/^[A-Z0-9_]{2,80}$/),
  value: z.unknown()
});

const templateSchema = z.object({
  key: z.string().trim().regex(/^[A-Z0-9_]{2,80}$/),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(50_000),
  channel: z.enum(['EMAIL', 'IN_APP']).default('EMAIL'),
  isActive: z.boolean().default(true)
});

const integrationSchema = z.object({
  provider: z.enum(['RESEND', 'SENDGRID', 'GOOGLE', 'MICROSOFT', 'SMS']),
  displayName: z.string().trim().min(2).max(100),
  config: z.record(z.unknown()).default({}),
  isEnabled: z.boolean().default(false)
});

const ipRuleSchema = z.object({
  cidr: z.string().trim().min(3).max(50),
  action: z.enum(['ALLOW', 'DENY']),
  description: z.string().trim().max(300).optional().nullable(),
  isActive: z.boolean().default(true)
});

const ticketUpdateSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
  adminNote: z.string().trim().max(10_000).optional()
}).refine((value) => Object.keys(value).length > 0, 'No changes supplied.');

function dbError(error, fallback = 'Không thể xử lý dữ liệu quản trị hệ thống.') {
  console.error(error);
  throw new HttpError(502, fallback, 'DATABASE_ERROR');
}

function temporaryHrMetadata(company, fullName) {
  return {
    workshiftProvisioned: true,
    workshiftRole: 'HR',
    workshiftCompanyId: company.id,
    workshiftOfficeId: null,
    workshiftFullName: fullName,
    workshiftTemporaryPassword: true
  };
}

function hasExactEmail(user, email) {
  return user.emailAddresses?.some((address) => normalizeEmail(address.emailAddress) === email) ?? false;
}

function isRecoverableProvisionedHr(user) {
  return user.publicMetadata?.workshiftProvisioned === true && user.publicMetadata?.workshiftRole === 'HR';
}

function isMissingClerkUser(error) {
  return error?.status === 404 || error?.errors?.some((item) => item.code === 'resource_not_found');
}

async function provisionTemporaryHr(db, { company, email, temporaryPassword, fullName: requestedName }) {
  const fullName = (requestedName?.trim() || `Quản trị viên ${company.name}`).slice(0, 100);
  const metadata = temporaryHrMetadata(company, fullName);
  
  // Clean password input. If empty or missing, automatically generate a strong 18+ char password.
  const rawPassword = typeof temporaryPassword === 'string' ? temporaryPassword.trim() : '';
  const finalPassword = rawPassword.length >= 8 ? rawPassword : generateStrongTemporaryPassword();

  const { data: profileByEmail, error: profileByEmailError } = await db.from('users')
    .select('id, clerk_user_id, role, is_active, is_temporary_password, company_id')
    .eq('email', email)
    .maybeSingle();
  if (profileByEmailError) throw profileByEmailError;
  
  if (profileByEmail && profileByEmail.is_active && profileByEmail.role !== 'HR') {
    throw new HttpError(409, 'Email doanh nghiệp này đã được sử dụng cho một tài khoản khác trong hệ thống.', 'EMAIL_ALREADY_EXISTS');
  }
  if (profileByEmail?.company_id && profileByEmail.company_id !== company.id && profileByEmail.is_active) {
    throw new HttpError(409, 'Email này đang thuộc về một công ty khác.', 'EMAIL_ALREADY_EXISTS');
  }

  let clerkUser;
  if (profileByEmail?.clerk_user_id) {
    try {
      clerkUser = await clerkClient.users.updateUser(profileByEmail.clerk_user_id, {
        password: finalPassword,
        signOutOfOtherSessions: true,
        firstName: 'HR',
        lastName: company.name.slice(0, 90),
        publicMetadata: metadata
      });
    } catch (updateErr) {
      if (isMissingClerkUser(updateErr)) {
        clerkUser = undefined;
      } else {
        console.error('Failed to update Clerk HR account password:', updateErr);
        throw new HttpError(422, `Không thể đặt mật khẩu tài khoản HR: ${formatClerkError(updateErr)}`, 'HR_ACCOUNT_PROVISIONING_FAILED');
      }
    }
  }

  if (!clerkUser) {
    try {
      clerkUser = await clerkClient.users.createUser({
        emailAddress: [email],
        password: finalPassword,
        firstName: 'HR',
        lastName: company.name.slice(0, 90),
        publicMetadata: metadata
      });
    } catch (createError) {
      let orphan;
      try {
        const result = await clerkClient.users.getUserList({ emailAddress: [email], limit: 10 });
        orphan = result.data?.find((user) => hasExactEmail(user, email));
      } catch (lookupError) {
        console.error('Unable to inspect duplicate Clerk account.', lookupError);
      }
      if (!orphan) {
        console.error('Unable to create the initial HR Clerk account.', createError);
        throw new HttpError(422, `Không thể tạo tài khoản HR: ${formatClerkError(createError)}`, 'HR_ACCOUNT_CREATION_FAILED');
      }
      const { data: existingProfile, error: profileLookupError } = await db.from('users')
        .select('id, company_id')
        .eq('clerk_user_id', orphan.id)
        .maybeSingle();
      if (profileLookupError) throw profileLookupError;
      if (existingProfile && existingProfile.id !== profileByEmail?.id && existingProfile.company_id && existingProfile.company_id !== company.id) {
        throw new HttpError(409, 'Email doanh nghiệp này đã được sử dụng bởi công ty khác.', 'EMAIL_ALREADY_EXISTS');
      }
      try {
        clerkUser = await clerkClient.users.updateUser(orphan.id, {
          password: finalPassword,
          signOutOfOtherSessions: true,
          firstName: 'HR',
          lastName: company.name.slice(0, 90),
          publicMetadata: metadata
        });
      } catch (updateError) {
        console.error('Unable to recover the incomplete HR Clerk account.', updateError);
        throw new HttpError(422, `Không thể cập nhật mật khẩu tạm thời cho tài khoản HR: ${formatClerkError(updateError)}`, 'HR_ACCOUNT_RECOVERY_FAILED');
      }
    }
  }

  const profile = {
    clerk_user_id: clerkUser.id,
    company_id: company.id,
    full_name: fullName,
    email,
    role: 'HR',
    is_active: true,
    is_temporary_password: true
  };

  try {
    if (profileByEmail) {
      const { error } = await db.from('users').update(profile).eq('id', profileByEmail.id);
      if (error) throw error;
    } else {
      const { data: existingByClerk, error: lookupError } = await db.from('users')
        .select('id')
        .eq('clerk_user_id', clerkUser.id)
        .maybeSingle();
      if (lookupError) throw lookupError;
      if (existingByClerk) {
        const { error } = await db.from('users').update(profile).eq('id', existingByClerk.id);
        if (error) throw error;
      } else {
        const { error } = await db.from('users').insert(profile);
        if (error?.code === '23505') {
          const { data: racedProfile, error: raceError } = await db.from('users')
            .select('id')
            .eq('clerk_user_id', clerkUser.id)
            .maybeSingle();
          if (raceError || !racedProfile) throw raceError ?? error;
          const { error: updateError } = await db.from('users').update(profile).eq('id', racedProfile.id);
          if (updateError) throw updateError;
        } else if (error) {
          throw error;
        }
      }
    }
  } catch (error) {
    throw error;
  }

  const { data: grantedProfile, error: grantedProfileError } = await db.from('users')
    .select('id, role, is_active, is_temporary_password')
    .eq('clerk_user_id', clerkUser.id)
    .maybeSingle();
  if (grantedProfileError) throw grantedProfileError;
  if (!grantedProfile || grantedProfile.role !== 'HR' || !grantedProfile.is_active) {
    throw new HttpError(502, 'Tài khoản HR chưa được cấp quyền đầy đủ. Vui lòng thử lại.', 'HR_ROLE_PROVISIONING_INCOMPLETE');
  }

  return {
    id: clerkUser.id,
    userId: grantedProfile.id,
    companyId: company.id,
    email,
    fullName,
    role: grantedProfile.role,
    isActive: grantedProfile.is_active,
    isTemporaryPassword: grantedProfile.is_temporary_password,
    temporaryPassword: finalPassword
  };
}

export const systemAdminRouter = Router();
systemAdminRouter.use(requireAuth, requireRoles('ADMIN'));

systemAdminRouter.get('/dashboard', asyncHandler(async (_req, res) => {
  const db = createServiceClient();
  const today = new Date().toISOString().slice(0, 10);
  const [{ count: companyCount, error: companyError }, { count: activeCompanyCount, error: activeError }, { count: userCount, error: userError }, { count: requestCount, error: requestError }, { count: openTicketCount, error: ticketError }] = await Promise.all([
    db.from('companies').select('id', { count: 'exact', head: true }),
    db.from('companies').select('id', { count: 'exact', head: true }).eq('is_active', true),
    db.from('users').select('id', { count: 'exact', head: true }).eq('is_active', true),
    db.from('audit_logs').select('id', { count: 'exact', head: true }).gte('created_at', `${today}T00:00:00.000Z`),
    db.from('support_tickets').select('id', { count: 'exact', head: true }).in('status', ['OPEN', 'IN_PROGRESS'])
  ]);
  if (companyError || activeError || userError || requestError || ticketError) dbError(companyError || activeError || userError || requestError || ticketError);
  res.json({ data: { companies: companyCount ?? 0, activeCompanies: activeCompanyCount ?? 0, activeUsers: userCount ?? 0, apiRequestsToday: requestCount ?? 0, openTickets: openTicketCount ?? 0 } });
}));

systemAdminRouter.get('/companies', asyncHandler(async (_req, res) => {
  const db = createServiceClient();
  const [{ data: companies, error: companyError }, { data: hrProfiles, error: hrError }] = await Promise.all([
    db.from('companies')
      .select('id, name, code, company_email, allowed_ip, plan, max_employees, storage_quota_mb, features, is_active, subscription_ends_at, support_access_enabled, created_at')
      .order('created_at', { ascending: false }),
    db.from('users').select('id, company_id, email, full_name, role, is_active, is_temporary_password').eq('role', 'HR')
  ]);
  if (companyError || hrError) dbError(companyError || hrError);
  const data = (companies ?? []).map((company) => {
    const account = (hrProfiles ?? []).find((profile) => profile.company_id === company.id && (profile.email === company.company_email || hrProfiles.filter((p) => p.company_id === company.id).length === 1));
    return {
      ...company,
      hr_account: account
        ? { id: account.id, full_name: account.full_name, email: account.email, role: account.role, is_active: account.is_active, is_temporary_password: account.is_temporary_password }
        : null
    };
  });
  res.json({ data });
}));

systemAdminRouter.post('/companies', asyncHandler(async (req, res) => {
  const body = companySchema.parse(req.body);
  const companyEmail = normalizeEmail(body.companyEmail);
  if (!isAllowedEmailForRole(companyEmail, 'HR')) {
    throw new HttpError(422, 'Tài khoản HR phải dùng email @company.com.', 'EMAIL_DOMAIN_FORBIDDEN');
  }
  const db = createServiceClient();
  const { data: existingUser, error: userLookupError } = await db.from('users')
    .select('id, role, is_active, is_temporary_password')
    .eq('email', companyEmail)
    .maybeSingle();
  if (userLookupError) dbError(userLookupError);
  if (existingUser && existingUser.is_active && existingUser.role !== 'HR') {
    throw new HttpError(409, 'Email doanh nghiệp này đã được sử dụng cho vai trò khác.', 'EMAIL_ALREADY_EXISTS');
  }
  const limits = subscriptionPlans[body.plan];
  const companyPayload = {
    name: body.name, code: body.code ?? null, company_email: companyEmail, plan: body.plan, max_employees: limits.maxEmployees,
    storage_quota_mb: limits.storageQuotaMb, features: body.features, subscription_ends_at: body.subscriptionEndsAt ?? null,
    support_access_enabled: body.supportAccessEnabled, is_active: true
  };
  const companyFields = 'id, name, code, company_email, plan, max_employees, storage_quota_mb, features, is_active, subscription_ends_at, support_access_enabled, created_at';
  const { data: incompleteCompany, error: companyLookupError } = await db.from('companies')
    .select(companyFields)
    .eq('company_email', companyEmail)
    .maybeSingle();
  if (companyLookupError) dbError(companyLookupError);
  let data;
  if (incompleteCompany) {
    const { data: resumedCompany, error } = await db.from('companies')
      .update(companyPayload)
      .eq('id', incompleteCompany.id)
      .select(companyFields)
      .single();
    if (error || !resumedCompany) dbError(error, 'Không thể tiếp tục khởi tạo công ty.');
    data = resumedCompany;
  } else {
    const { data: createdCompany, error } = await db.from('companies')
      .insert(companyPayload)
      .select(companyFields)
      .single();
    if (error || !createdCompany) dbError(error, 'Không thể tạo công ty.');
    data = createdCompany;
  }
  let hrAccount;
  try {
    hrAccount = await provisionTemporaryHr(db, { company: data, email: companyEmail, temporaryPassword: body.temporaryPassword });
    data.hr_account = {
      id: hrAccount.id,
      email: hrAccount.email,
      role: hrAccount.role,
      is_active: true,
      is_temporary_password: hrAccount.isTemporaryPassword,
      temporaryPassword: hrAccount.temporaryPassword
    };
  } catch (provisionError) {
    if (!incompleteCompany && data?.id) {
      await db.from('companies').delete().eq('id', data.id);
    }
    if (provisionError instanceof HttpError) throw provisionError;
    dbError(provisionError, 'Không thể tạo tài khoản HR đầu tiên.');
  }
  await audit(req.profile.id, incompleteCompany ? 'SYSTEM_COMPANY_PROVISIONING_RESUMED' : 'SYSTEM_COMPANY_CREATED', { companyId: data.id, hrEmail: companyEmail }, clientIp(req));
  res.status(incompleteCompany ? 200 : 201).json({
    message: 'Khởi tạo doanh nghiệp và cấp tài khoản HR thành công.',
    data,
    hrAccount: {
      email: companyEmail,
      temporaryPassword: hrAccount.temporaryPassword,
      role: hrAccount.role,
      isTemporaryPassword: hrAccount.isTemporaryPassword
    }
  });
}));

systemAdminRouter.post('/companies/:id/provision-hr', asyncHandler(async (req, res) => {
  const companyId = z.string().uuid().parse(req.params.id);
  const body = z.object({
    temporaryPassword: z.string().trim().max(256).optional().or(z.literal('')),
    fullName: z.string().trim().max(100).optional(),
    email: z.string().trim().email('Email không đúng định dạng.').max(255).optional()
  }).parse(req.body);
  const db = createServiceClient();
  const { data: company, error } = await db.from('companies').select('*').eq('id', companyId).maybeSingle();
  if (error || !company) dbError(error, 'Không tìm thấy công ty.');

  const targetEmail = body.email ? normalizeEmail(body.email) : company.company_email;
  if (!isAllowedEmailForRole(targetEmail, 'HR')) {
    throw new HttpError(422, 'Tài khoản HR phải dùng email @company.com.', 'EMAIL_DOMAIN_FORBIDDEN');
  }

  if (body.email && body.email !== company.company_email) {
    await db.from('companies').update({ company_email: targetEmail }).eq('id', companyId);
    company.company_email = targetEmail;
  }

  const hrAccount = await provisionTemporaryHr(db, {
    company,
    email: targetEmail,
    temporaryPassword: body.temporaryPassword,
    fullName: body.fullName
  });
  await audit(req.profile.id, 'SYSTEM_COMPANY_HR_PROVISIONED', { companyId, hrEmail: targetEmail }, clientIp(req));
  res.json({ message: 'Đã cấp/đặt lại tài khoản HR thành công!', data: hrAccount });
}));

systemAdminRouter.post('/hr-accounts', asyncHandler(async (req, res) => {
  const body = z.object({
    companyId: z.string().uuid(),
    email: z.string().trim().email('Email không đúng định dạng.'),
    temporaryPassword: z.string().trim().max(256).optional().or(z.literal('')),
    fullName: z.string().trim().max(100).optional()
  }).parse(req.body);
  const targetEmail = normalizeEmail(body.email);
  if (!isAllowedEmailForRole(targetEmail, 'HR')) {
    throw new HttpError(422, 'Tài khoản HR phải dùng email @company.com.', 'EMAIL_DOMAIN_FORBIDDEN');
  }
  const db = createServiceClient();
  const { data: company, error } = await db.from('companies').select('*').eq('id', body.companyId).maybeSingle();
  if (error || !company) dbError(error, 'Không tìm thấy công ty.');

  const hrAccount = await provisionTemporaryHr(db, {
    company,
    email: targetEmail,
    temporaryPassword: body.temporaryPassword,
    fullName: body.fullName
  });
  await audit(req.profile.id, 'SYSTEM_HR_ACCOUNT_PROVISIONED', { companyId: body.companyId, hrEmail: targetEmail }, clientIp(req));
  res.status(201).json({ message: 'Đã tạo tài khoản HR thành công!', data: hrAccount });
}));

systemAdminRouter.patch('/companies/:id', asyncHandler(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const body = companySchema.partial().extend({ 
    isActive: z.boolean().optional(),
    temporaryPassword: z.string().trim().max(256).optional().or(z.literal(''))
  }).parse(req.body);
  const update = {
    ...(body.name !== undefined && { name: body.name }), ...(body.code !== undefined && { code: body.code }),
    ...(body.plan !== undefined && {
      plan: body.plan,
      max_employees: subscriptionPlans[body.plan].maxEmployees,
      storage_quota_mb: subscriptionPlans[body.plan].storageQuotaMb
    }),
    ...(body.features !== undefined && { features: body.features }),
    ...(body.subscriptionEndsAt !== undefined && { subscription_ends_at: body.subscriptionEndsAt }),
    ...(body.supportAccessEnabled !== undefined && { support_access_enabled: body.supportAccessEnabled }),
    ...(body.isActive !== undefined && { is_active: body.isActive })
  };
  const db = createServiceClient();
  let data;
  if (Object.keys(update).length) {
    const { data: updatedCompany, error } = await db.from('companies').update(update).eq('id', id).select('id, name, code, company_email, plan, max_employees, storage_quota_mb, features, is_active, subscription_ends_at, support_access_enabled, created_at').single();
    if (error || !updatedCompany) dbError(error, 'Không tìm thấy công ty.');
    data = updatedCompany;
  } else {
    const { data: currentCompany, error } = await db.from('companies').select('*').eq('id', id).single();
    if (error || !currentCompany) dbError(error, 'Không tìm thấy công ty.');
    data = currentCompany;
  }

  let provisionedHr;
  if (body.temporaryPassword !== undefined && body.temporaryPassword !== null && body.temporaryPassword !== '') {
    provisionedHr = await provisionTemporaryHr(db, {
      company: data,
      email: data.company_email,
      temporaryPassword: body.temporaryPassword
    });
    data.hr_account = {
      id: provisionedHr.id,
      email: provisionedHr.email,
      role: provisionedHr.role,
      is_active: true,
      is_temporary_password: provisionedHr.isTemporaryPassword,
      temporaryPassword: provisionedHr.temporaryPassword
    };
  }

  await audit(req.profile.id, 'SYSTEM_COMPANY_UPDATED', { companyId: id, fields: Object.keys(update) }, clientIp(req));
  res.json({ data, hrAccount: provisionedHr });
}));

// Permanently removes a tenant and all of its non-system user accounts. A
// system ADMIN is retained if an old installation happened to associate it
// with this tenant; PostgreSQL changes that account's company_id to null.
systemAdminRouter.delete('/companies/:id', asyncHandler(async (req, res) => {
  const companyId = z.string().uuid().parse(req.params.id);
  const db = createServiceClient();
  const { data: company, error: companyError } = await db.from('companies')
    .select('id, name')
    .eq('id', companyId)
    .maybeSingle();
  if (companyError || !company) dbError(companyError, 'Không tìm thấy công ty.');

  const { data: profiles, error: profileError } = await db.from('users')
    .select('id, clerk_user_id, role')
    .eq('company_id', companyId);
  if (profileError) dbError(profileError, 'Không thể tải tài khoản của công ty.');

  const tenantProfiles = (profiles ?? []).filter((profile) => !['ADMIN', 'SUPER_ADMIN'].includes(profile.role));
  const tenantUserIds = tenantProfiles.map((profile) => profile.id);

  // Remove external credentials first. If an external deletion fails, retain
  // database data so the Admin can retry safely instead of creating an orphan.
  for (const profile of tenantProfiles) {
    if (!profile.clerk_user_id) continue;
    try {
      await clerkClient.users.deleteUser(profile.clerk_user_id);
    } catch (error) {
      if (isMissingClerkUser(error)) continue;
      console.error('Unable to delete Clerk tenant user.', error);
      throw new HttpError(502, 'Không thể xóa tài khoản đăng nhập của công ty. Vui lòng thử lại.', 'TENANT_ACCOUNT_DELETION_FAILED');
    }
  }

  if (tenantUserIds.length) {
    // attendance_logs is retained from earlier deployments and has a required
    // user foreign key, so clear it explicitly before deleting user profiles.
    const { error: reviewError } = await db.from('attendance_logs')
      .update({ reviewed_by: null })
      .in('reviewed_by', tenantUserIds);
    if (reviewError) dbError(reviewError, 'Không thể xóa dữ liệu chấm công của công ty.');
    const { error: attendanceError } = await db.from('attendance_logs')
      .delete()
      .in('user_id', tenantUserIds);
    if (attendanceError) dbError(attendanceError, 'Không thể xóa dữ liệu chấm công của công ty.');
    const { error: userDeleteError } = await db.from('users')
      .delete()
      .in('id', tenantUserIds);
    if (userDeleteError) dbError(userDeleteError, 'Không thể xóa tài khoản của công ty.');
  }

  // Tenant-owned tables use ON DELETE CASCADE. Any retained system Admin is
  // detached automatically by users.company_id ON DELETE SET NULL.
  const { error: companyDeleteError } = await db.from('companies')
    .delete()
    .eq('id', companyId);
  if (companyDeleteError) dbError(companyDeleteError, 'Không thể xóa vĩnh viễn công ty.');

  await audit(req.profile.id, 'SYSTEM_COMPANY_PERMANENTLY_DELETED', {
    companyId,
    companyName: company.name,
    deletedTenantAccounts: tenantUserIds.length
  }, clientIp(req));
  res.json({ data: { id: companyId, deleted: true } });
}));

function resourceRoutes(path, table, schema, fields) {
  systemAdminRouter.get(path, asyncHandler(async (_req, res) => {
    const { data, error } = await createServiceClient().from(table).select(fields).order('updated_at', { ascending: false });
    if (error) dbError(error);
    res.json({ data: data ?? [] });
  }));
  systemAdminRouter.post(path, asyncHandler(async (req, res) => {
    const body = schema.parse(req.body);
    const row = table === 'system_settings' ? { namespace: body.namespace, setting_key: body.key, setting_value: body.value } : table === 'email_templates' ? { template_key: body.key, subject: body.subject, body: body.body, channel: body.channel, is_active: body.isActive } : { provider: body.provider, display_name: body.displayName, config: body.config, is_enabled: body.isEnabled };
    const { data, error } = await createServiceClient().from(table).upsert(row, { onConflict: table === 'system_settings' ? 'namespace,setting_key' : table === 'email_templates' ? 'template_key' : 'provider' }).select(fields).single();
    if (error || !data) dbError(error);
    await audit(req.profile.id, `SYSTEM_${table.toUpperCase()}_SAVED`, { id: data.id ?? null }, clientIp(req));
    res.status(201).json({ data });
  }));
}

resourceRoutes('/settings', 'system_settings', settingSchema, 'id, namespace, setting_key, setting_value, updated_at');
resourceRoutes('/email-templates', 'email_templates', templateSchema, 'id, template_key, subject, body, channel, is_active, updated_at');
resourceRoutes('/integrations', 'system_integrations', integrationSchema, 'id, provider, display_name, config, is_enabled, updated_at');

systemAdminRouter.get('/audit-logs', asyncHandler(async (req, res) => {
  const query = z.object({ page: z.coerce.number().int().min(1).default(1), size: z.coerce.number().int().min(1).max(100).default(30) }).parse(req.query);
  const from = (query.page - 1) * query.size;
  const { data, error, count } = await createServiceClient().from('audit_logs').select('id, actor_user_id, action, metadata, ip_address, created_at, users(full_name, email)', { count: 'exact' }).order('created_at', { ascending: false }).range(from, from + query.size - 1);
  if (error) dbError(error);
  res.json({ data: data ?? [], pagination: { page: query.page, size: query.size, total: count ?? 0 } });
}));

systemAdminRouter.get('/ip-rules', asyncHandler(async (_req, res) => {
  const { data, error } = await createServiceClient().from('global_ip_rules').select('id, cidr, action, description, is_active, created_at').order('created_at', { ascending: false });
  if (error) dbError(error);
  res.json({ data: data ?? [] });
}));

systemAdminRouter.post('/ip-rules', asyncHandler(async (req, res) => {
  const body = ipRuleSchema.parse(req.body);
  const { data, error } = await createServiceClient().from('global_ip_rules').insert(body).select('id, cidr, action, description, is_active, created_at').single();
  if (error || !data) dbError(error);
  await audit(req.profile.id, 'SYSTEM_IP_RULE_CREATED', { ruleId: data.id, action: data.action }, clientIp(req));
  res.status(201).json({ data });
}));

systemAdminRouter.get('/users', asyncHandler(async (_req, res) => {
  const { data, error } = await createServiceClient().from('users')
    .select('id, full_name, email, role, is_active, created_at, companies(name)')
    .order('created_at', { ascending: false }).limit(200);
  if (error) dbError(error);
  res.json({ data: data ?? [] });
}));

systemAdminRouter.patch('/users/:id/session', asyncHandler(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const body = z.object({ active: z.boolean() }).parse(req.body);
  if (id === req.profile.id && !body.active) throw new HttpError(409, 'Không thể tự khóa phiên hiện tại.', 'SELF_LOCK_FORBIDDEN');
  const { data, error } = await createServiceClient().from('users').update({ is_active: body.active }).eq('id', id).select('id, full_name, email, is_active').single();
  if (error || !data) dbError(error, 'Không tìm thấy tài khoản.');
  await audit(req.profile.id, body.active ? 'SYSTEM_ACCOUNT_RESTORED' : 'SYSTEM_ACCOUNT_LOCKED', { userId: id }, clientIp(req));
  res.json({ data });
}));

systemAdminRouter.get('/tickets', asyncHandler(async (_req, res) => {
  const { data, error } = await createServiceClient().from('support_tickets').select('id, company_id, subject, description, status, priority, admin_note, created_at, updated_at, companies(name)').order('updated_at', { ascending: false });
  if (error) dbError(error);
  res.json({ data: data ?? [] });
}));

systemAdminRouter.patch('/tickets/:id', asyncHandler(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const body = ticketUpdateSchema.parse(req.body);
  const update = { ...(body.status && { status: body.status }), ...(body.priority && { priority: body.priority }), ...(body.adminNote !== undefined && { admin_note: body.adminNote }), updated_at: new Date().toISOString() };
  const { data, error } = await createServiceClient().from('support_tickets').update(update).eq('id', id).select('id, status, priority, admin_note, updated_at').single();
  if (error || !data) dbError(error, 'Không tìm thấy ticket.');
  await audit(req.profile.id, 'SYSTEM_TICKET_UPDATED', { ticketId: id, fields: Object.keys(body) }, clientIp(req));
  res.json({ data });
}));

systemAdminRouter.post('/companies/:id/impersonation', asyncHandler(async (req, res) => {
  const companyId = z.string().uuid().parse(req.params.id);
  const body = z.object({ reason: z.string().trim().min(10).max(1000) }).parse(req.body);
  const { data: company, error } = await createServiceClient().from('companies').select('id, support_access_enabled, is_active').eq('id', companyId).maybeSingle();
  if (error || !company) dbError(error, 'Không tìm thấy công ty.');
  if (!company.is_active || !company.support_access_enabled) throw new HttpError(403, 'Công ty chưa cấp quyền hỗ trợ truy cập đại diện.', 'IMPERSONATION_NOT_ALLOWED');
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  const db = createServiceClient();
  const { data: target, error: targetError } = await db.from('users').select('id, role').eq('company_id', companyId).eq('role', 'HR').eq('is_active', true).limit(1).maybeSingle();
  if (targetError || !target) throw new HttpError(409, 'Công ty chưa có HR hoạt động để tạo phiên hỗ trợ.', 'IMPERSONATION_TARGET_MISSING');
  const { data, error: sessionError } = await db.from('impersonation_sessions').insert({ actor_user_id: req.profile.id, company_id: companyId, reason: body.reason, expires_at: expiresAt }).select('id, company_id, expires_at').single();
  if (sessionError || !data) dbError(sessionError, 'Không thể tạo phiên hỗ trợ.');
  await audit(req.profile.id, 'SYSTEM_IMPERSONATION_STARTED', { companyId, sessionId: data.id, reason: body.reason }, clientIp(req));
  const token = issueAppToken(target, { expiresInSeconds: 15 * 60, impersonationSessionId: data.id });
  res.status(201).json({ data: { ...data, readOnly: true, accessToken: token.accessToken, expiresIn: token.expiresIn } });
}));

// ===================== SMTP SERVER & EMAIL ENDPOINTS =====================
systemAdminRouter.get('/smtp/status', asyncHandler(async (_req, res) => {
  const { smtp } = getConfig();
  if (!smtp) {
    return res.json({
      data: {
        isConfigured: false,
        host: null,
        port: null,
        secure: false,
        user: null,
        from: null
      }
    });
  }
  res.json({
    data: {
      isConfigured: true,
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      user: smtp.user ? smtp.user.replace(/(?<=^.{2}).+(?=@)/, '***') : null,
      from: smtp.from
    }
  });
}));

systemAdminRouter.post('/smtp/verify', asyncHandler(async (req, res) => {
  const result = await verifySmtpConnection();
  await audit(req.profile.id, 'SYSTEM_SMTP_VERIFIED', { result }, clientIp(req));
  res.json({ data: result });
}));

systemAdminRouter.post('/smtp/test', asyncHandler(async (req, res) => {
  const body = z.object({
    toEmail: z.string().trim().email('Địa chỉ email nhận test không hợp lệ.')
  }).parse(req.body);

  const result = await sendTestEmail({ toEmail: body.toEmail });
  await audit(req.profile.id, 'SYSTEM_SMTP_TEST_SENT', { toEmail: body.toEmail }, clientIp(req));
  res.json({
    data: {
      success: true,
      message: `Đã gửi email thử nghiệm thành công đến ${body.toEmail}.`,
      result
    }
  });
}));
