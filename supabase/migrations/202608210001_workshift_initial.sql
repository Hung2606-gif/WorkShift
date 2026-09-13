-- WorkShift initial schema. Run through Supabase CLI: supabase db push
create extension if not exists pgcrypto;
create extension if not exists postgis;
create extension if not exists vector;
-- pg_cron is available on Supabase projects that enable it in Database > Extensions.
create extension if not exists pg_cron;

create table if not exists public.offices (
  id uuid primary key default gen_random_uuid(),
  name varchar(100) not null,
  allowed_ip inet,
  allowed_bssid varchar(17),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  radius_meters real not null default 50 check (radius_meters > 0 and radius_meters <= 1000),
  created_at timestamptz not null default now()
);

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  office_id uuid references public.offices(id) on delete set null,
  full_name varchar(100) not null,
  email varchar(100) not null unique,
  role varchar(20) not null default 'EMPLOYEE' check (role in ('ADMIN', 'HR', 'EMPLOYEE')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.user_faces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  photo_url text not null,
  face_embedding vector(128) not null,
  is_primary boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_user_faces_embedding on public.user_faces using hnsw (face_embedding vector_cosine_ops);
create index if not exists idx_user_faces_user on public.user_faces(user_id);

create table if not exists public.attendance_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id),
  office_id uuid references public.offices(id) on delete set null,
  check_in timestamptz,
  check_out timestamptz,
  date date not null default ((now() at time zone 'Asia/Ho_Chi_Minh')::date),
  status varchar(20) not null default 'NORMAL' check (status in ('NORMAL', 'LATE', 'EARLY_LEAVE', 'ABSENT')),
  checkin_ip inet,
  checkin_lat double precision check (checkin_lat between -90 and 90),
  checkin_lng double precision check (checkin_lng between -180 and 180),
  accuracy_meters real check (accuracy_meters > 0),
  device_hash varchar(255),
  photo_url text,
  face_match_score real check (face_match_score between 0 and 1),
  is_flagged boolean not null default false,
  flag_reason text,
  review_note text,
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id, date),
  check ((check_in is null) = (checkin_lat is null)),
  check ((check_in is null) = (checkin_lng is null))
);
create index if not exists idx_attendance_user_date on public.attendance_logs(user_id, date desc);
create index if not exists idx_attendance_flagged on public.attendance_logs(is_flagged) where is_flagged = true;
create index if not exists idx_attendance_device_date on public.attendance_logs(device_hash, date);

create table if not exists public.attendance_nonces (
  nonce uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  used_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '5 minutes')
);
create index if not exists idx_attendance_nonces_expiry on public.attendance_nonces(expires_at);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.users(id) on delete set null,
  action varchar(50) not null,
  metadata jsonb not null default '{}'::jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_action_time on public.audit_logs(action, created_at desc);

-- Auth helper is SECURITY DEFINER to avoid RLS recursion when policies query public.users.
create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.users where auth_user_id = auth.uid() limit 1;
$$;

create or replace function public.is_hr_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_role() in ('ADMIN', 'HR'), false);
$$;

-- Only the server (service_role) can submit vectors to these RPC functions.
create or replace function public.match_face_for_user(
  p_user_id uuid,
  query_embedding vector(128),
  match_threshold real default 0.60
) returns table(similarity real)
language sql
stable
security definer
set search_path = public
as $$
  select (1 - (face_embedding <=> query_embedding))::real as similarity
  from public.user_faces
  where user_id = p_user_id
    and (1 - (face_embedding <=> query_embedding)) >= match_threshold
  order by face_embedding <=> query_embedding
  limit 1;
$$;

create or replace function public.validate_checkin_distance(
  user_lat double precision,
  user_lng double precision,
  p_office_id uuid
) returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  off_lat double precision;
  off_lng double precision;
  rad_meters real;
begin
  select latitude, longitude, radius_meters into off_lat, off_lng, rad_meters
  from public.offices where id = p_office_id;

  if off_lat is null or off_lng is null or rad_meters is null then return false; end if;
  return st_dwithin(
    st_setsrid(st_makepoint(user_lng, user_lat), 4326)::geography,
    st_setsrid(st_makepoint(off_lng, off_lat), 4326)::geography,
    rad_meters
  );
end;
$$;

create or replace function public.consume_attendance_nonce(p_nonce uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.attendance_nonces(nonce, user_id) values (p_nonce, p_user_id);
  return true;
exception when unique_violation then
  return false;
end;
$$;

revoke all on function public.match_face_for_user(uuid, vector, real) from public, anon, authenticated;
revoke all on function public.validate_checkin_distance(double precision, double precision, uuid) from public, anon, authenticated;
revoke all on function public.consume_attendance_nonce(uuid, uuid) from public, anon, authenticated;
grant execute on function public.match_face_for_user(uuid, vector, real) to service_role;
grant execute on function public.validate_checkin_distance(double precision, double precision, uuid) to service_role;
grant execute on function public.consume_attendance_nonce(uuid, uuid) to service_role;

alter table public.offices enable row level security;
alter table public.users enable row level security;
alter table public.user_faces enable row level security;
alter table public.attendance_logs enable row level security;
alter table public.attendance_nonces enable row level security;
alter table public.audit_logs enable row level security;

create policy "active users can see offices" on public.offices for select to authenticated using (
  exists (select 1 from public.users u where u.auth_user_id = auth.uid() and u.is_active)
);
create policy "admins manage offices" on public.offices for all to authenticated using (public.current_role() = 'ADMIN') with check (public.current_role() = 'ADMIN');

create policy "users read own profile" on public.users for select to authenticated using (auth_user_id = auth.uid() or public.is_hr_or_admin());
create policy "admins manage profiles" on public.users for all to authenticated using (public.current_role() = 'ADMIN') with check (public.current_role() = 'ADMIN');

-- No browser policy is granted for face vectors or original photos.
create policy "read own attendance or HR" on public.attendance_logs for select to authenticated using (
  user_id = (select id from public.users where auth_user_id = auth.uid()) or public.is_hr_or_admin()
);
create policy "read audit log as admin" on public.audit_logs for select to authenticated using (public.current_role() = 'ADMIN');

-- Private bucket: original biometric photos are only accessed by the API service key.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('face-samples', 'face-samples', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create policy "service role manages face samples" on storage.objects for all to service_role
using (bucket_id = 'face-samples') with check (bucket_id = 'face-samples');

-- Daily absence marking and nonce retention. Jobs are created once with the migration.
select cron.schedule(
  'workshift-mark-daily-absent',
  '59 16 * * *', -- 23:59 Asia/Ho_Chi_Minh (UTC+7)
  $$
    insert into public.attendance_logs (user_id, office_id, date, status)
    select u.id, u.office_id, (now() at time zone 'Asia/Ho_Chi_Minh')::date, 'ABSENT'
    from public.users u
    where u.is_active = true and u.role = 'EMPLOYEE'
    on conflict (user_id, date) do nothing;
  $$
);
select cron.schedule(
  'workshift-clean-expired-nonces',
  '15 * * * *',
  $$delete from public.attendance_nonces where expires_at < now() - interval '1 day';$$
);
