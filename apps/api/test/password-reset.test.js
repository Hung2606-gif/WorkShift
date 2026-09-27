import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../src/lib/errors.js';
import { passwordResetRouter, passwordResetTiming } from '../src/routes/password-reset.js';

const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  sendEmail: vi.fn(),
  getUser: vi.fn(),
  updateUserMetadata: vi.fn(),
  updateUser: vi.fn()
}));
vi.mock('@clerk/express', () => ({
  clerkClient: { users: { getUser: mocks.getUser, updateUserMetadata: mocks.updateUserMetadata, updateUser: mocks.updateUser } },
  getAuth: vi.fn()
}));
vi.mock('../src/lib/supabase.js', () => ({ createServiceClient: mocks.createServiceClient }));
vi.mock('../src/lib/config.js', () => ({
  getConfig: () => ({ systemAdminEmail: 'admin@gmail.com', companyEmailDomain: 'company.com', otpPepper: 'p'.repeat(32), smtp: { host: 'smtp.test' }, sms: null })
}));
vi.mock('../src/services/notifications.js', () => ({ sendPasswordResetOtpEmail: mocks.sendEmail }));
vi.mock('../src/services/sms.js', () => ({ sendPasswordResetOtpSms: vi.fn() }));

const account = { id: '22222222-2222-4222-8222-222222222222', clerk_user_id: 'user_1', email: 'an@gmail.com', full_name: 'An', role: 'EMPLOYEE', is_active: true, is_temporary_password: true };
let privateMetadata;
let dbWrites;

/** Answers profile lookups: only an@gmail.com has an account. */
function fakeDb() {
  return {
    from(table) {
      const calls = [];
      const builder = new Proxy({}, {
        get(_target, method) {
          if (method === 'then') {
            const lookup = calls.find(([name]) => name === 'eq' || name === 'in');
            if (calls.some(([name]) => name === 'update')) dbWrites.push({ table, calls });
            const found = table === 'users' && lookup?.[0] === 'eq' && lookup[2] === account.email;
            return (resolve) => resolve({ data: table === 'users' && !calls.some(([name]) => name === 'update') ? (found ? [account] : []) : null, error: null });
          }
          return (...args) => { calls.push([method, ...args]); return builder; };
        }
      });
      return builder;
    }
  };
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/reset', passwordResetRouter);
  app.use(errorHandler);
  return app;
}
const requestCode = (identifier) => request(createApp()).post('/reset/request-otp').send({ identifier });
const confirm = (otpCode, identifier = account.email) => request(createApp()).post('/reset/confirm').send({ identifier, otpCode, newPassword: 'a-new-long-password-123' });
const sentCode = () => mocks.sendEmail.mock.calls.at(-1)[0].code;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-28T01:00:00Z'));
  passwordResetTiming.requestMinimumMs = 0;
  passwordResetTiming.confirmFailureMinimumMs = 0;
  privateMetadata = {};
  dbWrites = [];
  mocks.createServiceClient.mockImplementation(fakeDb);
  mocks.getUser.mockImplementation(async () => ({ privateMetadata }));
  mocks.updateUserMetadata.mockImplementation(async (_id, update) => {
    if (update.privateMetadata) privateMetadata = { ...privateMetadata, ...update.privateMetadata };
  });
  mocks.updateUser.mockResolvedValue({});
});
afterEach(() => vi.useRealTimers());

describe('password reset request', () => {
  it('gives the same answer for unknown and known accounts and only emails the known one', async () => {
    const unknown = await requestCode('nobody@gmail.com');
    const known = await requestCode('An@Gmail.com');

    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmail.mock.calls[0][0]).toMatchObject({ to: account.email });
    expect(sentCode()).toMatch(/^\d{6}$/);
    expect(JSON.stringify(privateMetadata)).not.toContain(sentCode());
  });

  it('does not send another code during the resend cooldown', async () => {
    await requestCode(account.email);
    vi.setSystemTime(new Date('2026-09-28T01:00:30Z'));
    const again = await requestCode(account.email);

    expect(again.status).toBe(200);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('takes the same minimum time whether or not the account exists', async () => {
    vi.useRealTimers();
    passwordResetTiming.requestMinimumMs = 300;
    for (const identifier of ['nobody@gmail.com', account.email]) {
      const startedAt = Date.now();
      await requestCode(identifier);
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(290);
    }
  });

  it('rejects something that is neither an email nor a Vietnamese mobile number', async () => {
    const response = await requestCode('not-an-identifier');
    expect(response.status).toBe(422);
  });
});

describe('password reset confirmation', () => {
  it('sets the new password once with the right code and clears the temporary-password flag', async () => {
    await requestCode(account.email);
    const code = sentCode();

    const response = await confirm(code);
    const reuse = await confirm(code);

    expect(response.status).toBe(200);
    expect(mocks.updateUser).toHaveBeenCalledWith('user_1', { password: 'a-new-long-password-123', signOutOfOtherSessions: true });
    expect(mocks.updateUserMetadata).toHaveBeenCalledWith('user_1', { publicMetadata: { workshiftTemporaryPassword: false } });
    expect(dbWrites.some(({ table, calls }) => table === 'users' && calls.some(([method, value]) => method === 'update' && value.is_temporary_password === false))).toBe(true);
    expect(reuse.status).toBe(400);
    expect(mocks.updateUser).toHaveBeenCalledTimes(1);
  });

  it('answers a wrong code and an unknown account with the same error', async () => {
    await requestCode(account.email);
    const wrong = await confirm(sentCode() === '000000' ? '111111' : '000000');
    const unknown = await confirm('123456', 'nobody@gmail.com');

    expect(wrong.status).toBe(400);
    expect(unknown.body).toEqual(wrong.body);
  });

  it('locks the code after five wrong attempts', async () => {
    await requestCode(account.email);
    const code = sentCode();
    const wrongCode = code === '000000' ? '111111' : '000000';
    for (let attempt = 0; attempt < 5; attempt += 1) await confirm(wrongCode);

    const response = await confirm(code);

    expect(response.status).toBe(400);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('rejects a code after five minutes', async () => {
    await requestCode(account.email);
    vi.setSystemTime(new Date('2026-09-28T01:05:01Z'));

    const response = await confirm(sentCode());

    expect(response.status).toBe(400);
  });
});
