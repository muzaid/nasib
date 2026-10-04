-- ---------------------------------------------------------------------
-- Banned addresses, one session at a time, and the sign-in warning.
-- ---------------------------------------------------------------------

\set ON_ERROR_STOP on
\echo ''
\echo '== account security =='

\set OWNER  '''c0000000-0000-0000-0000-00000000000c'''
\set SARA   '''d1000000-0000-0000-0000-0000000000d1'''
\set S_ONE  '''11111111-aaaa-4aaa-8aaa-111111111111'''
\set S_TWO  '''22222222-bbbb-4bbb-8bbb-222222222222'''

insert into auth.users (id, email) values (:SARA, 'sara.security@example.com')
on conflict (id) do update set email = excluded.email;

-- ── one session at a time ─────────────────────────────────────────────
select act_as(:SARA, :S_ONE);
select assert((register_session('phone') ->> 'current')::boolean,
  'the first sign-in is the current one');
select assert(jsonb_array_length(register_session('phone') -> 'others') = 0,
  'and there is nobody else to warn about');

-- She signs in somewhere else.
select act_as(:SARA, :S_TWO);
select assert((register_session('laptop') ->> 'current')::boolean,
  'the newer sign-in becomes the current one');
select assert((register_session('laptop') ->> 'displaced')::int >= 0,
  'and reports how many it displaced');

-- The first one is now out.
select act_as(:SARA, :S_ONE);
select assert((register_session('phone') ->> 'current')::boolean = false,
  'the older sign-in is no longer current — one login at a time');
select assert(register_session('phone') ->> 'reason' = 'superseded',
  'and is told why');

-- It cannot write, either. A displaced session that can still send
-- messages is not a displaced session.
do $$
declare failed boolean := false;
begin
  begin perform send_message(gen_random_uuid(), 'مرحبا');
  exception when others then failed := true; end;
  perform assert(failed, 'and a superseded session cannot send a message');
end $$;

-- ── the warning ───────────────────────────────────────────────────────
select act_as(:SARA, :S_TWO);
select assert(
  (select count(*) from jsonb_array_elements(register_session('laptop') -> 'others') o
    where o ->> 'session_id' = :S_ONE) = 1,
  'the current session is told about the other sign-in');

select assert(
  (select count(*) from jsonb_array_elements(my_sessions()) s
    where (s ->> 'is_this_one')::boolean) = 1,
  'the history marks which sign-in you are using now');

select acknowledge_sessions();
select assert(jsonb_array_length(register_session('laptop') -> 'others') = 0,
  'once seen, the warning stops');

-- A superseded session never becomes current again: the browser it
-- belongs to has to sign in, which issues a new session id. So the
-- intruder here is a third sign-in, not the revival of the first.
\set S_THREE '''33333333-cccc-4ccc-8ccc-333333333333'''
select act_as(:SARA, :S_THREE);
select assert((register_session('someone else''s laptop') ->> 'current')::boolean,
  'a third sign-in takes over in turn');

select act_as(:SARA, :S_ONE);
select assert((register_session('phone') ->> 'current')::boolean = false,
  'and a session once superseded stays superseded, even on re-registering');

-- "That was not me." — pressed from the session that is current.
select act_as(:SARA, :S_THREE);
select register_session('someone else''s laptop');
select assert(
  (select count(*) from user_sessions
    where user_id = :SARA and ended_at is null and session_id <> :S_THREE) = 0,
  'only the current sign-in is live');
select assert((sign_out_other_sessions() ->> 'ended')::int = 0,
  'so signing out the others has nothing left to end');
select assert(
  (select count(*) from user_sessions
    where user_id = :SARA and ended_at is null) = 1,
  'and this one is untouched — it is the one pressing the button');

-- ── banned addresses ──────────────────────────────────────────────────
select act_as(:OWNER);
select assert((admin_ban_email('scammer@example.com', 'asked_for_money') ->> 'email')
  = 'scammer@example.com', 'an address can be banned');
select assert(
  (admin_ban_email('  SCAMMER@Example.COM ') ->> 'email') = 'scammer@example.com',
  'and the address is normalised, so case is not an escape');

-- A reviewer's address cannot be banned from the desk.
do $$
declare failed boolean := false;
begin
  begin perform admin_ban_email('owner@nasib.app', 'test');
  exception when others then failed := true; end;
  perform assert(failed, 'a reviewer''s own address cannot be banned from here');
end $$;

-- Someone who signed up and never applied: an auth account with no
-- `users` row. The most likely person to ban, and the case that used to
-- fail, because the audit row references the application.
insert into auth.users (id, email) values
  ('d2000000-0000-0000-0000-0000000000d2', 'never.applied@example.com')
on conflict (id) do update set email = excluded.email;

select assert((admin_ban_email('never.applied@example.com', 'fake_profile')
  ->> 'account_found')::boolean,
  'an address with an account but no application can be banned');
select assert((admin_ban_email('never.applied@example.com')
  ->> 'account_closed')::boolean = false,
  'and says plainly that there was no application to close');

-- And one who did apply: the account closes and the decision is recorded.
select act_as(:SARA, gen_random_uuid());
select apply_for_membership(jsonb_build_object(
  'gender', 'female', 'date_of_birth', '1995-01-01', 'display_name', 'سارة'));
select act_as(:OWNER);

select assert((admin_ban_email('sara.security@example.com', 'fake_profile')
  ->> 'account_closed')::boolean, 'banning an address closes the account on it');
select assert((select status from users where id = :SARA) = 'banned',
  'the account is banned');
select assert(
  (select count(*) from admin_decisions
    where subject_user_id = :SARA and action = 'ban_account') = 1,
  'and the ban is recorded against them');
select assert(
  (select count(*) from user_sessions where user_id = :SARA and ended_at is null) = 0,
  'and every session it held is ended — the ban takes effect now, not at expiry');

-- The banned person cannot apply again.
select act_as(:SARA, gen_random_uuid());
select assert((whoami() ->> 'banned')::boolean,
  'the app is told the account is banned, so it can stop rather than refuse everything');

do $$
declare said text := '';
begin
  begin
    perform apply_for_membership(jsonb_build_object(
      'gender', 'female', 'date_of_birth', '1995-01-01', 'display_name', 'محاولة'));
  exception when others then said := sqlerrm; end;
  perform assert(said <> '', 'a banned address cannot apply');
  perform assert(said not like '%محظور%' and said not like '%banned%',
    'and the refusal does not say the address is the problem — that is the thing to change');
end $$;

-- The list, and lifting a ban.
select act_as(:OWNER);
select assert(
  (select count(*) from jsonb_array_elements(admin_banned_emails()) b
    where b ->> 'email' = 'scammer@example.com') = 1,
  'the banned list is readable by a reviewer');

select assert((admin_unban_email('scammer@example.com') ->> 'unbanned')::boolean,
  'a ban can be lifted');

do $$
declare failed boolean := false;
begin
  begin perform admin_unban_email('nobody@example.com');
  exception when others then failed := true; end;
  perform assert(failed, 'lifting a ban that does not exist is an error, not a shrug');
end $$;

-- Lifting the ban does not reopen the account: the address may be used
-- again, which is not the same as saying the old decision was wrong.
select assert((select status from users where id = :SARA) = 'banned',
  'and the account stays closed');

-- ── none of it is reachable by a member ───────────────────────────────
select act_as(:SARA, gen_random_uuid());
do $$
declare blocked int := 0;
begin
  begin perform admin_ban_email('x@example.com', 'r');
                                   exception when others then blocked := blocked + 1; end;
  begin perform admin_unban_email('x@example.com');
                                   exception when others then blocked := blocked + 1; end;
  begin perform admin_banned_emails();
                                   exception when others then blocked := blocked + 1; end;
  perform assert(blocked = 3, 'banning is a reviewer''s action, not a member''s');
end $$;

select assert(
  not has_function_privilege('anon', 'is_banned_email(text)', 'execute')
  and not has_function_privilege('authenticated', 'is_banned_email(text)', 'execute'),
  'and the "is this address banned" oracle is reachable by no client at all');

\echo '== account security: done =='
