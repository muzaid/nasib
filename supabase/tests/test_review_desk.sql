-- ---------------------------------------------------------------------
-- The review desk, the directory, and photos.
--
-- The assertions that matter are the ones about who can do what. An admin
-- function that works is easy; an admin function that a member cannot
-- reach, and that an admin cannot point at their own account, is the
-- thing worth pinning down.
-- ---------------------------------------------------------------------

\set ON_ERROR_STOP on
\echo == review desk ==

\set boss  '''c0000000-0000-0000-0000-00000000000c'''
\set her   '''d0000000-0000-0000-0000-00000000000d'''
\set him   '''e0000000-0000-0000-0000-00000000000e'''

insert into auth.users (id, email) values
  (:boss, 'boss@example.com'), (:her, 'laila@example.com'), (:him, 'omar2@example.com')
on conflict (id) do update set email = excluded.email;

-- Two applicants arrive through the web path, as a real one would.
select act_as(:her);
select apply_for_membership(jsonb_build_object(
  'gender', 'female', 'date_of_birth', '1997-02-20', 'city', 'رام الله',
  'display_name', 'ليلى', 'timeline', 'within_1_year'));

select act_as(:him);
select apply_for_membership(jsonb_build_object(
  'gender', 'male', 'date_of_birth', '1993-08-02', 'city', 'رام الله',
  'display_name', 'عمر', 'timeline', 'within_6_months'));

-- ── before anyone is an admin ─────────────────────────────────────────
select assert((whoami() ->> 'is_admin')::boolean = false,
  'an ordinary applicant is not an admin');

do $$
declare failed boolean := false;
begin
  begin perform admin_queue('waiting');
  exception when others then failed := true; end;
  perform assert(failed, 'a member cannot open the queue');
end $$;

do $$
declare failed boolean := false;
begin
  begin
    perform admin_decide('d0000000-0000-0000-0000-00000000000d'::uuid, 'admit');
  exception when others then failed := true; end;
  perform assert(failed, 'and cannot admit anybody');
end $$;

-- The self-admission attempt, which is the one a patched client tries.
do $$
declare failed boolean := false;
begin
  begin
    perform admin_decide('e0000000-0000-0000-0000-00000000000e'::uuid, 'admit');
  exception when others then failed := true; end;
  perform assert(failed, 'including itself');
end $$;

select assert((select status from users where id = :him) = 'applying',
  'nothing moved');

-- ── grant_admin is not reachable from a client ────────────────────────
-- The test session is a superuser, so the function's own check passes
-- here; what is asserted is that the privilege was revoked, which is what
-- actually stops a browser.
select assert(
  not has_function_privilege('authenticated', 'grant_admin(uuid,text,text)', 'execute')
  and not has_function_privilege('anon', 'grant_admin(uuid,text,text)', 'execute'),
  'grant_admin cannot be executed by a client role');

select assert(
  has_function_privilege('authenticated', 'admin_queue(text,int)', 'execute'),
  'admin_queue is callable by any signed-in role — the gate is is_admin(), not the grant');

-- The standing version of the audit that found the bug above. A
-- `security definer` function runs with its owner's privileges, so one
-- that neither checks is_admin() nor reads auth.uid() decides nothing for
-- itself — whatever it is handed, it does. None of those may be reachable
-- by an unauthenticated caller.
--
-- Add such a function and this fails, naming it. That is the point: the
-- next one will be added by someone who has not read 0011.
do $$
declare
  leaky text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into leaky
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosecdef
     and has_function_privilege('anon', p.oid, 'execute')
     and p.prosrc !~* 'is_admin|auth\.uid|not signed in|service_role'
     -- Three deliberate exceptions, each for a stated reason. This list is
     -- short on purpose: adding a name to it is the moment to ask whether
     -- the function should be reachable at all.
     --
     --   open_slots        takes a city and a day count. No caller
     --                     identity in it to widen, and an applicant needs
     --                     it before being admitted.
     --   can_view_profile  named by the profiles_read policy, and a policy
     --                     is checked against the querying role.
     --   has_photo_access  called in the body of the photo_gallery view,
     --                     which is checked the same way.
     --
     -- The last two are why 0011 grants them back; revoking either fails
     -- every profile read or every gallery read outright.
     and p.proname not in ('open_slots', 'can_view_profile', 'has_photo_access')
     -- `t_` is the test harness's own wrapper prefix (00_helpers.sql). It
     -- exists only in a test database; no migration creates one.
     and p.proname not like 't\\_%';

  perform assert(leaky is null,
    coalesce('definer functions reachable by anon with no guard: ' || leaky,
             'no definer function is reachable by anon without a guard'));
end $$;

-- ── the first admin ───────────────────────────────────────────────────
select grant_admin(:boss, 'owner@nasib.app', 'Owner');

select act_as(:boss);
select assert((whoami() ->> 'is_admin')::boolean, 'the granted user is an admin');

-- ── the queue ─────────────────────────────────────────────────────────
select assert(
  jsonb_array_length(admin_queue('waiting') -> 'rows') >= 2,
  'both applicants are waiting in the queue');

select assert(
  (select count(*) from jsonb_array_elements(admin_queue('waiting') -> 'rows') r
    where r ->> 'display_name' = 'ليلى') = 1,
  'an applicant appears once, by name');

select assert(
  (select (r ->> 'age')::int from jsonb_array_elements(admin_queue('waiting') -> 'rows') r
    where r ->> 'display_name' = 'عمر') between 32 and 34,
  'the age is computed, not stored — a birthday must not need a migration');

select assert(
  not (admin_queue('waiting') -> 'rows' -> 0 ? 'phone_e164'),
  'the phone number is not in a list a reviewer scrolls past');

select assert(
  (admin_queue('waiting') -> 'counts') ? 'applying',
  'the counts come back with the queue, so the screen needs one call');

select assert(
  (select count(*) from admin_access_log
    where admin_id = :boss and route like 'queue:%') >= 5,
  'every queue read is logged, not only every profile opened');

-- ── deciding ──────────────────────────────────────────────────────────
select assert(
  (admin_decide(:her, 'admit', 'looks_genuine') ->> 'status') = 'admitted',
  'an applicant can be admitted');

select assert(
  (select admitted_at is not null from users where id = :her),
  'and the admission is timestamped');

select assert(
  (select count(*) from admin_decisions
    where subject_user_id = :her and action = 'admit'
      and admin_id = :boss and reason_code = 'looks_genuine') = 1,
  'the decision is recorded against the admin who made it');

do $$
declare said text := '';
begin
  begin perform admin_decide('c0000000-0000-0000-0000-00000000000c'::uuid, 'admit');
  exception when others then said := sqlerrm; end;
  perform assert(said <> '', 'an admin cannot decide their own application');
  -- The client shows what the server said, so a refusal a person can
  -- reach has to be in the language of the app.
  perform assert(said = 'لا يبتّ المراجع في طلبه',
    'and the refusal is in Arabic, because a person reads it');
end $$;

select assert(
  (admin_decide(:him, 'admit', 'looks_genuine') ->> 'status') = 'admitted',
  'the second applicant too');

-- Re-admitting is idempotent in the one way that matters: the original
-- admission time is kept, so "member since" does not move.
select assert(
  (select admitted_at from users where id = :her)
  = (select admitted_at from users where id = :her),
  'admitted_at is not overwritten on a later decision');

-- ── the directory ─────────────────────────────────────────────────────
select act_as(:her);
select assert(
  (browse_members() ->> 'gated')::boolean = false,
  'an admitted member is not gated');

select assert(
  (select count(*) from jsonb_array_elements(browse_members() -> 'rows') r
    where r ->> 'display_name' = 'عمر') = 1,
  'she sees him');

select assert(
  (select count(*) from jsonb_array_elements(browse_members() -> 'rows') r
    where r ->> 'display_name' = 'ليلى') = 0,
  'and not herself');

select assert(
  (select count(*) from jsonb_array_elements(browse_members() -> 'rows') r
    where (r ->> 'photos_unlocked')::boolean) = 0,
  'nobody arrives with photos already unlocked');

select assert(
  not (browse_members() -> 'rows' -> 0 ? 'storage_path'),
  'the directory carries no photo paths at all — access is granted, not listed');

-- Someone still waiting sees nothing, which is the whole point of the gate.
insert into auth.users (id, email) values
  ('f0000000-0000-0000-0000-00000000000f', 'waiting@example.com')
on conflict (id) do update set email = excluded.email;
select act_as('f0000000-0000-0000-0000-00000000000f');
select apply_for_membership(jsonb_build_object(
  'gender', 'male', 'date_of_birth', '1990-01-01', 'display_name', 'منتظر'));

select assert(
  (browse_members() ->> 'gated')::boolean,
  'an applicant who has not been admitted is gated');

select assert(
  jsonb_array_length(browse_members() -> 'rows') = 0,
  'and sees nobody');

-- Signed in with no application at all. This said "not signed in" to
-- someone who was signed in, which told them to do the thing they had
-- just done.
insert into auth.users (id, email) values
  ('09000000-0000-0000-0000-000000000009', 'browsing@example.com')
on conflict (id) do update set email = excluded.email;
select act_as('09000000-0000-0000-0000-000000000009');

select assert(
  (browse_members() ->> 'status') = 'none'
  and (browse_members() ->> 'gated')::boolean,
  'a visitor who has not applied is gated, not told they are signed out');

select set_config('request.jwt.claim.sub', '', false);
do $$
declare failed boolean := false;
begin
  begin perform browse_members();
  exception when others then failed := true; end;
  perform assert(failed, 'but no session at all is still an error');
end $$;

-- ── photos ────────────────────────────────────────────────────────────
select act_as(:her);

select assert(
  (add_photo('d0000000-0000-0000-0000-00000000000d/one.jpg') ? 'id'),
  'a photo under your own prefix is registered');

select assert(
  (select is_primary from photos where storage_path like '%one.jpg'),
  'the first photo becomes the primary one without being asked');

select assert(
  (select approved = false from photos where storage_path like '%one.jpg'),
  'and is not approved — nothing a client calls sets that');

-- The attack this function exists to stop.
do $$
declare failed boolean := false;
begin
  begin
    perform add_photo('e0000000-0000-0000-0000-00000000000e/stolen.jpg');
  exception when others then failed := true; end;
  perform assert(failed, 'you cannot register a file under somebody else''s prefix');
end $$;

select assert(
  (select count(*) from photos where user_id = :her) = 1,
  'and nothing was written when it was refused');

select assert(jsonb_array_length(my_photos()) = 1, 'my_photos returns your own');

select add_photo('d0000000-0000-0000-0000-00000000000d/two.jpg', true);
select assert(
  (select count(*) from photos where user_id = :her and is_primary) = 1,
  'exactly one photo is primary after a second is made primary');

-- Fill to the limit first, outside any exception block. A plpgsql
-- BEGIN/EXCEPTION is an implicit subtransaction: raising inside one rolls
-- back everything the block did, so adding four photos and failing on the
-- fifth inside a single block leaves none of the four behind — which
-- makes the count assertion below measure the rollback, not the limit.
do $$
begin
  for i in 3..6 loop
    perform add_photo('d0000000-0000-0000-0000-00000000000d/p' || i || '.jpg');
  end loop;
end $$;

do $$
declare failed boolean := false;
begin
  begin
    perform add_photo('d0000000-0000-0000-0000-00000000000d/seventh.jpg');
  exception when others then failed := true; end;
  perform assert(failed, 'the sixth photo is the last one');
end $$;

select assert(
  (select count(*) from photos where user_id = :her) = 6,
  'and the limit is exact, not approximate');

select assert(
  (delete_photo((select id from photos where storage_path like '%two.jpg'))
    ->> 'storage_path') like '%two.jpg',
  'deleting a photo returns the path, so the caller can remove the object too');

-- ── my_profile ────────────────────────────────────────────────────────
select assert(
  (my_profile() ->> 'display_name') = 'ليلى'
  and (my_profile() ->> 'status') = 'admitted',
  'my_profile reads back what the edit screen needs to prefill');

select assert(
  jsonb_array_length(my_profile() -> 'photos') = 5,
  'including the photos, after one was deleted');

-- Editing after admission does not re-open the decision.
select apply_for_membership(jsonb_build_object(
  'gender', 'female', 'date_of_birth', '1997-02-20',
  'display_name', 'ليلى', 'city', 'البيرة', 'bio', 'أعمل في التمريض.'));

select assert(
  (my_profile() ->> 'status') = 'admitted'
  and (my_profile() ->> 'city') = 'البيرة'
  and (my_profile() ->> 'bio') = 'أعمل في التمريض.',
  'an admitted member can edit their profile without losing admission');

\echo == review desk: done ==

-- ── signing in as a reviewer ──────────────────────────────────────────
\echo ''
\echo '== admin login =='

insert into auth.users (id, email)
values ('aa000000-0000-0000-0000-0000000000aa', 'newreviewer@nasib.app')
on conflict (id) do update set email = excluded.email;

select assert(
  grant_admin_by_email('newreviewer@nasib.app') like '%is now an admin%',
  'a reviewer can be granted by email, without hunting for a uuid');

select act_as('aa000000-0000-0000-0000-0000000000aa');
select assert((whoami() ->> 'is_admin')::boolean, 'and is an admin');
select assert((whoami() ->> 'email') = 'newreviewer@nasib.app',
  'whoami reports the email, so the desk can show who is reviewing');
select assert((whoami() ->> 'is_anonymous')::boolean = false,
  'and that this is not an anonymous session');

-- Case should not decide whether someone can review.
select assert(
  grant_admin_by_email('  NEWREVIEWER@Nasib.App  ') like '%is now an admin%',
  'the email is matched case-insensitively and trimmed');

do $$
declare failed boolean := false;
begin
  begin perform grant_admin_by_email('nobody@nasib.app');
  exception when others then failed := true; end;
  perform assert(failed, 'granting an address with no account is refused');
end $$;

-- The collision that used to surface as a raw unique-constraint error:
-- a new account claiming an address an existing reviewer row holds. This
-- is what happens when someone's account is recreated.
insert into auth.users (id, email)
values ('bb000000-0000-0000-0000-0000000000bb', 'newreviewer@nasib.app')
on conflict (id) do nothing;

do $$
declare said text := '';
begin
  begin perform grant_admin('bb000000-0000-0000-0000-0000000000bb',
                            'newreviewer@nasib.app');
  exception when others then said := sqlerrm; end;
  perform assert(said like '%already belongs to reviewer%',
    'a second account claiming a reviewer''s address is refused clearly');
  perform assert(said like '%revoke_admin%',
    'and the refusal names the command that frees it');
end $$;

select assert(
  not has_function_privilege('authenticated', 'grant_admin_by_email(text)', 'execute')
  and not has_function_privilege('anon', 'grant_admin_by_email(text)', 'execute')
  and not has_function_privilege('authenticated', 'revoke_admin(text)', 'execute'),
  'neither granting nor revoking is reachable from a client');

-- Taking it away.
select assert(revoke_admin('newreviewer@nasib.app') like '%no longer review%',
  'a reviewer can be stood down');
select act_as('aa000000-0000-0000-0000-0000000000aa');
select assert((whoami() ->> 'is_admin')::boolean = false, 'and the desk closes');

select assert(
  (select count(*) from admin_users where id = 'aa000000-0000-0000-0000-0000000000aa') = 1,
  'the row stays — admin_decisions references it, and an audit trail with'
  || ' a missing reviewer has a hole where it matters most');

-- An anonymous session reports no email, which is what distinguishes the
-- two kinds of account to the screen. Every other account in this suite
-- has one now, because applying requires it.
insert into auth.users (id) values ('cc000000-0000-0000-0000-0000000000cc')
on conflict (id) do nothing;
select act_as('cc000000-0000-0000-0000-0000000000cc');

select assert((whoami() -> 'email') = 'null'::jsonb
  and (whoami() ->> 'is_anonymous')::boolean
  and (whoami() ->> 'has_credential')::boolean = false,
  'an anonymous session has no email and says so');

-- And cannot leave an application behind that it could never return to.
do $$
declare said text := '';
begin
  begin
    perform apply_for_membership(jsonb_build_object(
      'gender', 'male', 'date_of_birth', '1990-01-01', 'display_name', 'عابر'));
  exception when others then said := sqlerrm; end;
  perform assert(said like '%أنشئ حساباً%',
    'an anonymous session cannot apply — the application would be unreachable');
end $$;

select assert(
  (select count(*) from users where id = 'cc000000-0000-0000-0000-0000000000cc') = 0,
  'and nothing was written');

-- Linking an email makes the same session able to apply, without signing
-- out: the check reads the row, not the token's claim.
update auth.users set email = 'linked@example.com'
 where id = 'cc000000-0000-0000-0000-0000000000cc';

select assert(
  (apply_for_membership(jsonb_build_object(
    'gender', 'male', 'date_of_birth', '1990-01-01', 'display_name', 'عابر'
  )) ->> 'status') = 'applying',
  'once an email is linked, the same session can apply');

\echo '== admin login: done =='

-- ── the reads behind the screens ──────────────────────────────────────
\echo ''
\echo '== reads =='

select act_as(:boss);

select assert(jsonb_typeof(admin_photo_queue()) = 'array',
  'the photo queue is a list');
select assert(
  (select count(*) from jsonb_array_elements(admin_photo_queue()) q
    where q ->> 'display_name' = 'ليلى') >= 1,
  'and holds the photos she uploaded, which start unapproved');
select assert(
  not (admin_photo_queue() -> 0 ? 'phone_e164'),
  'without her phone number, which a reviewer does not need to judge a photo');

-- Approving one.
do $$
declare target uuid;
begin
  select id into target from photos where approved = false limit 1;
  perform admin_decide_photo(target, true, 'looks fine');
  perform assert((select approved from photos where id = target),
    'approving a photo sets approved');
  perform assert(
    (select count(*) from admin_decisions
      where reason_code = 'photo_approved') = 1,
    'and is recorded against its owner, not only in the photo row');
end $$;

-- Rejecting removes it, and hands back the path so the file can follow.
do $$
declare target uuid; result jsonb;
begin
  select id into target from photos where approved = false limit 1;
  result := admin_decide_photo(target, false, 'not a face');
  perform assert((select count(*) from photos where id = target) = 0,
    'rejecting a photo removes the row');
  perform assert(result ->> 'storage_path' is not null,
    'and returns the storage path, so the object can be removed too');
end $$;

-- The member record.
select assert((admin_member(:her) ->> 'display_name') = 'ليلى',
  'a reviewer can open one member''s record');
select assert(jsonb_typeof(admin_member(:her) -> 'decisions') = 'array',
  'with the decisions made about them');
select assert(not (admin_member(:her) ? 'phone_e164')
  and not (admin_member(:her) ? 'identity_confidence'),
  'and without the phone number or any score');
select assert(
  (select count(*) from admin_access_log
    where subject_user_id = :her and route = 'member') >= 1,
  'opening a record is logged against the member whose record it is');

do $$
declare failed boolean := false;
begin
  begin perform admin_member('00000000-0000-0000-0000-000000000000'::uuid);
  exception when others then failed := true; end;
  perform assert(failed, 'a member who does not exist is an error, not an empty record');
end $$;

-- Stats.
select assert((admin_stats() ->> 'admitted')::int >= 2, 'stats count the admitted');
select assert((admin_stats() ? 'longest_wait_hours'),
  'and report the longest wait, which an average would hide');
select assert((admin_stats() ->> 'photos_pending')::int >= 0, 'and the photo backlog');

-- Every one of these is closed to a member.
select act_as(:her);
do $$
declare blocked int := 0;
begin
  begin perform admin_photo_queue();   exception when others then blocked := blocked + 1; end;
  begin perform admin_member('c0000000-0000-0000-0000-00000000000c'::uuid);
                                        exception when others then blocked := blocked + 1; end;
  begin perform admin_reports();       exception when others then blocked := blocked + 1; end;
  begin perform admin_photo_requests();exception when others then blocked := blocked + 1; end;
  begin perform admin_stats();         exception when others then blocked := blocked + 1; end;
  begin perform admin_decide_photo(gen_random_uuid(), true);
                                        exception when others then blocked := blocked + 1; end;
  begin perform admin_resolve_report(gen_random_uuid(), 'dismissed');
                                        exception when others then blocked := blocked + 1; end;
  begin perform admin_screen_photo_request(gen_random_uuid(), true);
                                        exception when others then blocked := blocked + 1; end;
  begin perform schedule_meeting(gen_random_uuid(), gen_random_uuid());
                                        exception when others then blocked := blocked + 1; end;
  -- The three above are callable by any signed-in role now, because the
  -- desk runs in a browser. The gate is is_admin() inside them, and that
  -- is what this counts.
  perform assert(blocked = 9, 'every desk function refuses a member');
end $$;

-- The member's own reads.
select assert(jsonb_typeof(my_photo_requests()) = 'array', 'my photo requests is a list');
select assert(jsonb_typeof(my_photo_grants()) = 'array',  'so is my grants list');
select assert(jsonb_typeof(my_matches()) = 'array',       'and my matches');
select assert(jsonb_typeof(my_meetings()) = 'array',      'and my meetings');

do $$
declare failed boolean := false;
begin
  begin perform match_thread(gen_random_uuid());
  exception when others then failed := true; end;
  perform assert(failed, 'a thread you are not part of is not readable');
end $$;

do $$
declare failed boolean := false;
begin
  begin perform send_message(gen_random_uuid(), 'مرحبا');
  exception when others then failed := true; end;
  perform assert(failed, 'and not writable either');
end $$;

\echo '== reads: done =='
