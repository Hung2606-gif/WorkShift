-- HR/Employee operational workspace. Apply 001 and 002 first.
alter table public.offices add column if not exists company_id uuid references public.companies(id) on delete cascade;
create index if not exists idx_offices_company_id on public.offices(company_id);
update public.offices set company_id = (select id from public.companies order by created_at limit 1) where company_id is null;

alter table public.users
  add column if not exists job_title varchar(100),
  add column if not exists manager_id uuid references public.users(id) on delete set null,
  add column if not exists phone varchar(30),
  add column if not exists annual_leave_days numeric(5,2) not null default 12;
create index if not exists idx_users_company_role on public.users(company_id, role);

create table if not exists public.work_shifts (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  name varchar(100) not null, start_time time not null, end_time time not null,
  late_grace_minutes integer not null default 10 check (late_grace_minutes >= 0 and late_grace_minutes <= 240),
  is_overnight boolean not null default false, is_active boolean not null default true,
  created_at timestamptz not null default now(), unique(company_id, name)
);
create table if not exists public.employee_shift_assignments (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id) on delete cascade,
  shift_id uuid not null references public.work_shifts(id) on delete cascade,
  work_date date not null, created_at timestamptz not null default now(), unique(user_id, work_date)
);

alter table public.attendances add column if not exists check_out_time timestamptz;
alter table public.attendances add column if not exists adjusted_by uuid references public.users(id) on delete set null;
alter table public.attendances add column if not exists adjustment_note text;

create table if not exists public.employee_requests (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  request_type varchar(20) not null check (request_type in ('LEAVE', 'OVERTIME', 'EXPLANATION')),
  start_at timestamptz not null, end_at timestamptz not null, reason text not null,
  status varchar(20) not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  reviewed_by uuid references public.users(id) on delete set null, review_note text, reviewed_at timestamptz,
  created_at timestamptz not null default now(), check (end_at >= start_at)
);
create index if not exists idx_employee_requests_company_status on public.employee_requests(company_id, status, created_at desc);
create table if not exists public.leave_balances (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id) on delete cascade,
  year integer not null, granted_days numeric(5,2) not null default 12, used_days numeric(5,2) not null default 0,
  unique(user_id, year), check (used_days >= 0 and used_days <= granted_days)
);

alter table public.work_shifts enable row level security;
alter table public.employee_shift_assignments enable row level security;
alter table public.employee_requests enable row level security;
alter table public.leave_balances enable row level security;
