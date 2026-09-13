import { createClient } from '@supabase/supabase-js';
import { getConfig } from './config.js';

/** Service client is deliberately created only on the server. */
export function createServiceClient() {
  const config = getConfig();
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { disabled: true }
  });
}
