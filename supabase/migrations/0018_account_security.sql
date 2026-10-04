-- ---------------------------------------------------------------------
-- Banning an address, one session at a time, and telling someone when
-- their account is signed into somewhere else.
--
-- One honest limit up front, because it shapes all of this: authentication
-- happens in Supabase's auth service, not here. A wrong password never
-- reaches any of our code, so "someone tried to log in and failed" is not
-- a thing this can report. What it can report — and what actually matters
-- — is that somebody *succeeded* from a second place. That is the signal
-- a person can act on, and the one an attacker cannot avoid producing.
-- ---------------------------------------------------------------------


-- ═══════════════════════════════════════════════════════════════════
-- Banned addresses
-- ═══════════════════════════════════════════════════════════════════
--
-- Not a column on `users`, because the point is to outlive the account.
-- Ban the account alone and the same person signs up again in two
-- minutes; the row has to survive the deletion of everything it refers
-- to, so it holds the address and nothing else.
create table if not exists banned_emails (
  email       text primary key,
  reason      text not null,
  notes       text,
  banned_by   uuid references admin_users(id),
  created_at  timestamptz not null default now()
);

alter table banned_emails enable row level security;
-- No client policy at all. A member has no business reading this list,
-- and a banned person learning which address is blocked learns exactly
-- what to change.

create or replace function is_banned_email(candidate text)
  returns boolean
  language sql
  security definer
  set search_path = public
  stable
as $$
  select exists (select 1 from banned_emails where email = lower(trim(candidate)))
$$;


create or replace function admin_ban_email(
  target_email text,
  reason       text default 'reviewed',
  notes        text default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  normalised text := lower(trim(target_email));
  existing   uuid;
begin
  if not is_admin() then
    raise exception 'not an admin';
  end if;

  if normalised = '' or normalised not like '%@%' then
    raise exception 'هذا ليس بريداً صالحاً';
  end if;

  -- An admin banning their own address, or another reviewer's, would
  -- lock the desk. Refused rather than allowed and regretted.
  if exists (select 1 from admin_users where lower(email) = normalised and active) then
    raise exception 'هذا بريد مراجع — لا يُحظر من هنا';
  end if;

  insert into banned_emails (email, reason, notes, banned_by)
  values (normalised, reason, notes, auth.uid())
  on conflict (email) do update
    set reason = excluded.reason, notes = excluded.notes,
        banned_by = excluded.banned_by, created_at = now();

  -- Close the account that address holds now, if there is one. Banning
  -- the address without closing the account leaves them signed in.
  select id into existing from auth.users where lower(email) = normalised;

  if existing is not null then
    -- End every session it holds, whether or not there is an application
    -- behind it, so the ban takes effect now rather than whenever their
    -- token happens to expire.
    update user_sessions set ended_at = now(), ended_reason = 'banned'
     where user_id = existing and ended_at is null;

    -- The account row and the decision only exist if they applied.
    -- Someone who signed up and never applied has an auth account and no
    -- `users` row, and admin_decisions references that row — so writing
    -- the audit line unconditionally fails on exactly the people most
    -- likely to be banned: the ones who registered and did nothing yet.
    if exists (select 1 from users where id = existing) then
      perform set_config('nasib.reviewing', 'on', true);
      update users set status = 'banned' where id = existing;

      insert into admin_decisions (admin_id, subject_user_id, action, reason_code, notes)
      values (auth.uid(), existing, 'ban_account', reason, notes);
    end if;
  end if;

  return jsonb_build_object(
    'email', normalised,
    'account_found', existing is not null,
    'account_closed', existing is not null
      and exists (select 1 from users where id = existing));
end;
$$;


create or replace function admin_unban_email(target_email text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  normalised text := lower(trim(target_email));
begin
  if not is_admin() then
    raise exception 'not an admin';
  end if;

  delete from banned_emails where email = normalised;
  if not found then
    raise exception 'هذا البريد غير محظور';
  end if;

  -- The account is NOT reopened. Lifting a ban says the address may be
  -- used again; it does not say the old account was judged wrongly, and
  -- conflating the two would quietly reverse a decision nobody revisited.
  return jsonb_build_object('email', normalised, 'unbanned', true);
end;
$$;


create or replace function admin_banned_emails(limit_to int default 100)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'not an admin';
  end if;

  return coalesce((
    select jsonb_agg(row_to_json(b)::jsonb order by b.created_at desc)
    from (
      select e.email, e.reason, e.notes, e.created_at,
             a.full_name as banned_by
        from banned_emails e
        left join admin_users a on a.id = e.banned_by
       order by e.created_at desc
       limit least(greatest(limit_to, 1), 500)
    ) b), '[]'::jsonb);
end;
$$;


-- ═══════════════════════════════════════════════════════════════════
-- One session at a time
-- ═══════════════════════════════════════════════════════════════════
--
-- Each sign-in gets its own session id in the token. Recording them lets
-- the newest one stand and the rest be ended — which is what "one login"
-- means in practice — and gives the account's owner something to look at
-- when they want to know who else has been in.
--
-- What is deliberately NOT stored: the IP address. It would make the
-- list read better ("from Ramallah") and it is a location history of a
-- person on a marriage app, kept forever, for a feature that works
-- without it. The user agent is enough to say "a different phone".
create table if not exists user_sessions (
  session_id    uuid primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  user_agent    text,
  started_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  ended_at      timestamptz,
  ended_reason  text,                         -- superseded | signed_out | banned
  -- False until the owner has seen it in their sign-in list. What drives
  -- the "someone signed in" warning.
  acknowledged  boolean not null default false
);

create index if not exists user_sessions_user_idx
  on user_sessions(user_id, started_at desc);

alter table user_sessions enable row level security;
drop policy if exists user_sessions_own on user_sessions;
create policy user_sessions_own on user_sessions for select
  using (auth.uid() = user_id);


-- The session id from the token. Null for a session issued before this
-- claim existed, which is treated as "cannot be tracked" rather than as
-- an error — nobody should be locked out by a missing claim.
create or replace function current_session_id()
  returns uuid
  language plpgsql
  stable
  set search_path = public
as $$
begin
  return nullif(auth.jwt() ->> 'session_id', '')::uuid;
exception when others then
  return null;
end;
$$;


/**
 * Record this session, end the others, and say what happened.
 *
 * Called when the app starts and on its refresh poll. Returns whether
 * this session is still the current one, so a client whose session has
 * been superseded can sign itself out — and returns the other sign-ins
 * the owner has not seen yet, which is the warning.
 */
create or replace function register_session(agent text default null)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  uid  uuid := auth.uid();
  sid  uuid := current_session_id();
  displaced int := 0;
  unseen jsonb;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  -- No session claim: nothing to track, and nothing to enforce. Say so
  -- rather than pretending the account is protected.
  if sid is null then
    return jsonb_build_object('tracked', false, 'current', true, 'others', '[]'::jsonb);
  end if;

  insert into user_sessions (session_id, user_id, user_agent)
  values (sid, uid, left(coalesce(agent, ''), 300))
  on conflict (session_id) do update set last_seen_at = now();

  -- If this session has been ended by a newer one, it is not current.
  if exists (select 1 from user_sessions
              where session_id = sid and ended_at is not null) then
    return jsonb_build_object(
      'tracked', true, 'current', false,
      'reason', (select ended_reason from user_sessions where session_id = sid),
      'others', '[]'::jsonb);
  end if;

  -- One at a time: everything older than this one ends.
  update user_sessions
     set ended_at = now(), ended_reason = 'superseded'
   where user_id = uid and session_id <> sid and ended_at is null;
  get diagnostics displaced = row_count;

  -- Sign-ins the owner has not been shown yet, excluding this one. This
  -- is the notification: a session they did not start, on their account.
  select coalesce(jsonb_agg(row_to_json(s)::jsonb order by s.started_at desc), '[]'::jsonb)
    into unseen
  from (
    select session_id, user_agent, started_at, ended_reason
      from user_sessions
     where user_id = uid and session_id <> sid and not acknowledged
     order by started_at desc
     limit 10
  ) s;

  return jsonb_build_object(
    'tracked', true, 'current', true,
    'displaced', displaced,
    'others', unseen);
end;
$$;


/** Mark the other sign-ins as seen, so the warning stops. */
create or replace function acknowledge_sessions()
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  update user_sessions set acknowledged = true
   where user_id = auth.uid() and not acknowledged;

  return jsonb_build_object('acknowledged', true);
end;
$$;


/**
 * "That was not me."
 *
 * Ends every session but this one and returns how many. It cannot change
 * the password — that is the auth service's job and the client does it
 * next — but ending the sessions first means the intruder is out before
 * the password changes rather than after.
 */
create or replace function sign_out_other_sessions()
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  sid uuid := current_session_id();
  ended int := 0;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  update user_sessions
     set ended_at = now(), ended_reason = 'signed_out', acknowledged = true
   where user_id = auth.uid()
     and ended_at is null
     and (sid is null or session_id <> sid);
  get diagnostics ended = row_count;

  return jsonb_build_object('ended', ended);
end;
$$;


/** The account's own sign-in history, for the security screen. */
create or replace function my_sessions(limit_to int default 20)
  returns jsonb
  language sql
  security definer
  set search_path = public
  stable
as $$
  select coalesce(jsonb_agg(row_to_json(s)::jsonb order by s.started_at desc), '[]'::jsonb)
  from (
    select session_id, user_agent, started_at, last_seen_at, ended_at, ended_reason,
           session_id = current_session_id() as is_this_one
      from user_sessions
     where user_id = auth.uid()
     order by started_at desc
     limit least(greatest(limit_to, 1), 100)
  ) s
$$;


-- ═══════════════════════════════════════════════════════════════════
-- Enforcement
-- ═══════════════════════════════════════════════════════════════════

-- A banned address cannot apply. The check is here and not only in the
-- screen, because the screen is the part an attacker replaces.
create or replace function apply_for_membership(application jsonb)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  uid uuid := auth.uid();
  dob date;
  my_email text;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  if not has_credential() then
    raise exception 'أنشئ حساباً ببريد وكلمة مرور قبل إرسال الطلب، حتى تتمكن من العودة إليه';
  end if;

  select nullif(email, '') into my_email from auth.users where id = uid;

  -- The refusal says nothing about why. A banned person learning that
  -- their address is the problem learns exactly what to change.
  if my_email is not null and is_banned_email(my_email) then
    raise exception 'تعذّر إرسال الطلب. راسل الدعم إن كنت ترى أن هذا خطأ.';
  end if;

  begin
    dob := (application ->> 'date_of_birth')::date;
  exception when others then
    raise exception 'date_of_birth must be a date (YYYY-MM-DD)';
  end;

  if dob is null then
    raise exception 'date_of_birth is required';
  end if;

  if dob > current_date - interval '18 years' then
    raise exception 'هذا التطبيق لمن أتمّ الثامنة عشرة';
  end if;

  insert into users (
    id, phone_e164, gender, date_of_birth, country_code, city, applied_at
  ) values (
    uid,
    nullif(trim(application ->> 'phone'), ''),
    (application ->> 'gender')::gender_t,
    dob,
    coalesce(nullif(trim(application ->> 'country_code'), ''), 'PS'),
    nullif(trim(application ->> 'city'), ''),
    now()
  )
  on conflict (id) do update set
    gender        = excluded.gender,
    country_code  = excluded.country_code,
    city          = excluded.city;

  insert into profiles (
    user_id, display_name, bio, occupation, marital_status, children_count,
    practice_level, timeline, willing_to_relocate, family_aware,
    wali_required, living_after_marriage
  ) values (
    uid,
    coalesce(nullif(trim(application ->> 'display_name'), ''), 'بدون اسم'),
    nullif(trim(application ->> 'bio'), ''),
    nullif(trim(application ->> 'occupation'), ''),
    coalesce((application ->> 'marital_status')::marital_status_t, 'never_married'),
    coalesce((application ->> 'children_count')::int, 0),
    coalesce((application ->> 'practice_level')::practice_level_t, 'prefer_not_to_say'),
    coalesce((application ->> 'timeline')::timeline_t, 'when_right_person'),
    coalesce((application ->> 'willing_to_relocate')::boolean, false),
    coalesce((application ->> 'family_aware')::boolean, false),
    coalesce((application ->> 'wali_required')::boolean, false),
    nullif(trim(application ->> 'living_after_marriage'), '')
  )
  on conflict (user_id) do update set
    display_name          = excluded.display_name,
    bio                   = excluded.bio,
    occupation            = excluded.occupation,
    marital_status        = excluded.marital_status,
    children_count        = excluded.children_count,
    practice_level        = excluded.practice_level,
    timeline              = excluded.timeline,
    willing_to_relocate   = excluded.willing_to_relocate,
    family_aware          = excluded.family_aware,
    wali_required         = excluded.wali_required,
    living_after_marriage = excluded.living_after_marriage,
    updated_at            = now();

  return my_application();
end;
$$;


-- Sending a message is the action a stolen session is most likely to be
-- used for, so it refuses a session that has been superseded. Reads are
-- left alone: a displaced session already has whatever it has read, and
-- adding the check everywhere buys little for the cost.
create or replace function send_message(p_match_id uuid, p_body text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  m matches;
  new_id uuid;
  sid uuid := current_session_id();
begin
  if coalesce(trim(p_body), '') = '' then
    raise exception 'الرسالة فارغة';
  end if;

  if sid is not null and exists (
       select 1 from user_sessions where session_id = sid and ended_at is not null) then
    raise exception 'انتهت هذه الجلسة. سُجّل الدخول من جهاز آخر.';
  end if;

  select * into m from matches
   where id = p_match_id and (user_a = auth.uid() or user_b = auth.uid());

  if m.id is null then
    raise exception 'لا توجد هذه المحادثة';
  end if;

  if m.state not in ('active', 'pending') then
    raise exception 'هذه المحادثة مغلقة';
  end if;

  insert into messages (match_id, sender_id, body)
  values (m.id, auth.uid(), p_body)
  returning id into new_id;

  return jsonb_build_object('id', new_id);
end;
$$;


-- whoami carries the ban, so the shell can close the app rather than
-- letting someone wander a product that will refuse everything they do.
create or replace function whoami()
  returns jsonb
  language sql
  security definer
  set search_path = public
  stable
as $$
  select jsonb_build_object(
    'user_id',        auth.uid(),
    'is_admin',       is_admin(),
    'email',          (select nullif(email, '') from auth.users where id = auth.uid()),
    'has_credential', has_credential(),
    'is_anonymous',   not has_credential(),
    'banned',         coalesce(
                        (select is_banned_email(email) from auth.users where id = auth.uid()),
                        false),
    'status',         (select status from users where id = auth.uid()),
    'has_row',        exists (select 1 from users where id = auth.uid())
  )
$$;


-- Not granted to a client at all. It takes an address as an argument and
-- answers whether it is banned — which, reachable from a browser, is a
-- way to test addresses one at a time until you find the blocked one.
-- The functions that need it are `security definer` and run as the owner,
-- so nothing breaks. (PUBLIC holds EXECUTE on every new function, so
-- granting to `authenticated` alone would have left it open to `anon`;
-- the audit assertion in the suite is what caught that.)
revoke all on function is_banned_email(text) from public, anon, authenticated;
grant execute on function is_banned_email(text)            to service_role;
grant execute on function admin_ban_email(text, text, text) to authenticated;
grant execute on function admin_unban_email(text)          to authenticated;
grant execute on function admin_banned_emails(int)         to authenticated;
grant execute on function register_session(text)           to authenticated;
grant execute on function acknowledge_sessions()           to authenticated;
grant execute on function sign_out_other_sessions()        to authenticated;
grant execute on function my_sessions(int)                 to authenticated;
grant execute on function current_session_id()             to authenticated;
grant execute on function whoami()                         to authenticated, anon;
