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
create or replace function act_as(uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, false);
  perform set_config('request.jwt.claim.role', 'authenticated', false);
end;
$$;
