-- Local-only stubs for what Supabase provides in a hosted project.
-- Never run this against a real Supabase database.

create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text
);

-- The `nullif` matters and is not decoration: an unauthenticated request
-- arrives with the claim set to an empty string, not unset, and casting
-- '' to uuid raises instead of returning null. Hosted Supabase does the
-- same thing, so a stub without it makes local tests pass on a code path
-- that would 500 in production.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(current_setting('request.jwt.claim.role', true), 'authenticated')
$$;

do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role anon;          exception when duplicate_object then null; end $$;
do $$ begin create role service_role;  exception when duplicate_object then null; end $$;

-- To act as a specific signed-in user in psql:
--   set role authenticated;
--   set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
--   set request.jwt.claim.role = 'authenticated';
