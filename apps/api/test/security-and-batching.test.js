import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler, HttpError } from '../src/lib/errors.js';
import { ticketReference } from '../src/lib/ticket-reference.js';
import { postgresRateLimit } from '../src/middleware/postgres-rate-limit.js';
import { adminRouter } from '../src/routes/admin.js';
import { authRouter, failedLoginMinimumMs } from '../src/routes/auth.js';
import { inboundEmailRouter } from '../src/routes/inbound-email.js';
import { hrWorkspaceRouter } from '../src/routes/workspace.js';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const OFFICE = '33333333-3333-4333-8333-333333333333';
const FOREIGN_OFFICE = '88888888-8888-4888-8888-888888888888';
const TICKET = '99999999-9999-4999-8999-999999999999';
const SECRET = 's'.repeat(32);

const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  profile: null,
  config: {},
  invitations: { getInvitationList: vi.fn(), revokeInvitation: vi.fn(), createInvitation: vi.fn() },
  verifyPassword: vi.fn(),
  findAuthorizedProfileByEmail: vi.fn()
}));
vi.mock('@clerk/express', () => ({ clerkClient: { invitations: mocks.invitations, users: { verifyPassword: mocks.verifyPassword } }, getAuth: vi.fn() }));
vi.mock('../src/lib/supabase.js', () => ({ createServiceClient: mocks.createServiceClient }));
vi.mock('../src/lib/config.js', () => ({ getConfig: () => mocks.config }));
vi.mock('../src/services/notifications.js', () => ({
  dispatchPendingNotifications: vi.fn(),
  sendCompanyEmail: vi.fn(),
  sendTicketAutoResponderEmail: vi.fn()
}));
vi.mock('../src/middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => { req.profile = mocks.profile; next(); },
  requireRoles: () => (_req, _res, next) => next(),
  findAuthorizedProfileByEmail: mocks.findAuthorizedProfileByEmail,
  resolveAuthorizedClerkProfile: vi.fn()
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
          if (method === 'then') return (resolve, reject) => Promise.resolve(respond(table, calls)).then(resolve, reject);
          return (...args) => { calls.push([method, ...args]); return builder; };
        }
      });
      return builder;
    }
  };
}
const queriesOf = (db, table) => db.queries.filter((query) => query.table === table);

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/auth', authRouter);
  app.use('/admin', adminRouter);
  app.use('/email', inboundEmailRouter);
  app.use('/hr', hrWorkspaceRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.config = { systemAdminEmail: 'admin@gmail.com', companyEmailDomain: 'company.com', inboundEmailSecret: SECRET, attendanceTimezone: 'Asia/Ho_Chi_Minh', appJwtSecret: 'j'.repeat(32), smtp: null };
  mocks.profile = { id: '22222222-2222-4222-8222-222222222222', company_id: COMPANY, role: 'HR', email: 'hr@company.com' };
});

describe('bulk employee invitations', () => {
  it('checks offices and pending invitations once for the whole batch', async () => {
    const db = fakeDb((table) => {
      if (table === 'users') return { data: { company_id: COMPANY }, error: null };
      if (table === 'offices') return { data: [{ id: OFFICE }], error: null };
      return { data: null, error: null };
    });
    mocks.createServiceClient.mockReturnValue(db);
    mocks.invitations.getInvitationList.mockResolvedValue({ data: [{ id: 'inv_old', emailAddress: 'an@gmail.com' }], totalCount: 1 });
    mocks.invitations.createInvitation.mockImplementation(async ({ emailAddress }) => ({ id: `inv_${mocks.invitations.createInvitation.mock.calls.length}`, emailAddress }));

    const response = await request(createApp()).post('/admin/employees/bulk-invitations').send({
      employees: [
        { fullName: 'Nguyen An', email: 'an@gmail.com', officeId: OFFICE },
        { fullName: 'Tran Binh', email: 'binh@gmail.com', officeId: FOREIGN_OFFICE },
        { fullName: 'Nguyen An', email: 'an@gmail.com', officeId: null }
      ]
    });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ requested: 3, succeeded: 2, failed: 1 });
    expect(response.body.data.results[1]).toMatchObject({ email: 'binh@gmail.com', success: false });
    expect(queriesOf(db, 'offices')).toHaveLength(1);
    expect(queriesOf(db, 'offices')[0].calls).toContainEqual(['in', 'id', [OFFICE, FOREIGN_OFFICE]]);
    expect(mocks.invitations.getInvitationList).toHaveBeenCalledTimes(1);
    // The old invitation is revoked by the first row, and the first row's invitation by the repeated email.
    expect(mocks.invitations.revokeInvitation.mock.calls.map(([id]) => id)).toEqual(['inv_old', 'inv_1']);
  });
});

describe('inbound email webhook', () => {
  const email = { from: 'An <an@gmail.com>', to: 'support@company.com', subject: `Re: [WorkShift Support #99999999] Loi cham cong`, text: `Mã Ticket: ${TICKET}` };

  it('rejects a request without the shared secret before touching the database', async () => {
    mocks.createServiceClient.mockReturnValue(fakeDb(() => ({ data: null, error: null })));

    const response = await request(createApp()).post('/email/inbound').send(email);

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('INVALID_WEBHOOK_SECRET');
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
  });

  it('stays disabled until a secret is configured', async () => {
    mocks.config.inboundEmailSecret = null;

    const response = await request(createApp()).post('/email/inbound').set('X-Webhook-Secret', SECRET).send(email);

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('INBOUND_EMAIL_DISABLED');
  });

  function ticketDb() {
    return fakeDb((table, calls) => {
      const has = (method) => calls.some(([name]) => name === method);
      if (table === 'companies') return { data: { id: COMPANY, name: 'A' }, error: null };
      if (table === 'support_tickets' && has('insert')) return { data: { id: 'new-ticket', subject: 'x' }, error: null };
      if (table === 'support_tickets' && has('select')) return { data: { id: TICKET, company_id: COMPANY, subject: 'x', description: 'old', status: 'OPEN' }, error: null };
      return { data: null, error: null };
    });
  }

  it('does not treat a bare ticket ID from a possibly forged sender as a reply', async () => {
    const db = ticketDb();
    mocks.createServiceClient.mockReturnValue(db);

    const response = await request(createApp()).post(`/email/inbound?token=${SECRET}`).send(email);

    expect(response.status).toBe(200);
    expect(response.body.data.action).toBe('TICKET_CREATED');
    const [insert] = queriesOf(db, 'support_tickets');
    expect(insert.calls.find(([method]) => method === 'insert')[1]).toMatchObject({ created_by: null, company_id: COMPANY });
    expect(queriesOf(db, 'users')).toHaveLength(0);
  });

  it('appends a reply that quotes the signed ticket reference', async () => {
    const db = ticketDb();
    mocks.createServiceClient.mockReturnValue(db);

    const response = await request(createApp()).post('/email/inbound').set('X-Webhook-Secret', SECRET)
      .send({ ...email, subject: `Re: [WorkShift Support ${ticketReference(TICKET)}] Loi cham cong` });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ action: 'TICKET_REPLY_UPDATED', ticketId: TICKET });
  });

  it('rejects a reference whose signature was altered', async () => {
    const forged = ticketReference(TICKET).replace(/.$/, (last) => (last === '0' ? '1' : '0'));
    const db = ticketDb();
    mocks.createServiceClient.mockReturnValue(db);

    const response = await request(createApp()).post(`/email/inbound?token=${SECRET}`).send({ ...email, subject: `Re: ${forged}` });

    expect(response.body.data.action).toBe('TICKET_CREATED');
  });
});

describe('password login', () => {
  const login = (email) => request(createApp()).post('/auth/login').send({ email, password: 'wrong-password' });

  it('answers unknown, unlinked and wrong-password logins identically and no faster than the minimum', async () => {
    mocks.findAuthorizedProfileByEmail.mockImplementation(async (email) => {
      if (email === 'nobody@gmail.com') throw new HttpError(403, 'denied', 'ACCESS_NOT_AUTHORIZED');
      if (email === 'unlinked@gmail.com') return { id: 'p1', role: 'EMPLOYEE', clerk_user_id: null };
      return { id: 'p2', role: 'EMPLOYEE', clerk_user_id: 'user_2' };
    });
    mocks.verifyPassword.mockRejectedValue(new Error('invalid password'));

    const startedAt = Date.now();
    const responses = await Promise.all(['nobody@gmail.com', 'unlinked@gmail.com', 'known@gmail.com'].map(login));

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(failedLoginMinimumMs - 20);
    expect(responses.map((response) => response.status)).toEqual([401, 401, 401]);
    expect(new Set(responses.map((response) => JSON.stringify(response.body))).size).toBe(1);
  });

  it('still reports a database failure as a service error', async () => {
    mocks.findAuthorizedProfileByEmail.mockRejectedValue(new HttpError(502, 'db', 'DATABASE_ERROR'));

    const response = await login('known@gmail.com');

    expect(response.status).toBe(502);
  });
});

describe('rate limiter identity', () => {
  function limitedApp(options) {
    const app = express();
    app.set('trust proxy', 1);
    app.use(express.json());
    app.use(postgresRateLimit({ scope: 'test', limit: 5, windowMs: 60_000, ...options }));
    app.post('/', (_req, res) => res.json({ ok: true }));
    app.use(errorHandler);
    return app;
  }
  const keyHashes = () => mocks.createServiceClient.mock.results.map(({ value }) => value.rpc.mock.calls[0][1].p_key_hash);

  beforeEach(() => {
    mocks.createServiceClient.mockImplementation(() => ({ rpc: vi.fn().mockResolvedValue({ data: true, error: null }) }));
  });

  it('ignores client-supplied X-Forwarded-For entries in front of the trusted proxy', async () => {
    const app = limitedApp();
    await request(app).post('/').set('X-Forwarded-For', '1.1.1.1, 203.0.113.9');
    await request(app).post('/').set('X-Forwarded-For', '2.2.2.2, 203.0.113.9');

    const [first, second] = keyHashes();
    expect(first).toBe(second);
  });

  it('counts login attempts per account whatever the source address', async () => {
    const app = limitedApp({ identify: (req) => req.body.email });
    await request(app).post('/').set('X-Forwarded-For', '203.0.113.1').send({ email: 'an@gmail.com' });
    await request(app).post('/').set('X-Forwarded-For', '198.51.100.2').send({ email: 'an@gmail.com' });

    const [first, second] = keyHashes();
    expect(first).toBe(second);
  });
});

describe('attendance CSV export', () => {
  it('keeps an employee-controlled formula as text', async () => {
    mocks.createServiceClient.mockReturnValue(fakeDb((table) => (table === 'users'
      ? { data: { company_id: COMPANY }, error: null }
      : { data: [{ check_in_time: '2026-09-28T01:00:00Z', check_out_time: null, status: 'NORMAL', users: { full_name: '=HYPERLINK("http://evil")', email: 'an@gmail.com' } }], error: null })));

    const response = await request(createApp()).get('/hr/reports/attendance.csv');

    expect(response.status).toBe(200);
    expect(response.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });
});
