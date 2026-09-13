-- Password recovery by registered Vietnamese mobile number.
-- Clerk remains the password authority; this table contains only a one-way
-- HMAC of a short-lived OTP, never a password or plaintext verification code.

create or replace function public.normalize_workshift_phone(p_phone text)
returns varchar
language plpgsql
immutable
strict
as $$
declare
  v_input text := btrim(p_phone);
  v_digits text;
  v_phone varchar(16);
begin
  if v_input = '' or length(v_input) > 30 or v_input !~ '^[0-9+().[:space:]-]+$' then
    return null;
  end if;

  v_digits := regexp_replace(v_input, '[^0-9]', '', 'g');
  if v_digits like '00%' then
    v_digits := substring(v_digits from 3);
  end if;

  if v_digits like '84%' then
    v_phone := '+' || v_digits;
  elsif v_digits like '0%' then
    v_phone := '+84' || substring(v_digits from 2);
  else
    return null;
  end if;

  if v_phone !~ '^\+84[35789][0-9]{8}$' then
    return null;
  end if;
  return v_phone;
end;
$$;

alter table public.users
  add column if not exists phone_e164 varchar(16),
  add column if not exists auth_version integer not null default 1;

alter table public.users
  drop constraint if exists users_auth_version_positive;
alter table public.users
  add constraint users_auth_version_positive check (auth_version >= 1);

update public.users
set phone_e164 = public.normalize_workshift_phone(phone)
where phone_e164 is distinct from public.normalize_workshift_phone(phone);

create or replace function public.sync_user_phone_e164()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.phone_e164 := public.normalize_workshift_phone(new.phone);
  return new;
end;
$$;

drop trigger if exists users_sync_phone_e164 on public.users;
create trigger users_sync_phone_e164
before insert or update of phone on public.users
for each row execute function public.sync_user_phone_e164();

-- A recovery number must identify exactly one account.  Existing duplicate
-- values must be corrected before this migration is applied rather than
-- silently allowing an OTP to reset an arbitrary account.
create unique index if not exists idx_users_phone_e164_unique
  on public.users(phone_e164)
  where phone_e164 is not null;

create table if not exists public.password_reset_otps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  phone_e164 varchar(16) not null,
  otp_hash char(64) not null check (otp_hash ~ '^[0-9a-f]{64}$'),
  delivery_status varchar(16) not null default 'PENDING'
    check (delivery_status in ('PENDING', 'SENT', 'FAILED')),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 5),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  claim_token_hash char(64) check (claim_token_hash is null or claim_token_hash ~ '^[0-9a-f]{64}$'),
  consumed_at timestamptz,
  invalidated_at timestamptz,
  blocked_until timestamptz,
  failure_reason varchar(50),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  check (
    (claimed_at is null and claim_token_hash is null)
    or (claimed_at is not null and claim_token_hash is not null)
  )
);

create index if not exists idx_password_reset_otps_phone_created
  on public.password_reset_otps(phone_e164, created_at desc);
create index if not exists idx_password_reset_otps_active
  on public.password_reset_otps(phone_e164, expires_at desc)
  where delivery_status = 'SENT' and consumed_at is null and invalidated_at is null;
alter table public.password_reset_otps enable row level security;

-- Atomically enforce one SMS/minute, at most five per rolling 24 hours, and a
-- five-minute lockout after five invalid OTP attempts.  The advisory lock is
-- per phone number, so concurrent requests through different API instances
-- cannot bypass these limits.
create or replace function public.create_password_reset_otp(
  p_user_id uuid,
  p_phone_e164 varchar(16),
  p_otp_hash char(64),
  p_expires_in_seconds integer default 300
)
returns table(status varchar, retry_after_seconds integer, otp_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last_created timestamptz;
  v_oldest_daily timestamptz;
  v_daily_count integer;
  v_blocked_until timestamptz;
  v_otp_id uuid;
begin
  if p_phone_e164 !~ '^\+84[35789][0-9]{8}$'
     or p_otp_hash !~ '^[0-9a-f]{64}$'
     or p_expires_in_seconds not between 120 and 600 then
    raise exception 'invalid password reset otp request' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('workshift:password-reset:' || p_phone_e164));

  select max(blocked_until) into v_blocked_until
  from public.password_reset_otps
  where phone_e164 = p_phone_e164 and blocked_until > now();
  if v_blocked_until is not null then
    return query select 'LOCKED'::varchar,
      greatest(1, ceil(extract(epoch from (v_blocked_until - now())))::integer), null::uuid;
    return;
  end if;

  select max(created_at) into v_last_created
  from public.password_reset_otps
  where phone_e164 = p_phone_e164;
  if v_last_created is not null and v_last_created > now() - interval '60 seconds' then
    return query select 'COOLDOWN'::varchar,
      greatest(1, ceil(extract(epoch from ((v_last_created + interval '60 seconds') - now())))::integer), null::uuid;
    return;
  end if;

  select count(*), min(created_at) into v_daily_count, v_oldest_daily
  from public.password_reset_otps
  where phone_e164 = p_phone_e164 and created_at >= now() - interval '24 hours';
  if v_daily_count >= 5 then
    return query select 'DAILY_LIMIT'::varchar,
      greatest(1, ceil(extract(epoch from ((v_oldest_daily + interval '24 hours') - now())))::integer), null::uuid;
    return;
  end if;

  -- A resend invalidates every prior unconsumed code for this number.
  update public.password_reset_otps
  set invalidated_at = now(), failure_reason = 'SUPERSEDED', claimed_at = null, claim_token_hash = null
  where phone_e164 = p_phone_e164
    and consumed_at is null
    and invalidated_at is null;

  insert into public.password_reset_otps (user_id, phone_e164, otp_hash, expires_at)
  values (p_user_id, p_phone_e164, p_otp_hash, now() + make_interval(secs => p_expires_in_seconds))
  returning id into v_otp_id;

  return query select 'CREATED'::varchar, 60, v_otp_id;
end;
$$;

-- A code is only eligible after the SMS provider accepted it.  A failed send
-- remains in the audit/rate-limit history but can never be used to reset a
-- password.
create or replace function public.mark_password_reset_otp_delivery(
  p_otp_id uuid,
  p_delivered boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.password_reset_otps
  set delivery_status = case when p_delivered then 'SENT' else 'FAILED' end,
      sent_at = case when p_delivered then now() else null end,
      invalidated_at = case when p_delivered then invalidated_at else now() end,
      failure_reason = case when p_delivered then failure_reason else 'SMS_DELIVERY_FAILED' end
  where id = p_otp_id and delivery_status = 'PENDING';
  return found;
end;
$$;

-- Claiming serialises Clerk password updates without ever handing the plaintext
-- OTP to PostgreSQL.  A stale one-minute claim can be reclaimed if an API
-- process exits while talking to Clerk.
create or replace function public.claim_password_reset_otp(
  p_phone_e164 varchar(16),
  p_otp_hash char(64),
  p_claim_token_hash char(64)
)
returns table(status varchar, otp_id uuid, user_id uuid, clerk_user_id text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_otp public.password_reset_otps%rowtype;
  v_clerk_user_id text;
  v_next_attempts integer;
begin
  if p_phone_e164 !~ '^\+84[35789][0-9]{8}$'
     or p_otp_hash !~ '^[0-9a-f]{64}$'
     or p_claim_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid password reset otp claim' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('workshift:password-reset:' || p_phone_e164));
  select o.* into v_otp
  from public.password_reset_otps o
  where o.phone_e164 = p_phone_e164
    and o.delivery_status = 'SENT'
    and o.consumed_at is null
    and o.invalidated_at is null
  order by o.created_at desc
  limit 1
  for update;

  if not found then
    return query select 'NOT_FOUND'::varchar, null::uuid, null::uuid, null::text;
    return;
  end if;

  if v_otp.expires_at <= now() then
    update public.password_reset_otps
    set invalidated_at = now(), failure_reason = 'EXPIRED', claimed_at = null, claim_token_hash = null
    where id = v_otp.id;
    return query select 'EXPIRED'::varchar, null::uuid, null::uuid, null::text;
    return;
  end if;

  if v_otp.claimed_at is not null and v_otp.claimed_at > now() - interval '60 seconds' then
    return query select 'PROCESSING'::varchar, null::uuid, null::uuid, null::text;
    return;
  end if;

  if v_otp.otp_hash <> p_otp_hash then
    v_next_attempts := v_otp.attempt_count + 1;
    update public.password_reset_otps
    set attempt_count = v_next_attempts,
        invalidated_at = case when v_next_attempts >= 5 then now() else invalidated_at end,
        blocked_until = case when v_next_attempts >= 5 then now() + interval '5 minutes' else blocked_until end,
        failure_reason = case when v_next_attempts >= 5 then 'ATTEMPTS_EXCEEDED' else failure_reason end,
        claimed_at = null,
        claim_token_hash = null
    where id = v_otp.id;
    if v_next_attempts >= 5 then
      return query select 'ATTEMPTS_EXCEEDED'::varchar, null::uuid, null::uuid, null::text;
    else
      return query select 'INVALID'::varchar, null::uuid, null::uuid, null::text;
    end if;
    return;
  end if;

  select clerk_user_id into v_clerk_user_id
  from public.users
  where id = v_otp.user_id and is_active = true and role in ('HR', 'EMPLOYEE')
  for share;
  if v_clerk_user_id is null then
    update public.password_reset_otps
    set invalidated_at = now(), failure_reason = 'ACCOUNT_UNAVAILABLE'
    where id = v_otp.id;
    return query select 'ACCOUNT_UNAVAILABLE'::varchar, null::uuid, null::uuid, null::text;
    return;
  end if;

  update public.password_reset_otps
  set claimed_at = now(), claim_token_hash = p_claim_token_hash
  where id = v_otp.id;
  return query select 'CLAIMED'::varchar, v_otp.id, v_otp.user_id, v_clerk_user_id;
end;
$$;

create or replace function public.complete_password_reset_otp(
  p_otp_id uuid,
  p_claim_token_hash char(64)
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_auth_version integer;
begin
  update public.password_reset_otps
  set consumed_at = now(), claimed_at = null, claim_token_hash = null, failure_reason = null
  where id = p_otp_id
    and consumed_at is null
    and invalidated_at is null
    and claim_token_hash = p_claim_token_hash
  returning user_id into v_user_id;
  if v_user_id is null then return null; end if;

  update public.users
  set is_temporary_password = false, auth_version = auth_version + 1
  where id = v_user_id
  returning auth_version into v_auth_version;
  return v_auth_version;
end;
$$;

-- Shared by other sensitive account changes (for example, verified email or
-- mobile updates) so all previously issued WorkShift app JWTs are revoked.
create or replace function public.increment_user_auth_version(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_version integer;
begin
  update public.users
  set auth_version = auth_version + 1
  where id = p_user_id
  returning auth_version into v_auth_version;
  return v_auth_version;
end;
$$;

create or replace function public.release_password_reset_otp_claim(
  p_otp_id uuid,
  p_claim_token_hash char(64)
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.password_reset_otps
  set claimed_at = null, claim_token_hash = null
  where id = p_otp_id
    and consumed_at is null
    and invalidated_at is null
    and claim_token_hash = p_claim_token_hash;
  return found;
end;
$$;

revoke all on table public.password_reset_otps from public, anon, authenticated;
revoke all on function public.normalize_workshift_phone(text) from public, anon, authenticated;
revoke all on function public.create_password_reset_otp(uuid, varchar, char, integer) from public, anon, authenticated;
revoke all on function public.mark_password_reset_otp_delivery(uuid, boolean) from public, anon, authenticated;
revoke all on function public.claim_password_reset_otp(varchar, char, char) from public, anon, authenticated;
revoke all on function public.complete_password_reset_otp(uuid, char) from public, anon, authenticated;
revoke all on function public.release_password_reset_otp_claim(uuid, char) from public, anon, authenticated;
revoke all on function public.increment_user_auth_version(uuid) from public, anon, authenticated;
grant execute on function public.normalize_workshift_phone(text) to service_role;
grant execute on function public.create_password_reset_otp(uuid, varchar, char, integer) to service_role;
grant execute on function public.mark_password_reset_otp_delivery(uuid, boolean) to service_role;
grant execute on function public.claim_password_reset_otp(varchar, char, char) to service_role;
grant execute on function public.complete_password_reset_otp(uuid, char) to service_role;
grant execute on function public.release_password_reset_otp_claim(uuid, char) to service_role;
grant execute on function public.increment_user_auth_version(uuid) to service_role;
