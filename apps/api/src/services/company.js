import { HttpError } from '../lib/errors.js';
import { createServiceClient } from '../lib/supabase.js';

/** Fetch the tenant only where tenant-only functionality needs it. */
export async function companyIdForProfile(profile) {
  const { data, error } = await createServiceClient()
    .from('users')
    .select('company_id')
    .eq('id', profile.id)
    .maybeSingle();

  if (error) {
    throw new HttpError(502, 'Cấu hình công ty chưa sẵn sàng. Vui lòng chạy migration Wi-Fi trước.', 'COMPANY_MIGRATION_REQUIRED');
  }
  return data?.company_id ?? null;
}
