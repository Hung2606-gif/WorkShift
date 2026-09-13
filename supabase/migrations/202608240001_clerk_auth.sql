-- Clerk becomes the identity provider. Supabase is retained only for managed
-- application data, storage, PostGIS, and pgvector operations.
alter table public.users
  add column if not exists clerk_user_id text;

-- Existing Supabase Auth identities are preserved for historical records, but
-- new Clerk-provisioned users do not have a Supabase auth.users UUID.
alter table public.users
  alter column auth_user_id drop not null;
alter table public.users
  drop constraint if exists users_auth_user_id_fkey;

create unique index if not exists idx_users_clerk_user_id
  on public.users(clerk_user_id)
  where clerk_user_id is not null;

-- The browser no longer accesses Supabase directly. Keep RLS enabled with no
-- browser policies; the API uses the server-only service role.
drop policy if exists "active users can see offices" on public.offices;
drop policy if exists "admins manage offices" on public.offices;
drop policy if exists "users read own profile" on public.users;
drop policy if exists "admins manage profiles" on public.users;
drop policy if exists "read own attendance or HR" on public.attendance_logs;
drop policy if exists "read audit log as admin" on public.audit_logs;
