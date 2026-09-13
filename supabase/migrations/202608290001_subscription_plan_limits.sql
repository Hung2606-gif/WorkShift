-- Replace the legacy trial plan with three fixed subscription plans.
-- Capacity is derived server-side from the selected plan; NULL employees means
-- an ENTERPRISE tenant has no employee-count limit.

alter table public.companies
  drop constraint if exists companies_plan_check,
  drop constraint if exists companies_max_employees_check,
  drop constraint if exists companies_storage_quota_mb_check;

alter table public.companies
  alter column plan drop default,
  alter column max_employees drop not null,
  alter column storage_quota_mb set default 2048;

-- Existing Trial tenants become Starter tenants, then every existing company
-- is normalised to the entitlement for its active plan.
update public.companies
set plan = case
  when plan = 'TRIAL' then 'STARTER'
  when plan in ('STARTER', 'BUSINESS', 'ENTERPRISE') then plan
  else 'STARTER'
end;

update public.companies
set
  max_employees = case plan
    when 'STARTER' then 20
    when 'BUSINESS' then 100
    when 'ENTERPRISE' then null
  end,
  storage_quota_mb = case plan
    when 'STARTER' then 2048       -- 2 GB
    when 'BUSINESS' then 51200     -- 50 GB
    when 'ENTERPRISE' then 1024000 -- 1000 GB
  end,
  updated_at = now();

alter table public.companies
  alter column plan set default 'STARTER',
  add constraint companies_plan_check
    check (plan in ('STARTER', 'BUSINESS', 'ENTERPRISE')),
  add constraint companies_max_employees_check
    check (max_employees is null or max_employees > 0),
  add constraint companies_storage_quota_mb_check
    check (storage_quota_mb > 0);
