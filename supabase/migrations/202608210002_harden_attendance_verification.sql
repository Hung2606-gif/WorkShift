-- Security hardening: account-bound face verification, server-issued challenges,
-- immutable capture evidence, and Supabase Realtime alerts.

alter table public.attendance_logs
  add column if not exists capture_timestamp timestamptz,
  add column if not exists photo_sha256 char(64),
  add column if not exists capture_proof_sha256 char(64),
  add column if not exists liveness_metadata jsonb;

create index if not exists idx_attendance_photo_sha256
  on public.attendance_logs(photo_sha256)
  where photo_sha256 is not null;

-- Existing production rows predate these columns. NOT VALID enforces the rule
-- for future writes without invalidating historical records.
alter table public.attendance_logs
  drop constraint if exists attendance_logs_capture_evidence_required;
alter table public.attendance_logs
  add constraint attendance_logs_capture_evidence_required
  check (
    check_in is null
    or (
      photo_url is not null
      and photo_sha256 is not null
      and capture_proof_sha256 is not null
      and capture_timestamp is not null
      and liveness_metadata is not null
    )
  ) not valid;

create table if not exists public.attendance_challenges (
  nonce uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  check (expires_at > issued_at)
);
create index if not exists idx_attendance_challenges_expiry
  on public.attendance_challenges(expires_at);
alter table public.attendance_challenges enable row level security;

-- This is deliberately 1-to-1: it never searches another employee's faces.
create or replace function public.verify_user_face(
  p_user_id uuid,
  query_embedding vector(128),
  match_threshold real default 0.60
) returns table(is_valid boolean, similarity real)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
  select
    (candidate.similarity >= match_threshold) as is_valid,
    candidate.similarity
  from (
    select (1 - (face_embedding <=> query_embedding))::real as similarity
    from public.user_faces
    where user_id = p_user_id
    order by face_embedding <=> query_embedding
    limit 1
  ) as candidate;
end;
$$;

-- A nonce is valid only if the server issued it for this user before capture.
-- The atomic UPDATE prevents two concurrent requests from consuming it twice.
create or replace function public.consume_checkin_challenge(
  p_nonce uuid,
  p_user_id uuid,
  p_capture_timestamp timestamptz
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  accepted boolean;
begin
  update public.attendance_challenges
  set used_at = now()
  where nonce = p_nonce
    and user_id = p_user_id
    and used_at is null
    and expires_at >= now()
    and p_capture_timestamp >= issued_at
    and p_capture_timestamp <= expires_at
  returning true into accepted;

  return coalesce(accepted, false);
end;
$$;

revoke all on function public.verify_user_face(uuid, vector, real) from public, anon, authenticated;
revoke all on function public.consume_checkin_challenge(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.verify_user_face(uuid, vector, real) to service_role;
grant execute on function public.consume_checkin_challenge(uuid, uuid, timestamptz) to service_role;

-- Retire the global/search-style function and the self-created nonce RPC.
drop function if exists public.match_face_for_user(uuid, vector, real);
drop function if exists public.consume_attendance_nonce(uuid, uuid);

-- Supabase Realtime replaces Socket.IO on Vercel serverless deployments.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'attendance_logs'
     ) then
    alter publication supabase_realtime add table public.attendance_logs;
  end if;
end;
$$;
