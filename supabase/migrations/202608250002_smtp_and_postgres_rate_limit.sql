-- SMTP outbox delivery and a database-backed distributed rate limiter.
-- This deliberately avoids Redis/Upstash and works across API instances.

alter table public.notification_outbox
  drop constraint if exists notification_outbox_status_check;
alter table public.notification_outbox
  add column if not exists locked_at timestamptz,
  add constraint notification_outbox_status_check
    check (status in ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED'));

create table if not exists public.api_rate_limits (
  key_hash char(64) primary key,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now()
);

create or replace function public.consume_api_rate_limit(
  p_key_hash char(64),
  p_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_window timestamptz;
  current_count integer;
begin
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'invalid rate limit configuration';
  end if;
  insert into public.api_rate_limits(key_hash, request_count)
  values (p_key_hash, 0)
  on conflict (key_hash) do nothing;
  select window_started_at, request_count into current_window, current_count
  from public.api_rate_limits where key_hash = p_key_hash for update;
  if current_window + make_interval(secs => p_window_seconds) <= now() then
    update public.api_rate_limits
    set window_started_at = now(), request_count = 1, updated_at = now()
    where key_hash = p_key_hash;
    return true;
  end if;
  if current_count >= p_limit then return false; end if;
  update public.api_rate_limits
  set request_count = request_count + 1, updated_at = now()
  where key_hash = p_key_hash;
  return true;
end;
$$;
revoke all on function public.consume_api_rate_limit(char, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(char, integer, integer) to service_role;

create or replace function public.claim_pending_notifications(p_limit integer default 25)
returns table(id uuid, kind varchar, payload jsonb, email varchar, full_name varchar, attempts integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select n.id
    from public.notification_outbox n
    where n.status = 'PENDING'
       or (n.status = 'PROCESSING' and n.locked_at < now() - interval '15 minutes')
    order by n.created_at
    limit greatest(1, least(p_limit, 100))
    for update skip locked
  ), claimed as (
    update public.notification_outbox n
    set status = 'PROCESSING', locked_at = now(), attempts = n.attempts + 1
    from candidates c
    where n.id = c.id
    returning n.id, n.kind, n.payload, n.attempts, n.user_id
  )
  select c.id, c.kind, c.payload, u.email, u.full_name, c.attempts
  from claimed c
  join public.users u on u.id = c.user_id
  where u.email is not null;
end;
$$;
revoke all on function public.claim_pending_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_pending_notifications(integer) to service_role;
