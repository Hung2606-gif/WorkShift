import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError } from '../lib/errors.js';
import { getConfig } from '../lib/config.js';
import { requireAuth } from '../middleware/auth.js';
import { createServiceClient } from '../lib/supabase.js';
import { clientIp } from '../services/audit.js';
import {
  addDays,
  assertGpsFix,
  assignmentForCheckIn,
  checkInStatus,
  checkOutClosesAt,
  ipMatchesAllowed,
  localDate,
  shiftWindow
} from '../services/attendance.js';

// `requestId` is generated once per tap by the app and reused when it resends
// after a lost response, so a retry returns the record it already created.
const presenceSchema = z.object({
  requestId: z.string().uuid(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().positive().max(10_000),
  capturedAt: z.string().datetime({ offset: true })
}).strict();

const attendanceColumns = 'id, user_id, shift_assignment_id, check_in_time, check_out_time, status, check_in_request_id, check_out_request_id';

function dbFail(error, message) {
  console.error(error);
  throw new HttpError(502, message, 'DATABASE_ERROR');
}

function clockTime(instant, timeZone) {
  return new Intl.DateTimeFormat('vi-VN', { timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(instant));
}

function requireCompany(profile) {
  // `company_id` comes from the profile loaded for this session, never from the request.
  if (!profile.company_id) throw new HttpError(409, 'Tài khoản chưa được gán vào công ty.', 'COMPANY_NOT_ASSIGNED');
  return profile.company_id;
}

/**
 * GPS check shared by check-in and check-out; returns the evidence to store.
 * The company network IP never blocks: a mismatch is recorded for HR review.
 */
async function verifyPresence(db, req, companyId, body, now) {
  if (!req.profile.office_id) {
    throw new HttpError(409, 'Bạn chưa được gán địa điểm làm việc. Vui lòng liên hệ HR.', 'OFFICE_NOT_ASSIGNED');
  }
  const [{ data: company, error: companyError }, { data: office, error: officeError }] = await Promise.all([
    db.from('companies').select('allowed_ip').eq('id', companyId).maybeSingle(),
    db.from('offices').select('latitude, longitude, radius_meters').eq('id', req.profile.office_id).eq('company_id', companyId).maybeSingle()
  ]);
  if (companyError || officeError) dbFail(companyError ?? officeError, 'Không thể tải cấu hình chấm công.');
  if (!office) {
    throw new HttpError(409, 'Địa điểm làm việc của bạn không thuộc công ty. Vui lòng liên hệ HR.', 'OFFICE_NOT_ASSIGNED');
  }

  const distance = assertGpsFix(body, office, now);
  const ip = clientIp(req);
  return {
    ip,
    // null when the company has not configured its network IP.
    ipMatchesCompany: company?.allowed_ip ? ipMatchesAllowed(ip, company.allowed_ip) : null,
    latitude: body.latitude,
    longitude: body.longitude,
    accuracyMeters: body.accuracy,
    capturedAt: body.capturedAt,
    distanceMeters: Math.round(distance)
  };
}

async function attendanceForAssignment(db, assignmentId) {
  const { data, error } = await db.from('attendances')
    .select(attendanceColumns)
    .eq('shift_assignment_id', assignmentId)
    .maybeSingle();
  if (error) dbFail(error, 'Không thể tải dữ liệu chấm công.');
  return data;
}

function replayCheckIn(res, record, requestId, timeZone) {
  if (record.check_in_request_id !== requestId) {
    throw new HttpError(409, `Bạn đã check-in ca này lúc ${clockTime(record.check_in_time, timeZone)}.`, 'ALREADY_CHECKED_IN');
  }
  res.status(200).json({ message: 'Check-in này đã được ghi nhận trước đó.', data: record });
}

function replayCheckOut(res, record, requestId, timeZone) {
  if (record.check_out_request_id !== requestId) {
    throw new HttpError(409, `Bạn đã check-out ca này lúc ${clockTime(record.check_out_time, timeZone)}.`, 'ALREADY_CHECKED_OUT');
  }
  res.status(200).json({ message: 'Check-out này đã được ghi nhận trước đó.', data: record });
}

const checkIn = asyncHandler(async (req, res) => {
  const body = presenceSchema.parse(req.body);
  const now = new Date();
  const timeZone = getConfig().attendanceTimezone;
  const companyId = requireCompany(req.profile);
  const db = createServiceClient();

  // Only shifts of the employee's own company, assigned to this employee, qualify.
  const today = localDate(now, timeZone);
  const { data: assignments, error: assignmentError } = await db.from('employee_shift_assignments')
    .select('id, work_date, work_shifts!inner(start_time, end_time, late_grace_minutes, is_overnight)')
    .eq('user_id', req.profile.id)
    .eq('work_shifts.company_id', companyId)
    .eq('work_shifts.is_active', true)
    .gte('work_date', addDays(today, -1))
    .lte('work_date', addDays(today, 1));
  if (assignmentError) dbFail(assignmentError, 'Không thể tải lịch phân ca.');
  const match = assignmentForCheckIn(assignments ?? [], now, timeZone);
  if (!match) {
    throw new HttpError(409, 'Bạn không có ca làm nào đang mở để check-in.', 'NO_OPEN_SHIFT');
  }

  const existing = await attendanceForAssignment(db, match.assignment.id);
  if (existing) return replayCheckIn(res, existing, body.requestId, timeZone);

  const evidence = await verifyPresence(db, req, companyId, body, now);
  // The time comes from the server clock; the device's clock is only evidence.
  const { data, error } = await db.from('attendances')
    .insert({
      user_id: req.profile.id,
      shift_assignment_id: match.assignment.id,
      check_in_time: now.toISOString(),
      status: checkInStatus(match.window, match.assignment.work_shifts, now),
      check_in_request_id: body.requestId,
      check_in_evidence: evidence
    })
    .select(attendanceColumns)
    .single();
  // The unique constraint on shift_assignment_id decides between concurrent
  // check-ins; the losing request answers with the winning record.
  if (error?.code === '23505') {
    const winner = await attendanceForAssignment(db, match.assignment.id);
    if (winner) return replayCheckIn(res, winner, body.requestId, timeZone);
  }
  if (error || !data) dbFail(error, 'Không thể lưu chấm công.');

  res.status(201).json({ message: 'Chấm công thành công!', data });
});

const checkOut = asyncHandler(async (req, res) => {
  const body = presenceSchema.parse(req.body);
  const now = new Date();
  const timeZone = getConfig().attendanceTimezone;
  const companyId = requireCompany(req.profile);
  const db = createServiceClient();

  const { data: latest, error } = await db.from('attendances')
    .select(`${attendanceColumns}, employee_shift_assignments!inner(work_date, work_shifts!inner(start_time, end_time, is_overnight))`)
    .eq('user_id', req.profile.id)
    .order('check_in_time', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) dbFail(error, 'Không thể tải dữ liệu chấm công.');
  if (!latest) throw new HttpError(400, 'Bạn chưa check-in.', 'MISSING_CHECKIN');
  const { employee_shift_assignments: assignment, ...record } = latest;
  const window = shiftWindow(assignment.work_date, assignment.work_shifts, timeZone);
  const windowClosed = now > checkOutClosesAt(window);
  if (record.check_out_time) {
    // A closed record from an earlier shift means nothing is open now.
    if (windowClosed && record.check_out_request_id !== body.requestId) {
      throw new HttpError(400, 'Bạn chưa check-in ca hiện tại.', 'MISSING_CHECKIN');
    }
    return replayCheckOut(res, record, body.requestId, timeZone);
  }
  if (windowClosed) {
    throw new HttpError(409, 'Đã quá thời gian check-out của ca. Vui lòng gửi đơn giải trình cho HR.', 'CHECKOUT_WINDOW_CLOSED');
  }

  const evidence = await verifyPresence(db, req, companyId, body, now);
  // Only an open record is updated, so exactly one of two concurrent check-outs succeeds.
  const { data: closed, error: updateError } = await db.from('attendances')
    .update({ check_out_time: now.toISOString(), check_out_request_id: body.requestId, check_out_evidence: evidence })
    .eq('id', record.id)
    .is('check_out_time', null)
    .select(attendanceColumns)
    .maybeSingle();
  if (updateError) dbFail(updateError, 'Không thể check-out.');
  if (!closed) {
    const { data: winner, error: reloadError } = await db.from('attendances').select(attendanceColumns).eq('id', record.id).maybeSingle();
    if (reloadError || !winner) dbFail(reloadError, 'Không thể check-out.');
    return replayCheckOut(res, winner, body.requestId, timeZone);
  }

  res.status(200).json({ message: 'Check-out thành công!', data: closed });
});

export function attendanceRouter() {
  const router = Router();
  router.use(requireAuth);
  router.post('/checkin', checkIn);
  router.post('/checkout', checkOut);
  return router;
}
