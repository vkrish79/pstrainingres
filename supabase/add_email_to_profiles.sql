-- Adds email to profiles, backfills from auth.users.
-- Idempotent: safe to re-run.

alter table profiles add column if not exists email text;

update profiles p
set email = u.email
from auth.users u
where u.id = p.id and (p.email is null or p.email = '');
