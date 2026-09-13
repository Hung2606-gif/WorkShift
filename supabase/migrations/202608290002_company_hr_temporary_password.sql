-- Tenant contact address and mandatory first-password-change state.
-- Passwords are never stored in this database: Clerk owns and hashes them.

alter table public.companies
  add column if not exists company_email varchar(255);

create unique index if not exists idx_companies_company_email
  on public.companies (company_email)
  where company_email is not null;

alter table public.users
  add column if not exists is_temporary_password boolean not null default false;
