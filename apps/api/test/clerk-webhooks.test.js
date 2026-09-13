import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../src/lib/errors.js';
import { clerkWebhookRouter } from '../src/routes/clerk-webhooks.js';

const mocks = vi.hoisted(() => ({
  verifyWebhook: vi.fn(),
  createServiceClient: vi.fn()
}));

vi.mock('@clerk/express/webhooks', () => ({ verifyWebhook: mocks.verifyWebhook }));
vi.mock('../src/lib/supabase.js', () => ({ createServiceClient: mocks.createServiceClient }));

function createWebhookApp() {
  const app = express();
  app.use('/webhook', express.raw({ type: 'application/json' }), clerkWebhookRouter);
  app.use(errorHandler);
  return app;
}

describe('Clerk webhooks', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects a webhook with an invalid Svix signature', async () => {
    mocks.verifyWebhook.mockRejectedValue(new Error('invalid signature'));

    const response = await request(createWebhookApp())
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .send('{}');

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_WEBHOOK_SIGNATURE');
  });

  it('deactivates a deleted Clerk user while preserving attendance history', async () => {
    mocks.verifyWebhook.mockResolvedValue({ type: 'user.deleted', data: { id: 'user_123' } });
    const eq = vi.fn().mockReturnValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    mocks.createServiceClient.mockReturnValue({ from: vi.fn().mockReturnValue({ update }) });

    const response = await request(createWebhookApp())
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .send('{}');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true, type: 'user.deleted' });
    expect(update).toHaveBeenCalledWith({ is_active: false });
    expect(eq).toHaveBeenCalledWith('clerk_user_id', 'user_123');
  });

  it('acknowledges a user.created event without an email and waits for user.updated', async () => {
    mocks.verifyWebhook.mockResolvedValue({
      type: 'user.created',
      data: {
        id: 'user_2g7np7Hrk0SN6kj5EDMLDaKNL0S',
        first_name: 'John',
        last_name: 'Doe',
        primary_email_address_id: 'idn_2g7np7Hrk0SN6kj5EDMLDaKNL0S',
        email_addresses: []
      }
    });

    const response = await request(createWebhookApp())
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .send('{}');

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({
      received: true,
      type: 'user.created',
      status: 'pending_email'
    });
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
  });

  it('creates an HR profile when a verified company user is created', async () => {
    mocks.verifyWebhook.mockResolvedValue({
      type: 'user.created',
      data: {
        id: 'user_123',
        first_name: 'John',
        last_name: 'Doe',
        primary_email_address_id: 'idn_123',
        email_addresses: [{ id: 'idn_123', email_address: 'john@company.com' }],
        public_metadata: {
          workshiftProvisioned: true,
          workshiftRole: 'HR',
          workshiftCompanyId: 'f46b387b-790b-4665-9f98-1b0b448d2e91',
          workshiftOfficeId: null,
          workshiftFullName: 'John Doe'
        }
      }
    });
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const insert = vi.fn().mockResolvedValue({ error: null });
    mocks.createServiceClient.mockReturnValue({
      from: vi.fn()
        .mockReturnValueOnce({ select })
        .mockReturnValueOnce({ insert })
    });

    const response = await request(createWebhookApp())
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .send('{}');

    expect(response.status).toBe(200);
    expect(insert).toHaveBeenCalledWith({
      clerk_user_id: 'user_123',
      office_id: null,
      company_id: 'f46b387b-790b-4665-9f98-1b0b448d2e91',
      full_name: 'John Doe',
      email: 'john@company.com',
      role: 'HR',
      is_active: true,
      is_temporary_password: false
    });
  });

  it('updates an existing company profile when user.updated omits first and last name', async () => {
    mocks.verifyWebhook.mockResolvedValue({
      type: 'user.updated',
      data: {
        id: 'user_123',
        first_name: null,
        last_name: null,
        username: null,
        primary_email_address_id: 'idn_123',
        email_addresses: [{ id: 'idn_123', email_address: 'updated@company.com' }]
      }
    });
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: 'profile_123', role: 'HR' }, error: null });
    const lookupEq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq: lookupEq });
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: updateEq });
    mocks.createServiceClient.mockReturnValue({
      from: vi.fn()
        .mockReturnValueOnce({ select })
        .mockReturnValueOnce({ update })
    });

    const response = await request(createWebhookApp())
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .send('{}');

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ full_name: 'updated', email: 'updated@company.com' });
    expect(updateEq).toHaveBeenCalledWith('id', 'profile_123');
  });

  it('does not create a profile for an email outside the authorized domains', async () => {
    mocks.verifyWebhook.mockResolvedValue({
      type: 'user.created',
      data: {
        id: 'user_external',
        primary_email_address_id: 'idn_external',
        email_addresses: [{ id: 'idn_external', email_address: 'external@example.com' }]
      }
    });
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const insert = vi.fn();
    mocks.createServiceClient.mockReturnValue({ from: vi.fn().mockReturnValue({ select, insert }) });

    const response = await request(createWebhookApp())
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .send('{}');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('not_authorized');
    expect(insert).not.toHaveBeenCalled();
  });
});
