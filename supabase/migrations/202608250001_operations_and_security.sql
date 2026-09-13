-- Operational controls added after the Clerk migration. Run this after all
-- existing migrations in the Supabase SQL editor or through Supabase CLI.

alter table public.offices
  add column if not exists work_start time not null default time '09:00',
  add column if not exists work_end time not null default time '18:00',
  add column if not exists late_grace_minutes integer not null default 10 check (late_grace_minutes between 0 and 120),
  add column if not exists early_leave_grace_minutes integer not null default 10 check (early_leave_grace_minutes between 0 and 120),
  add column if not exists require_trusted_device boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'offices_work_hours_valid') then
    alter table public.offices
      add constraint offices_work_hours_valid check (work_end > work_start);
  end if;
end;
$$;

alter table public.users
  alter column email type varchar(255),
  alter column full_name type varchar(255),
  add column if not exists trusted_device_hash char(64),
  add column if not exists trusted_device_set_at timestamptz,
  add column if not exists biometric_delete_requested_at timestamptz;

alter table public.attendance_logs
  add column if not exists biometric_deleted_at timestamptz;
alter table public.attendance_logs
  drop constraint if exists attendance_logs_capture_evidence_required;
alter table public.attendance_logs
  add constraint attendance_logs_capture_evidence_required
  check (
    check_in is null
    or biometric_deleted_at is not null
    or (
      photo_url is not null
      and photo_sha256 is not null
      and capture_proof_sha256 is not null
      and capture_timestamp is not null
      and liveness_metadata is not null
    )
  ) not valid;

create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  kind varchar(50) not null,
  payload jsonb not null default '{}'::jsonb,
  status varchar(20) not null default 'PENDING' check (status in ('PENDING', 'SENT', 'FAILED', 'CANCELLED')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists idx_notification_outbox_pending
  on public.notification_outbox(created_at)
  where status = 'PENDING';
alter table public.notification_outbox enable row level security;

-- Safely bootstrap exactly one administrator without requiring a manual SQL
-- role update. The advisory lock prevents two first users becoming admins.
create or replace function public.bootstrap_first_admin(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated boolean;
begin
  perform pg_advisory_xact_lock(hashtext('workshift:first-admin'));
  if exists (select 1 from public.users where role = 'ADMIN') then
    return false;
  end if;
  update public.users set role = 'ADMIN' where id = p_user_id and is_active = true
  returning true into updated;
  return coalesce(updated, false);
end;
$$;
revoke all on function public.bootstrap_first_admin(uuid) from public, anon, authenticated;
grant execute on function public.bootstrap_first_admin(uuid) to service_role;

-- Old biometric evidence is deleted by a server-side worker after an explicit
-- request. Storage-object deletion remains an API-worker responsibility.
create or replace function public.list_biometric_deletions()
returns table(user_id uuid, photo_url text)
language sql
security definer
set search_path = public
as $$
  select uf.user_id, uf.photo_url
  from public.user_faces uf
  join public.users u on u.id = uf.user_id
  where u.biometric_delete_requested_at is not null
  union all
  select al.user_id, al.photo_url
  from public.attendance_logs al
  join public.users u on u.id = al.user_id
  where u.biometric_delete_requested_at is not null and al.photo_url is not null;
$$;
revoke all on function public.list_biometric_deletions() from public, anon, authenticated;
grant execute on function public.list_biometric_deletions() to service_role;
