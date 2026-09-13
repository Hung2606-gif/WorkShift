-- Replace biometric/GPS attendance with tenant-scoped corporate Wi-Fi IP checks.
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name varchar(100) not null,
  allowed_ip inet,
  created_at timestamptz not null default now()
);

alter table public.users add column if not exists company_id uuid references public.companies(id) on delete set null;
create index if not exists idx_users_company_id on public.users(company_id);

-- Existing single-tenant installations receive one starter tenant so an ADMIN
-- can invite the first HR. New invitations pass their tenant ID in Clerk
-- metadata and never rely on this fallback.
insert into public.companies (name)
select 'Default Company'
where not exists (select 1 from public.companies);

update public.users
set company_id = (select id from public.companies order by created_at asc limit 1)
where company_id is null;

create table if not exists public.attendances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  check_in_time timestamptz not null default now(),
  status varchar(20) not null default 'NORMAL' check (status in ('NORMAL', 'LATE')),
  created_at timestamptz not null default now()
);
create index if not exists idx_attendances_user_checkin on public.attendances(user_id, check_in_time desc);

alter table public.companies enable row level security;
alter table public.attendances enable row level security;
