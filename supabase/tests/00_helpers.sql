-- Test helpers, loaded before the suites.

create or replace function assert(condition boolean, label text) returns void
language plpgsql as $$
begin
  if condition then
    raise notice '  ok   %', label;
  else
    raise exception 'FAILED: %', label;
  end if;
end;
$$;

-- Become a signed-in user. Pair it with `set role authenticated` when the
-- assertion is about row-level security; leave the role alone when the
-- call is one the service role makes (an admin function, or setup).
create or replace function act_as(uid uuid, session uuid default null) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, false);
  perform set_config('request.jwt.claim.role', 'authenticated', false);
  -- A sign-in, not just an identity. Tests that do not care pass none,
  -- and get a fresh one — which is the honest default, since every real
  -- token carries one.
  perform set_config('request.jwt.claim.session_id',
                     coalesce(session, gen_random_uuid())::text, false);
end;
$$;

