import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError } from '../lib/errors.js';
import { getConfig } from '../lib/config.js';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { createServiceClient } from '../lib/supabase.js';
import { localDate, monthRange } from '../services/attendance.js';
import { audit, clientIp } from '../services/audit.js';
import { companyIdForProfile } from '../services/company.js';

const uuid = z.string().uuid();
const shiftSchema = z.object({ name: z.string().trim().min(2).max(100), startTime: z.string().regex(/^\d{2}:\d{2}$/), endTime: z.string().regex(/^\d{2}:\d{2}$/), lateGraceMinutes: z.number().int().min(0).max(240).default(10), isOvernight: z.boolean().default(false), isActive: z.boolean().default(true) });
const requestSchema = z.object({ requestType: z.enum(['LEAVE', 'OVERTIME', 'EXPLANATION']), startAt: z.string().datetime({ offset: true }), endAt: z.string().datetime({ offset: true }), reason: z.string().trim().min(5).max(10_000) }).refine((v) => new Date(v.endAt) >= new Date(v.startAt), { path: ['endAt'], message: 'Thời gian kết thúc phải sau thời gian bắt đầu.' });

async function tenant(req) {
  const id = await companyIdForProfile(req.profile);
  if (!id) throw new HttpError(409, 'Tài khoản chưa được gán vào công ty.', 'COMPANY_NOT_ASSIGNED');
  return id;
}
function dbFail(error, message = 'Không thể xử lý dữ liệu.') { console.error(error); throw new HttpError(502, message, 'DATABASE_ERROR'); }
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
function currentMonth() { const timeZone = getConfig().attendanceTimezone; return localDate(new Date(), timeZone).slice(0, 7); }

export const hrWorkspaceRouter = Router();
hrWorkspaceRouter.use(requireAuth, requireRoles('HR'));

hrWorkspaceRouter.get('/employees', asyncHandler(async (req, res) => {
  const companyId = await tenant(req);
  const { data, error } = await createServiceClient().from('users').select('id, full_name, email, role, office_id, job_title, manager_id, phone, is_active, offices(name)').eq('company_id', companyId).order('full_name');
  if (error) dbFail(error); res.json({ data: data ?? [] });
}));
hrWorkspaceRouter.patch('/employees/:id', asyncHandler(async (req, res) => {
  const companyId = await tenant(req); const id = uuid.parse(req.params.id);
  const body = z.object({ fullName: z.string().trim().min(2).max(100).optional(), officeId: uuid.nullable().optional(), jobTitle: z.string().trim().max(100).nullable().optional(), managerId: uuid.nullable().optional(), phone: z.string().trim().max(30).nullable().optional(), isActive: z.boolean().optional() }).parse(req.body);
  // Check-in measures GPS distance to this office, so it must belong to the HR user's company.
  if (body.officeId) { const { data: office, error: officeError } = await createServiceClient().from('offices').select('id').eq('id', body.officeId).eq('company_id', companyId).maybeSingle(); if (officeError) dbFail(officeError); if (!office) throw new HttpError(404, 'Không tìm thấy địa điểm làm việc trong công ty.', 'NOT_FOUND'); }
  const update = { ...(body.fullName !== undefined && { full_name: body.fullName }), ...(body.officeId !== undefined && { office_id: body.officeId }), ...(body.jobTitle !== undefined && { job_title: body.jobTitle }), ...(body.managerId !== undefined && { manager_id: body.managerId }), ...(body.phone !== undefined && { phone: body.phone }), ...(body.isActive !== undefined && { is_active: body.isActive }) };
  const { data, error } = await createServiceClient().from('users').update(update).eq('id', id).eq('company_id', companyId).eq('role', 'EMPLOYEE').select('id, full_name, office_id, job_title, manager_id, phone, is_active').single();
  if (error || !data) dbFail(error, 'Không tìm thấy nhân viên trong công ty.'); await audit(req.profile.id, 'HR_EMPLOYEE_UPDATED', { employeeId: id, fields: Object.keys(update) }, clientIp(req)); res.json({ data });
}));
hrWorkspaceRouter.get('/departments', asyncHandler(async (req, res) => { const { data, error } = await createServiceClient().from('offices').select('id, name').eq('company_id', await tenant(req)).order('name'); if (error) dbFail(error); res.json({ data: data ?? [] }); }));
hrWorkspaceRouter.get('/shifts', asyncHandler(async (req, res) => { const { data, error } = await createServiceClient().from('work_shifts').select('*').eq('company_id', await tenant(req)).order('name'); if (error) dbFail(error); res.json({ data: data ?? [] }); }));
hrWorkspaceRouter.post('/shifts', asyncHandler(async (req, res) => { const companyId = await tenant(req); const body = shiftSchema.parse(req.body); const { data, error } = await createServiceClient().from('work_shifts').insert({ company_id: companyId, name: body.name, start_time: body.startTime, end_time: body.endTime, late_grace_minutes: body.lateGraceMinutes, is_overnight: body.isOvernight, is_active: body.isActive }).select('*').single(); if (error || !data) dbFail(error, 'Không thể tạo ca làm.'); await audit(req.profile.id, 'HR_SHIFT_CREATED', { shiftId: data.id }, clientIp(req)); res.status(201).json({ data }); }));
hrWorkspaceRouter.patch('/shifts/:id', asyncHandler(async (req, res) => { const companyId = await tenant(req); const body = shiftSchema.partial().parse(req.body); const update = { ...(body.name !== undefined && { name: body.name }), ...(body.startTime !== undefined && { start_time: body.startTime }), ...(body.endTime !== undefined && { end_time: body.endTime }), ...(body.lateGraceMinutes !== undefined && { late_grace_minutes: body.lateGraceMinutes }), ...(body.isOvernight !== undefined && { is_overnight: body.isOvernight }), ...(body.isActive !== undefined && { is_active: body.isActive }) }; const { data, error } = await createServiceClient().from('work_shifts').update(update).eq('id', uuid.parse(req.params.id)).eq('company_id', companyId).select('*').single(); if (error || !data) dbFail(error, 'Không tìm thấy ca làm.'); res.json({ data }); }));
hrWorkspaceRouter.post('/shift-assignments', asyncHandler(async (req, res) => { const companyId = await tenant(req); const body = z.object({ userId: uuid, shiftId: uuid, workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.body); const db = createServiceClient(); const [{ data: user }, { data: shift }] = await Promise.all([db.from('users').select('id').eq('id', body.userId).eq('company_id', companyId).maybeSingle(), db.from('work_shifts').select('id').eq('id', body.shiftId).eq('company_id', companyId).maybeSingle()]); if (!user || !shift) throw new HttpError(404, 'Không tìm thấy nhân viên hoặc ca làm trong công ty.', 'NOT_FOUND'); const { data, error } = await db.from('employee_shift_assignments').upsert({ user_id: body.userId, shift_id: body.shiftId, work_date: body.workDate }, { onConflict: 'user_id,work_date' }).select('*').single(); if (error || !data) dbFail(error, 'Không thể phân ca.'); res.status(201).json({ data }); }));
hrWorkspaceRouter.get('/requests', asyncHandler(async (req, res) => { 
  const { data, error } = await createServiceClient()
    .from('employee_requests')
    .select('id, request_type, start_at, end_at, reason, status, review_note, created_at, users!employee_requests_user_id_fkey(full_name, email)')
    .eq('company_id', await tenant(req))
    .order('created_at', { ascending: false }); 
  if (error) dbFail(error); 
  res.json({ data: data ?? [] }); 
}));
hrWorkspaceRouter.patch('/requests/:id', asyncHandler(async (req, res) => { const companyId = await tenant(req); const body = z.object({ status: z.enum(['APPROVED', 'REJECTED']), reviewNote: z.string().trim().max(2000).optional() }).parse(req.body); const { data, error } = await createServiceClient().from('employee_requests').update({ status: body.status, review_note: body.reviewNote ?? null, reviewed_by: req.profile.id, reviewed_at: new Date().toISOString() }).eq('id', uuid.parse(req.params.id)).eq('company_id', companyId).eq('status', 'PENDING').select('*').single(); if (error || !data) dbFail(error, 'Không tìm thấy đơn chờ duyệt.'); await audit(req.profile.id, `HR_REQUEST_${body.status}`, { requestId: data.id }, clientIp(req)); res.json({ data }); }));
hrWorkspaceRouter.get('/attendance', asyncHandler(async (req, res) => { 
  const companyId = await tenant(req);
  const month = monthSchema.default(currentMonth()).parse(req.query.month);
  const { from, to } = monthRange(month, getConfig().attendanceTimezone);
  // `!inner` makes the company filter remove other companies' rows instead of only hiding their embedded user.
  const { data, error } = await createServiceClient()
    .from('attendances')
    .select('id, user_id, check_in_time, check_out_time, status, adjustment_note, check_in_evidence, check_out_evidence, users!attendances_user_id_fkey!inner(full_name, email, company_id)')
    .eq('users.company_id', companyId)
    .gte('check_in_time', from)
    .lt('check_in_time', to)
    .order('check_in_time', { ascending: false });
  if (error) dbFail(error); 
  res.json({ data: data ?? [] }); 
}));
hrWorkspaceRouter.patch('/attendance/:id', asyncHandler(async (req, res) => { const companyId = await tenant(req); const id = uuid.parse(req.params.id); const body = z.object({ checkInTime: z.string().datetime({ offset: true }).optional(), checkOutTime: z.string().datetime({ offset: true }).nullable().optional(), status: z.enum(['NORMAL', 'LATE']).optional(), adjustmentNote: z.string().trim().min(3).max(1000) }).parse(req.body); const db = createServiceClient();
  // Ownership is checked before the write; checking afterwards would already have changed another company's record.
  const { data: owned, error: ownerError } = await db.from('attendances').select('id, users!attendances_user_id_fkey!inner(company_id)').eq('id', id).eq('users.company_id', companyId).maybeSingle(); if (ownerError) dbFail(ownerError); if (!owned) throw new HttpError(404, 'Không tìm thấy chấm công trong công ty.', 'NOT_FOUND');
  const { data, error } = await db.from('attendances').update({ ...(body.checkInTime && { check_in_time: body.checkInTime }), ...(body.checkOutTime !== undefined && { check_out_time: body.checkOutTime }), ...(body.status && { status: body.status }), adjusted_by: req.profile.id, adjustment_note: body.adjustmentNote }).eq('id', id).select('id, user_id').single(); if (error || !data) dbFail(error, 'Không tìm thấy chấm công.'); await audit(req.profile.id, 'HR_ATTENDANCE_ADJUSTED', { attendanceId: data.id }, clientIp(req)); res.json({ data }); }));
hrWorkspaceRouter.get('/reports/attendance.csv', asyncHandler(async (req, res) => { 
  const companyId = await tenant(req); 
  const { data, error } = await createServiceClient()
    .from('attendances')
    .select('check_in_time, check_out_time, status, users!attendances_user_id_fkey!inner(full_name, email, company_id)')
    .eq('users.company_id', companyId)
    .order('check_in_time'); 
  if (error) dbFail(error); 
  const safe = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`; 
  const rows = ['Họ tên,Email,Check-in,Check-out,Trạng thái', ...(data ?? []).map((r) => [r.users.full_name, r.users.email, r.check_in_time, r.check_out_time, r.status].map(safe).join(','))]; 
  res.type('text/csv').attachment('attendance-report.csv').send(`\uFEFF${rows.join('\n')}`); 
}));

export const employeeWorkspaceRouter = Router();
employeeWorkspaceRouter.use(requireAuth, requireRoles('EMPLOYEE'));
employeeWorkspaceRouter.get('/attendance', asyncHandler(async (req, res) => { const month = monthSchema.optional().parse(req.query.month); let query = createServiceClient().from('attendances').select('id, check_in_time, check_out_time, status, adjustment_note').eq('user_id', req.profile.id).order('check_in_time', { ascending: false }); if (month) { const { from, to } = monthRange(month, getConfig().attendanceTimezone); query = query.gte('check_in_time', from).lt('check_in_time', to); } const { data, error } = await query; if (error) dbFail(error); res.json({ data: data ?? [] }); }));
employeeWorkspaceRouter.get('/requests', asyncHandler(async (req, res) => { const { data, error } = await createServiceClient().from('employee_requests').select('id, request_type, start_at, end_at, reason, status, review_note, created_at').eq('user_id', req.profile.id).order('created_at', { ascending: false }); if (error) dbFail(error); res.json({ data: data ?? [] }); }));
employeeWorkspaceRouter.post('/requests', asyncHandler(async (req, res) => { const body = requestSchema.parse(req.body); const { data, error } = await createServiceClient().from('employee_requests').insert({ company_id: await tenant(req), user_id: req.profile.id, request_type: body.requestType, start_at: body.startAt, end_at: body.endAt, reason: body.reason }).select('*').single(); if (error || !data) dbFail(error, 'Không thể tạo đơn.'); await audit(req.profile.id, 'EMPLOYEE_REQUEST_CREATED', { requestId: data.id, type: body.requestType }, clientIp(req)); res.status(201).json({ data }); }));
employeeWorkspaceRouter.get('/schedule', asyncHandler(async (req, res) => { const { data, error } = await createServiceClient().from('employee_shift_assignments').select('work_date, work_shifts(name, start_time, end_time, late_grace_minutes, is_overnight)').eq('user_id', req.profile.id).gte('work_date', new Date().toISOString().slice(0, 10)).order('work_date').limit(60); if (error) dbFail(error); res.json({ data: data ?? [] }); }));
employeeWorkspaceRouter.get('/leave-balance', asyncHandler(async (req, res) => { const year = new Date().getFullYear(); const { data, error } = await createServiceClient().from('leave_balances').select('granted_days, used_days').eq('user_id', req.profile.id).eq('year', year).maybeSingle(); if (error) dbFail(error); const balance = data ?? { granted_days: req.profile.annual_leave_days ?? 12, used_days: 0 }; res.json({ data: { ...balance, remaining_days: Number(balance.granted_days) - Number(balance.used_days), year } }); }));
employeeWorkspaceRouter.patch('/profile', asyncHandler(async (req, res) => { const body = z.object({ fullName: z.string().trim().min(2).max(100).optional(), phone: z.string().trim().max(30).nullable().optional() }).parse(req.body); const { data, error } = await createServiceClient().from('users').update({ ...(body.fullName && { full_name: body.fullName }), ...(body.phone !== undefined && { phone: body.phone }) }).eq('id', req.profile.id).select('id, full_name, phone').single(); if (error || !data) dbFail(error, 'Không thể cập nhật hồ sơ.'); res.json({ data }); }));
