-- WorkShift access policy: one system administrator and one internal company domain.
-- The API enforces the same policy for new Clerk identities.

update public.users
set role = 'ADMIN', is_active = true
where lower(email) = 'hungblockchain06@gmail.com';

update public.users
set role = 'HR'
where lower(email) like '%@company.com'
  and lower(email) <> 'hungblockchain06@gmail.com';

-- Preserve historical records but stop identities outside the configured policy
-- from accessing the application.
update public.users
set is_active = false
where lower(email) <> 'hungblockchain06@gmail.com'
  and lower(email) not like '%@company.com';

drop function if exists public.bootstrap_first_admin(uuid);
