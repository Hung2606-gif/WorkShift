import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syncClerkUser } from '../src/services/clerk-profile.js';

const mocks = vi.hoisted(() => ({ createServiceClient: vi.fn() }));

vi.mock('../src/lib/supabase.js', () => ({ createServiceClient: mocks.createServiceClient }));

describe('Clerk profile synchronization', () => {
  beforeEach(() => vi.clearAllMocks());

  it('provisions an invited profile from a camelCase Clerk Backend API user', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const lookupEq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq: lookupEq });
    const insert = vi.fn().mockResolvedValue({ error: null });
    mocks.createServiceClient.mockReturnValue({
      from: vi.fn()
        .mockReturnValueOnce({ select })
        .mockReturnValueOnce({ insert })
    });

    const result = await syncClerkUser({
      id: 'user_oauth_123',
      firstName: 'Nguyen',
      lastName: 'An',
      primaryEmailAddressId: 'idn_oauth_123',
      emailAddresses: [{ id: 'idn_oauth_123', emailAddress: 'employee@gmail.com' }],
      publicMetadata: {
        workshiftProvisioned: true,
        workshiftRole: 'EMPLOYEE',
        workshiftCompanyId: 'f46b387b-790b-4665-9f98-1b0b448d2e91',
        workshiftOfficeId: null,
        workshiftFullName: 'Nguyen An'
      }
    });

    expect(result).toEqual({ status: 'provisioned' });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      clerk_user_id: 'user_oauth_123',
      email: 'employee@gmail.com',
      full_name: 'Nguyen An',
      role: 'EMPLOYEE'
    }));
  });
});
