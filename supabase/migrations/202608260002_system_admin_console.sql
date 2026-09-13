-- System-admin console: tenant plans, global configuration, support and audit.
-- Apply 202608260001_company_wifi_attendance.sql first.
alter table public.companies
  add column if not exists code varchar(40) unique,
  add column if not exists plan varchar(20) not null default 'TRIAL' check (plan in ('TRIAL', 'STARTER', 'BUSINESS', 'ENTERPRISE')),
  add column if not exists max_employees integer not null default 25 check (max_employees > 0),
  add column if not exists storage_quota_mb integer not null default 1024 check (storage_quota_mb > 0),
  add column if not exists features jsonb not null default '{}'::jsonb,
  add column if not exists is_active boolean not null default true,
  add column if not exists subscription_ends_at timestamptz,
  add column if not exists support_access_enabled boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.system_settings (
  id uuid primary key default gen_random_uuid(),
  namespace varchar(30) not null check (namespace in ('GENERAL', 'HOLIDAYS', 'LEAVE_TYPES', 'SECURITY')),
  setting_key varchar(80) not null,
  setting_value jsonb not null,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique(namespace, setting_key)
);

create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  template_key varchar(80) not null unique,
  subject varchar(200) not null,
  body text not null,
  channel varchar(20) not null default 'EMAIL' check (channel in ('EMAIL', 'IN_APP')),
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Secret values stay in the deployment secret manager. `config` is restricted
-- to non-secret provider settings such as sender name or OAuth client ID.
create table if not exists public.system_integrations (
  id uuid primary key default gen_random_uuid(),
  provider varchar(30) not null unique check (provider in ('RESEND', 'SENDGRID', 'GOOGLE', 'MICROSOFT', 'SMS')),
  display_name varchar(100) not null,
  config jsonb not null default '{}'::jsonb,
  is_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.global_ip_rules (
  id uuid primary key default gen_random_uuid(),
  cidr cidr not null,
  action varchar(10) not null check (action in ('ALLOW', 'DENY')),
  description varchar(300),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(cidr, action)
);

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  created_by uuid references public.users(id) on delete set null,
  subject varchar(200) not null,
  description text not null,
  status varchar(20) not null default 'OPEN' check (status in ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')),
  priority varchar(20) not null default 'NORMAL' check (priority in ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_support_tickets_status on public.support_tickets(status, updated_at desc);

create table if not exists public.impersonation_sessions (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references public.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  reason text not null,
  expires_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_impersonation_sessions_company on public.impersonation_sessions(company_id, expires_at desc);

create or replace function public.is_global_ip_allowed(p_ip inet)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select action <> 'DENY'
    from public.global_ip_rules
    where is_active and p_ip <<= cidr
    order by masklen(cidr) desc, created_at desc
    limit 1
  ), true);
$$;

revoke all on function public.is_global_ip_allowed(inet) from public, anon, authenticated;
grant execute on function public.is_global_ip_allowed(inet) to service_role;

alter table public.system_settings enable row level security;
alter table public.email_templates enable row level security;
alter table public.system_integrations enable row level security;
alter table public.global_ip_rules enable row level security;
alter table public.support_tickets enable row level security;
alter table public.impersonation_sessions enable row level security;
