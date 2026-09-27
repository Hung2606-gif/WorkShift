import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../src/lib/errors.js';
import { attendanceRouter } from '../src/routes/attendance.js';
import { hrWorkspaceRouter } from '../src/routes/workspace.js';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const OFFICE = '33333333-3333-4333-8333-333333333333';
const ASSIGNMENT = '44444444-4444-4444-8444-444444444444';
const REQUEST = '55555555-5555-4555-8555-555555555555';
const OTHER_REQUEST = '66666666-6666-4666-8666-666666666666';
const RECORD = '77777777-7777-4777-8777-777777777777';

const mocks = vi.hoisted(() => ({ createServiceClient: vi.fn(), profile: null }));
vi.mock('../src/lib/supabase.js', () => ({ createServiceClient: mocks.createServiceClient }));
vi.mock('../src/lib/config.js', () => ({ getConfig: () => ({ attendanceTimezone: 'Asia/Ho_Chi_Minh' }) }));
vi.mock('../src/middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => { req.profile = mocks.profile; next(); },
  requireRoles: () => (_req, _res, next) => next()
}));

/** A Supabase stand-in that records each query's calls and answers from `respond(table, calls)`. */
function fakeDb(respond) {
  const queries = [];
  return {
    queries,
    from(table) {
      const calls = [];
      queries.push({ table, calls });
      const builder = new Proxy({}, {
        get(_target, method) {
          if (method === 'then') {
            return (resolve, reject) => Promise.resolve(respond(table, calls)).then(resolve, reject);
          }
          return (...args) => { calls.push([method, ...args]); return builder; };
        }
      });
      return builder;
    }
  };
}
const called = (calls, method) => calls.find(([name]) => name === method);
const writes = (db, method) => db.queries.filter((query) => query.table === 'attendances' && called(query.calls, method));

const office = { latitude: 10.7769, longitude: 106.7009, radius_meters: 100 };
const assignment = {
  id: ASSIGNMENT,
  work_date: '2026-09-28',
  work_shifts: { start_time: '08:00:00', end_time: '17:00:00', late_grace_minutes: 10, is_overnight: false }
};
const record = (overrides) => ({
  id: RECORD,
  user_id: USER,
  shift_assignment_id: ASSIGNMENT,
  check_in_time: '2026-09-28T01:02:00.000Z',
  check_out_time: null,
  status: 'NORMAL',
  check_in_request_id: REQUEST,
  check_out_request_id: null,
  ...overrides
});

/** Answers the reads a check-in or check-out makes; `attendances` replies are consumed in order. */
function attendanceDb(attendanceReplies) {
  const replies = [...attendanceReplies];
  return fakeDb((table) => {
    if (table === 'employee_shift_assignments') return { data: [assignment], error: null };
    if (table === 'companies') return { data: { allowed_ip: '203.0.113.10' }, error: null };
    if (table === 'offices') return { data: office, error: null };
    if (table === 'attendances') return replies.shift();
    throw new Error(`unexpected table ${table}`);
  });
}

function presence(overrides) {
  return {
    requestId: REQUEST,
    latitude: office.latitude,
    longitude: office.longitude,
    accuracy: 20,
    capturedAt: new Date().toISOString(),
    ...overrides
  };
}

function createAttendanceApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/attendance', attendanceRouter());
  app.use('/hr', hrWorkspaceRouter);
  app.use(errorHandler);
  return app;
}

function post(path, body) {
  return request(createAttendanceApp()).post(path).set('X-Forwarded-For', '203.0.113.10').send(body);
}

describe('attendance check-in', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-28T01:05:00Z')); // 08:05 in Ho Chi Minh City
    mocks.profile = { id: USER, company_id: COMPANY, office_id: OFFICE, role: 'EMPLOYEE' };
  });
  afterEach(() => vi.useRealTimers());

  it('records one check-in for the open shift with server time and location evidence', async () => {
    const db = attendanceDb([{ data: null, error: null }, { data: record(), error: null }]);
    mocks.createServiceClient.mockReturnValue(db);

    const response = await post('/attendance/checkin', presence());

    expect(response.status).toBe(201);
    const shiftQuery = db.queries.find((query) => query.table === 'employee_shift_assignments');
    expect(shiftQuery.calls).toContainEqual(['eq', 'user_id', USER]);
    expect(shiftQuery.calls).toContainEqual(['eq', 'work_shifts.company_id', COMPANY]);
    const [insert] = writes(db, 'insert');
    expect(called(insert.calls, 'insert')[1]).toMatchObject({
      user_id: USER,
      shift_assignment_id: ASSIGNMENT,
      check_in_time: '2026-09-28T01:05:00.000Z',
      status: 'NORMAL',
      check_in_request_id: REQUEST,
      check_in_evidence: { ip: '203.0.113.10', ipMatchesCompany: true, distanceMeters: 0, accuracyMeters: 20 }
    });
  });

  it('marks the check-in late after the grace period', async () => {
    vi.setSystemTime(new Date('2026-09-28T01:15:00Z'));
    const db = attendanceDb([{ data: null, error: null }, { data: record(), error: null }]);
    mocks.createServiceClient.mockReturnValue(db);

    await post('/attendance/checkin', presence());

    expect(called(writes(db, 'insert')[0].calls, 'insert')[1].status).toBe('LATE');
  });

  it('returns the stored record when the app resends the same request', async () => {
    const db = attendanceDb([{ data: record(), error: null }]);
    mocks.createServiceClient.mockReturnValue(db);

    const response = await post('/attendance/checkin', presence());

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(RECORD);
    expect(writes(db, 'insert')).toHaveLength(0);
  });

  it('refuses a second check-in for the same shift', async () => {
    const db = attendanceDb([{ data: record(), error: null }]);
    mocks.createServiceClient.mockReturnValue(db);

    const response = await post('/attendance/checkin', presence({ requestId: OTHER_REQUEST }));

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ALREADY_CHECKED_IN');
    expect(writes(db, 'insert')).toHaveLength(0);
  });

  it('answers a request that loses a concurrent insert with the winning record', async () => {
    const lostRace = () => attendanceDb([
      { data: null, error: null },
      { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } },
      { data: record(), error: null }
    ]);

    mocks.createServiceClient.mockReturnValue(lostRace());
    const otherTap = await post('/attendance/checkin', presence({ requestId: OTHER_REQUEST }));
    mocks.createServiceClient.mockReturnValue(lostRace());
    const retry = await post('/attendance/checkin', presence());

    expect(otherTap.status).toBe(409);
    expect(otherTap.body.code).toBe('ALREADY_CHECKED_IN');
    expect(retry.status).toBe(200);
    expect(retry.body.data.id).toBe(RECORD);
  });

  it('rejects a location outside the office radius without writing', async () => {
    const db = attendanceDb([{ data: null, error: null }]);
    mocks.createServiceClient.mockReturnValue(db);

    const response = await post('/attendance/checkin', presence({ latitude: office.latitude + 0.002 }));

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('OUTSIDE_WORK_LOCATION');
    expect(writes(db, 'insert')).toHaveLength(0);
  });

  it('records a check-in from outside the company network and flags it for HR review', async () => {
    const db = attendanceDb([{ data: null, error: null }, { data: record(), error: null }]);
    mocks.createServiceClient.mockReturnValue(db);

    const response = await request(createAttendanceApp()).post('/attendance/checkin').set('X-Forwarded-For', '198.51.100.7').send(presence());

    expect(response.status).toBe(201);
    expect(called(writes(db, 'insert')[0].calls, 'insert')[1].check_in_evidence).toMatchObject({ ip: '198.51.100.7', ipMatchesCompany: false });
  });

  it('does not accept a company chosen by the client', async () => {
    mocks.createServiceClient.mockReturnValue(attendanceDb([]));

    const response = await post('/attendance/checkin', presence({ companyId: COMPANY }));

    expect(response.status).toBe(422);
  });

  it('refuses a check-in when no assigned shift is open', async () => {
    vi.setSystemTime(new Date('2026-09-28T12:00:00Z')); // 19:00, after the shift ended
    mocks.createServiceClient.mockReturnValue(attendanceDb([]));

    const response = await post('/attendance/checkin', presence());

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('NO_OPEN_SHIFT');
  });
});

describe('attendance check-out', () => {
  const openRecord = () => ({ ...record(), employee_shift_assignments: { work_date: assignment.work_date, work_shifts: assignment.work_shifts } });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-28T10:02:00Z')); // 17:02
    mocks.profile = { id: USER, company_id: COMPANY, office_id: OFFICE, role: 'EMPLOYEE' };
  });
  afterEach(() => vi.useRealTimers());

  it('closes the record only while it is still open', async () => {
    const closed = record({ check_out_time: '2026-09-28T10:02:00.000Z', check_out_request_id: REQUEST });
    const db = attendanceDb([{ data: openRecord(), error: null }, { data: closed, error: null }]);
    mocks.createServiceClient.mockReturnValue(db);

    const response = await post('/attendance/checkout', presence());

    expect(response.status).toBe(200);
    const [update] = writes(db, 'update');
    expect(update.calls).toContainEqual(['is', 'check_out_time', null]);
    expect(called(update.calls, 'update')[1]).toMatchObject({ check_out_time: '2026-09-28T10:02:00.000Z', check_out_request_id: REQUEST });
  });

  it('refuses the request that loses a concurrent check-out', async () => {
    const closedByOther = record({ check_out_time: '2026-09-28T10:01:59.000Z', check_out_request_id: OTHER_REQUEST });
    mocks.createServiceClient.mockReturnValue(attendanceDb([
      { data: openRecord(), error: null },
      { data: null, error: null },
      { data: closedByOther, error: null }
    ]));

    const response = await post('/attendance/checkout', presence());

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ALREADY_CHECKED_OUT');
  });
});

describe('HR attendance tenant scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.profile = { id: USER, company_id: COMPANY, role: 'HR' };
  });

  it('does not modify an attendance record of another company', async () => {
    const db = fakeDb((table) => (table === 'users' ? { data: { company_id: COMPANY }, error: null } : { data: null, error: null }));
    mocks.createServiceClient.mockReturnValue(db);

    const response = await request(createAttendanceApp())
      .patch(`/hr/attendance/${RECORD}`)
      .send({ status: 'NORMAL', adjustmentNote: 'Sửa giờ vào' });

    expect(response.status).toBe(404);
    expect(writes(db, 'update')).toHaveLength(0);
    const [ownerCheck] = db.queries.filter((query) => query.table === 'attendances');
    expect(ownerCheck.calls).toContainEqual(['eq', 'users.company_id', COMPANY]);
  });

  it('filters listed attendance rows by company and real month bounds', async () => {
    const db = fakeDb((table) => (table === 'users' ? { data: { company_id: COMPANY }, error: null } : { data: [], error: null }));
    mocks.createServiceClient.mockReturnValue(db);

    const response = await request(createAttendanceApp()).get('/hr/attendance?month=2026-09');

    expect(response.status).toBe(200);
    const [list] = db.queries.filter((query) => query.table === 'attendances');
    expect(called(list.calls, 'select')[1]).toContain('users!attendances_user_id_fkey!inner(');
    expect(list.calls).toContainEqual(['gte', 'check_in_time', '2026-08-31T17:00:00.000Z']);
    expect(list.calls).toContainEqual(['lt', 'check_in_time', '2026-09-30T17:00:00.000Z']);
  });
});
