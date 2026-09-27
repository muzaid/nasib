-- ---------------------------------------------------------------------
-- A reviewer signs in with an email and a password.
--
-- Until now an admin was an anonymous session in one browser's local
-- storage. That is fine for the first hour of a test deployment and
-- wrong for everything after: clear the site data and the identity is
-- gone, the admin_users row points at an id nobody holds, and there is no
-- way to review from a second device.
--
-- What changes here is small, because the authentication itself is
-- Supabase's job. An admin account is an ordinary user with an email and
-- a password — created in the dashboard or by the owner — and the only
-- new thing is granting it, by email, without having to find its uuid.
--
-- What does NOT change: nothing reachable from a browser can make an
-- admin. Both functions below are invoker functions with EXECUTE revoked
-- from PUBLIC, so they run from the SQL editor and nowhere else. The
-- login screen authenticates; it never authorises.
-- ---------------------------------------------------------------------

-- Granting by email, because copying a uuid out of the dashboard to paste
-- into a second query is a step that invites pasting the wrong one.
create or replace function grant_admin_by_email(user_email text)
  returns text
  language plpgsql
  set search_path = public
as $$
declare
  target uuid;
  found_count int;
begin
  -- Counted and fetched separately: uuid has no min() aggregate, and
  -- there is nothing to order these by that would mean anything anyway.
  select count(*) into found_count
    from auth.users where lower(email) = lower(trim(user_email));

  if found_count = 0 then
    raise exception 'no account with the email %. Create it first: Authentication → Users → Add user', user_email;
  end if;

  -- Not expected — auth.users has a unique index on email — but a
  -- silently-picked row here would grant admin to an account nobody
  -- chose, so it stops instead.
  if found_count > 1 then
    raise exception 'more than one account has the email %', user_email;
  end if;

  select id into target
    from auth.users where lower(email) = lower(trim(user_email));

  return grant_admin(target, lower(trim(user_email)), null);
end;
$$;

revoke all on function grant_admin_by_email(text) from public, authenticated, anon;


-- The other half, which was missing: taking it away. A reviewer who
-- leaves keeps their login otherwise — the account stays, the review
-- desk closes.
--
-- `active = false` rather than a delete, because admin_decisions
-- references admin_users, and a decision whose reviewer has been erased
-- is an audit trail with a hole in exactly the place it matters.
create or replace function revoke_admin(user_email text)
  returns text
  language plpgsql
  set search_path = public
as $$
declare
  target uuid;
begin
  select id into target from auth.users where lower(email) = lower(trim(user_email));
  if target is null then
    raise exception 'no account with the email %', user_email;
  end if;

  update admin_users set active = false where id = target;
  if not found then
    raise exception '% is not a reviewer', user_email;
  end if;

  return format('%s can no longer review. Their past decisions are unchanged.', user_email);
end;
$$;

revoke all on function revoke_admin(text) from public, authenticated, anon;


-- `whoami` gains the signed-in email, so the desk can show which account
-- is reviewing. An anonymous session has none, and a reviewer seeing
-- their own email at the top is the cheapest guard against deciding from
-- the wrong account on a shared machine.
create or replace function whoami()
  returns jsonb
  language sql
  security definer
  set search_path = public
  stable
as $$
  select jsonb_build_object(
    'user_id',      auth.uid(),
    'is_admin',     is_admin(),
    'email',        (select nullif(email, '') from auth.users where id = auth.uid()),
    'is_anonymous', (select coalesce(nullif(email, '') is null, true)
                       from auth.users where id = auth.uid()),
    'status',       (select status from users where id = auth.uid()),
    'has_row',      exists (select 1 from users where id = auth.uid())
  )
$$;

grant execute on function whoami() to authenticated, anon;


-- grant_admin upserts on `id`, but admin_users.email is unique too. So
-- granting a NEW account an address some existing reviewer row already
-- holds failed with a raw constraint error — and that is not a corner
-- case: it is precisely what happens when a reviewer's account is
-- recreated, which is the ordinary consequence of losing a password
-- before this migration existed.
--
-- It refuses, with the two things the operator needs: that the address is
-- already held, and the command that frees it. Silently moving the grant
-- to the new account would be the same operation, minus the moment where
-- someone confirms that the two accounts belong to the same person.
create or replace function grant_admin(
  target uuid,
  email  text default null,
  name   text default null
) returns text
  language plpgsql
  set search_path = public
as $$
declare
  resolved text := coalesce(lower(trim(email)), target::text || '@local');
  clash    uuid;
begin
  if not exists (select 1 from auth.users where id = target) then
    raise exception 'no such user: %', target;
  end if;

  select id into clash
    from admin_users where lower(admin_users.email) = resolved and id <> target;

  if clash is not null then
    raise exception
      'the address % already belongs to reviewer %. Stand that one down first: select revoke_admin(%L);',
      resolved, clash, resolved;
  end if;

  insert into admin_users (id, email, full_name, role)
  values (target, resolved, coalesce(name, 'Owner'), 'admin')
  on conflict (id) do update
    set active = true, role = 'admin', email = excluded.email;

  return format('%s is now an admin', target);
end;
$$;

revoke all on function grant_admin(uuid, text, text) from public, authenticated, anon;
