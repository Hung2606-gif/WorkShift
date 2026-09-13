import { clerkClient } from '@clerk/express';
import { Router } from 'express';
import { z } from 'zod';
import { isAllowedEmailForRole, isCompanyEmail, isSystemAdminEmail, normalizeEmail } from '../lib/access.js';
import { asyncHandler, HttpError } from '../lib/errors.js';
import { reviewSchema } from '../lib/validation.js';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { createServiceClient } from '../lib/supabase.js';
import { audit, clientIp } from '../services/audit.js';
import { companyIdForProfile } from '../services/company.js';
import { dispatchPendingNotifications, sendCompanyEmail } from '../services/notifications.js';

const officeFieldsSchema = z.object({
  name: z.string().trim().min(2).max(100),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.number().positive().max(1000).default(50),
  allowedIp: z.string().ip().optional().nullable(),
  allowedBssid: z.string().regex(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i).optional().nullable(),
  workStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('09:00'),
  workEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('18:00'),
  lateGraceMinutes: z.number().int().min(0).max(120).default(10),
  earlyLeaveGraceMinutes: z.number().int().min(0).max(120).default(10),
  requireTrustedDevice: z.boolean().default(false)
});

const officeSchema = officeFieldsSchema.refine((value) => value.workEnd > value.workStart, {
  message: 'Gio ket thuc phai sau gio bat dau.', path: ['workEnd']
});

const employeeInvitationSchema = z.object({
  officeId: z.string().uuid().nullable(),
  fullName: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(255),
  role: z.enum(['HR', 'EMPLOYEE']).default('EMPLOYEE')
});

const bulkEmployeeInvitationSchema = z.object({
  employees: z.array(employeeInvitationSchema).min(1).max(50)
});

const employeeUpdateSchema = z.object({
  officeId: z.string().uuid().nullable().optional(),
  fullName: z.string().trim().min(2).max(100).optional(),
  role: z.enum(['HR', 'EMPLOYEE']).optional(),
  isActive: z.boolean().optional(),
  resetTrustedDevice: z.boolean().optional(),
  requestBiometricDeletion: z.boolean().optional()
});

const companyEmailSchema = z.object({
  to: z.string().trim().email().max(255),
  subject: z.string().trim().min(1).max(160),
  text: z.string().trim().min(1).max(10_000)
});

function assertRoleEmail(email, role) {
  if (!isAllowedEmailForRole(email, role)) {
    const requiredDomain = role === 'HR' ? '@company.com' : '@gmail.com';
    throw new HttpError(422, `Email ${role} phai thuoc domain ${requiredDomain}.`, 'EMAIL_DOMAIN_FORBIDDEN');
  }
}

function assertCompanyEmail(email) {
  if (!isCompanyEmail(email)) {
    throw new HttpError(422, 'Email nguoi nhan phai thuoc domain @company.com.', 'EMAIL_DOMAIN_FORBIDDEN');
  }
}

function assertEmployeeManagement(profile, employee) {
  if (profile.role === 'HR' && employee.role !== 'EMPLOYEE') {
    throw new HttpError(403, 'HR chi duoc quan ly tai khoan nhan vien.', 'EMPLOYEE_SCOPE_FORBIDDEN');
  }
  if (isSystemAdminEmail(employee.email)) {
    throw new HttpError(403, 'Khong the thay doi tai khoan ADMIN he thong.', 'SYSTEM_ADMIN_PROTECTED');
  }
}

async function revokePendingInvitations(email) {
  // Invitations live in Clerk rather than the application database. Querying
  // Clerk here lets an HR user reissue an invitation after a bad/old email
  // link without requiring a local invitation table.
  const { data: invitations } = await clerkClient.invitations.getInvitationList({
    query: email,
    status: 'pending'
  });
  const pending = (invitations ?? []).filter((invitation) => normalizeEmail(invitation.emailAddress) === email);
  await Promise.all(pending.map((invitation) => clerkClient.invitations.revokeInvitation(invitation.id)));
  return pending.length;
}

async function assertInvitationOffice(companyId, officeId) {
  if (!officeId) return;
  const { data, error } = await createServiceClient().from('offices')
    .select('id')
    .eq('id', officeId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) throw new HttpError(502, 'Khong the kiem tra phong ban.', 'DATABASE_ERROR');
  if (!data) throw new HttpError(422, 'Phong ban khong thuoc cong ty cua ban.', 'OFFICE_SCOPE_FORBIDDEN');
}

async function createEmployeeInvitation({ email, role, companyId, officeId, fullName }) {
  try {
    const replacedInvitationCount = await revokePendingInvitations(email);
    const invitation = await clerkClient.invitations.createInvitation({
      emailAddress: email,
      // Clerk's Account Portal consumes the invitation ticket and completes
      // password setup. The WorkShift login page is only for existing users.
      publicMetadata: {
        workshiftProvisioned: true,
        workshiftRole: role,
        workshiftCompanyId: companyId,
        workshiftOfficeId: officeId,
        workshiftFullName: fullName
      }
    });
    return { invitation, replacedInvitationCount };
  } catch (error) {
    console.error('Unable to reissue Clerk invitation.', error);
    throw new HttpError(409, 'Khong the gui loi moi. Vui long thu lai sau.', 'INVITATION_FAILED');
  }
}

async function findEmployee(id, companyId) {
  let query = createServiceClient().from('users')
    .select('id, email, role, is_active')
    .eq('id', id);
  if (companyId) query = query.eq('company_id', companyId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new HttpError(502, 'Khong the tai nhan vien.', 'DATABASE_ERROR');
  if (!data) throw new HttpError(404, 'Khong tim thay nhan vien.', 'EMPLOYEE_NOT_FOUND');
  return data;
}

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRoles('ADMIN', 'HR'));

// System-only attendance and operational controls.
adminRouter.get('/summary', requireRoles('ADMIN'), asyncHandler(async (req, res) => {
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(new Date().toISOString().slice(0, 10)).parse(req.query.date);
  const supabase = createServiceClient();
  const [{ count: activeEmployees, error: userError }, { data: logs, error: logsError }] = await Promise.all([
    supabase.from('users').select('id', { count: 'exact', head: true }).eq('is_active', true).eq('role', 'EMPLOYEE'),
    supabase.from('attendance_logs').select('id, status, is_flagged, check_in, check_out').eq('date', date)
  ]);
  if (userError || logsError) throw new HttpError(502, 'Khong the tai so lieu dashboard.', 'DATABASE_ERROR');
  const records = logs ?? [];
  res.json({ data: {
    date,
    activeEmployees: activeEmployees ?? 0,
    checkedIn: records.filter((item) => Boolean(item.check_in)).length,
    checkedOut: records.filter((item) => Boolean(item.check_out)).length,
    late: records.filter((item) => item.status === 'LATE').length,
    absent: records.filter((item) => item.status === 'ABSENT').length,
    flagged: records.filter((item) => item.is_flagged).length
  } });
}));

adminRouter.get('/flags', requireRoles('ADMIN'), asyncHandler(async (req, res) => {
  const query = z.object({ page: z.coerce.number().int().min(1).default(1), size: z.coerce.number().int().min(1).max(100).default(20) }).parse(req.query);
  const from = (query.page - 1) * query.size;
  const { data, error, count } = await createServiceClient().from('attendance_logs')
    // `attendance_logs` references users both as the employee and reviewer.
    // Name the employee FK explicitly so PostgREST can embed deterministically.
    .select('id, date, check_in, status, is_flagged, flag_reason, review_note, reviewed_at, users!attendance_logs_user_id_fkey!inner(full_name, email)', { count: 'exact' })
    .eq('is_flagged', true)
    .order('check_in', { ascending: false })
    .range(from, from + query.size - 1);
  if (error) throw new HttpError(502, 'Khong the tai canh bao.', 'DATABASE_ERROR');
  res.json({ data: data ?? [], pagination: { page: query.page, size: query.size, total: count ?? 0 } });
}));

adminRouter.patch('/attendance/:id/review', requireRoles('ADMIN'), asyncHandler(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const body = reviewSchema.parse(req.body);
  const { data, error } = await createServiceClient().from('attendance_logs')
    .update({ is_flagged: body.isFlagged, review_note: body.reviewNote, reviewed_by: req.profile.id, reviewed_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, is_flagged, review_note, reviewed_at')
    .single();
  if (error || !data) throw new HttpError(404, 'Khong tim thay luot cham cong.', 'ATTENDANCE_NOT_FOUND');
  await audit(req.profile.id, 'ATTENDANCE_REVIEWED', { attendanceId: id, isFlagged: body.isFlagged }, clientIp(req));
  res.json({ data });
}));

// Company HR and the system admin can manage the shared department list.
adminRouter.get('/offices', asyncHandler(async (_req, res) => {
  let query = createServiceClient().from('offices').select('*').order('name');
  if (_req.profile.role === 'HR') query = query.eq('company_id', await companyIdForProfile(_req.profile));
  const { data, error } = await query;
  if (error) throw new HttpError(502, 'Khong the tai phong ban.', 'DATABASE_ERROR');
  res.json({ data: data ?? [] });
}));

adminRouter.post('/offices', asyncHandler(async (req, res) => {
  const body = officeSchema.parse(req.body);
  const companyId = req.profile.role === 'HR' ? await companyIdForProfile(req.profile) : null;
  const { data, error } = await createServiceClient().from('offices').insert({
    name: body.name, latitude: body.latitude, longitude: body.longitude, radius_meters: body.radiusMeters,
    ...(companyId && { company_id: companyId }),
    allowed_ip: body.allowedIp ?? null, allowed_bssid: body.allowedBssid ?? null,
    work_start: body.workStart, work_end: body.workEnd, late_grace_minutes: body.lateGraceMinutes,
    early_leave_grace_minutes: body.earlyLeaveGraceMinutes, require_trusted_device: body.requireTrustedDevice
  }).select('*').single();
  if (error || !data) throw new HttpError(502, 'Khong the tao phong ban.', 'DATABASE_ERROR');
  await audit(req.profile.id, 'DEPARTMENT_CREATED', { departmentId: data.id }, clientIp(req));
  res.status(201).json({ data });
}));

adminRouter.patch('/offices/:id', asyncHandler(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const body = officeFieldsSchema.partial().parse(req.body);
  if (body.workStart && body.workEnd && body.workEnd <= body.workStart) throw new HttpError(422, 'Gio ket thuc phai sau gio bat dau.', 'VALIDATION_ERROR');
  const update = {
    ...(body.name !== undefined && { name: body.name }), ...(body.latitude !== undefined && { latitude: body.latitude }),
    ...(body.longitude !== undefined && { longitude: body.longitude }), ...(body.radiusMeters !== undefined && { radius_meters: body.radiusMeters }),
    ...(body.allowedIp !== undefined && { allowed_ip: body.allowedIp }), ...(body.allowedBssid !== undefined && { allowed_bssid: body.allowedBssid }),
    ...(body.workStart !== undefined && { work_start: body.workStart }), ...(body.workEnd !== undefined && { work_end: body.workEnd }),
    ...(body.lateGraceMinutes !== undefined && { late_grace_minutes: body.lateGraceMinutes }),
    ...(body.earlyLeaveGraceMinutes !== undefined && { early_leave_grace_minutes: body.earlyLeaveGraceMinutes }),
    ...(body.requireTrustedDevice !== undefined && { require_trusted_device: body.requireTrustedDevice })
  };
  let query = createServiceClient().from('offices').update(update).eq('id', id);
  if (req.profile.role === 'HR') query = query.eq('company_id', await companyIdForProfile(req.profile));
  const { data, error } = await query.select('*').single();
  if (error || !data) throw new HttpError(404, 'Khong tim thay phong ban.', 'DEPARTMENT_NOT_FOUND');
  await audit(req.profile.id, 'DEPARTMENT_UPDATED', { departmentId: id, fields: Object.keys(update) }, clientIp(req));
  res.json({ data });
}));

adminRouter.delete('/offices/:id', asyncHandler(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const supabase = createServiceClient();
  const { count, error: countError } = await supabase.from('users').select('id', { count: 'exact', head: true }).eq('office_id', id);
  if (countError) throw new HttpError(502, 'Khong the kiem tra nhan vien cua phong ban.', 'DATABASE_ERROR');
  if (count) throw new HttpError(409, 'Hay chuyen nhan vien sang phong ban khac truoc khi xoa.', 'DEPARTMENT_IN_USE');
  let query = supabase.from('offices').delete().eq('id', id);
  if (req.profile.role === 'HR') query = query.eq('company_id', await companyIdForProfile(req.profile));
  const { error } = await query;
  if (error) throw new HttpError(502, 'Khong the xoa phong ban.', 'DATABASE_ERROR');
  await audit(req.profile.id, 'DEPARTMENT_DELETED', { departmentId: id }, clientIp(req));
  res.status(204).end();
}));

adminRouter.get('/employees', asyncHandler(async (req, res) => {
  let query = createServiceClient().from('users')
    .select('id, clerk_user_id, office_id, full_name, email, role, is_active, created_at, offices(name)')
    .order('full_name');
  if (req.profile.role === 'HR') query = query.eq('role', 'EMPLOYEE').eq('company_id', await companyIdForProfile(req.profile));
  const { data, error } = await query;
  if (error) throw new HttpError(502, 'Khong the tai nhan vien.', 'DATABASE_ERROR');
  res.json({ data: data ?? [] });
}));

adminRouter.post('/employees', asyncHandler(async (req, res) => {
  const body = employeeInvitationSchema.parse(req.body);
  const email = normalizeEmail(body.email);
  const role = req.profile.role === 'HR' ? 'EMPLOYEE' : body.role;
  assertRoleEmail(email, role);
  const companyId = await companyIdForProfile(req.profile);
  if (!companyId) throw new HttpError(409, 'Tai khoan chua duoc gan vao cong ty.', 'COMPANY_NOT_ASSIGNED');
  await assertInvitationOffice(companyId, body.officeId);
  const { invitation, replacedInvitationCount } = await createEmployeeInvitation({
    email, role, companyId, officeId: body.officeId, fullName: body.fullName
  });
  await audit(req.profile.id, 'EMPLOYEE_INVITED', { email, role, officeId: body.officeId, replacedInvitationCount }, clientIp(req));
  res.status(201).json({ data: { invitationId: invitation.id, email: invitation.emailAddress, role, replacedInvitationCount } });
}));

adminRouter.post('/employees/bulk-invitations', asyncHandler(async (req, res) => {
  const body = bulkEmployeeInvitationSchema.parse(req.body);
  const companyId = await companyIdForProfile(req.profile);
  if (!companyId) throw new HttpError(409, 'Tai khoan chua duoc gan vao cong ty.', 'COMPANY_NOT_ASSIGNED');

  const results = [];
  for (const [index, employee] of body.employees.entries()) {
    const email = normalizeEmail(employee.email);
    const role = req.profile.role === 'HR' ? 'EMPLOYEE' : employee.role;
    try {
      assertRoleEmail(email, role);
      await assertInvitationOffice(companyId, employee.officeId);
      const { invitation, replacedInvitationCount } = await createEmployeeInvitation({
        email, role, companyId, officeId: employee.officeId, fullName: employee.fullName
      });
      results.push({ index, email, success: true, invitationId: invitation.id, replacedInvitationCount });
    } catch (error) {
      results.push({ index, email, success: false, error: error instanceof Error ? error.message : 'Khong the gui loi moi.' });
    }
  }

  const succeeded = results.filter((result) => result.success).length;
  if (succeeded) {
    await audit(req.profile.id, 'EMPLOYEES_INVITED_BULK', { requested: body.employees.length, succeeded }, clientIp(req));
  }
  res.status(201).json({ data: { requested: body.employees.length, succeeded, failed: body.employees.length - succeeded, results } });
}));

adminRouter.patch('/employees/:id', asyncHandler(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const target = await findEmployee(id, req.profile.role === 'HR' ? await companyIdForProfile(req.profile) : null);
  assertEmployeeManagement(req.profile, target);
  const body = employeeUpdateSchema.parse(req.body);
  if (req.profile.role === 'HR' && (body.role !== undefined || body.resetTrustedDevice || body.requestBiometricDeletion)) {
    throw new HttpError(403, 'HR khong co quyen thay doi vai tro hoac du lieu bao mat.', 'EMPLOYEE_SCOPE_FORBIDDEN');
  }
  const update = {
    ...(body.officeId !== undefined && { office_id: body.officeId }), ...(body.fullName !== undefined && { full_name: body.fullName }),
    ...(body.role !== undefined && { role: body.role }), ...(body.isActive !== undefined && { is_active: body.isActive }),
    ...(body.resetTrustedDevice && { trusted_device_hash: null, trusted_device_set_at: null }),
    ...(body.requestBiometricDeletion && { biometric_delete_requested_at: new Date().toISOString() })
  };
  if (!Object.keys(update).length) throw new HttpError(422, 'Khong co du lieu can cap nhat.', 'VALIDATION_ERROR');
  const { data, error } = await createServiceClient().from('users')
    .update(update).eq('id', id).select('id, clerk_user_id, office_id, full_name, email, role, is_active').single();
  if (error || !data) throw new HttpError(404, 'Khong tim thay nhan vien.', 'EMPLOYEE_NOT_FOUND');
  await audit(req.profile.id, 'EMPLOYEE_UPDATED', { employeeId: id, fields: Object.keys(update) }, clientIp(req));
  res.json({ data });
}));

adminRouter.delete('/employees/:id', asyncHandler(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const target = await findEmployee(id, req.profile.role === 'HR' ? await companyIdForProfile(req.profile) : null);
  assertEmployeeManagement(req.profile, target);
  const { error } = await createServiceClient().from('users').update({ is_active: false }).eq('id', id);
  if (error) throw new HttpError(502, 'Khong the vo hieu hoa nhan vien.', 'DATABASE_ERROR');
  await audit(req.profile.id, 'EMPLOYEE_DEACTIVATED', { employeeId: id }, clientIp(req));
  res.status(204).end();
}));

adminRouter.delete('/employees/:id/biometrics', requireRoles('ADMIN'), asyncHandler(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const target = await findEmployee(id);
  assertEmployeeManagement(req.profile, target);
  const supabase = createServiceClient();
  const [{ data: faceRows, error: faceError }, { data: attendanceRows, error: attendanceError }] = await Promise.all([
    supabase.from('user_faces').select('id, photo_url').eq('user_id', id),
    supabase.from('attendance_logs').select('id, photo_url').eq('user_id', id).not('photo_url', 'is', null)
  ]);
  if (faceError || attendanceError) throw new HttpError(502, 'Khong the tai du lieu sinh trac hoc.', 'DATABASE_ERROR');
  const paths = [...(faceRows ?? []), ...(attendanceRows ?? [])].map((item) => item.photo_url).filter(Boolean);
  if (paths.length) {
    const { error: storageError } = await supabase.storage.from('face-samples').remove(paths);
    if (storageError) throw new HttpError(502, 'Khong the xoa anh sinh trac hoc.', 'STORAGE_ERROR');
  }
  const [{ error: deleteFacesError }, { error: redactAttendanceError }, { error: userError }] = await Promise.all([
    supabase.from('user_faces').delete().eq('user_id', id),
    supabase.from('attendance_logs').update({ photo_url: null, photo_sha256: null, capture_proof_sha256: null, liveness_metadata: null, biometric_deleted_at: new Date().toISOString() }).eq('user_id', id),
    supabase.from('users').update({ biometric_delete_requested_at: new Date().toISOString() }).eq('id', id)
  ]);
  if (deleteFacesError || redactAttendanceError || userError) throw new HttpError(502, 'Khong the xoa du lieu sinh trac hoc.', 'DATABASE_ERROR');
  await audit(req.profile.id, 'BIOMETRICS_DELETED', { employeeId: id, deletedObjects: paths.length }, clientIp(req));
  res.json({ data: { deletedObjects: paths.length } });
}));

adminRouter.post('/emails', asyncHandler(async (req, res) => {
  const body = companyEmailSchema.parse(req.body);
  const email = normalizeEmail(body.to);
  assertCompanyEmail(email);
  const data = await sendCompanyEmail({ to: email, subject: body.subject, text: body.text });
  await audit(req.profile.id, 'COMPANY_EMAIL_SENT', { to: email }, clientIp(req));
  res.status(202).json({ data });
}));

adminRouter.post('/notifications/dispatch', requireRoles('ADMIN'), asyncHandler(async (req, res) => {
  const body = z.object({ limit: z.number().int().min(1).max(100).default(25) }).default({}).parse(req.body ?? {});
  const data = await dispatchPendingNotifications(body.limit);
  await audit(req.profile.id, 'NOTIFICATIONS_DISPATCHED', data, clientIp(req));
  res.json({ data });
}));
