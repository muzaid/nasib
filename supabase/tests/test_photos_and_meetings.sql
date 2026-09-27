-- =====================================================================
-- Photo consent and office meetings.
--
-- The photo assertions matter more than anything else in this repository.
-- If one of them ever fails, a woman's face has been shown to someone she
-- did not agree to show it to, which is the exact failure this product
-- exists to prevent. They are written adversarially on purpose.
--
-- Discipline in this file: user actions run as `authenticated` so that row
-- level security is genuinely exercised; admin actions run as the service
-- role, which is how the console actually calls them. A test that runs
-- everything as superuser proves nothing about RLS.
--
--   psql -d nasib -v ON_ERROR_STOP=1 -f supabase/tests/test_photos_and_meetings.sql
-- =====================================================================

\set AMIRA    '11111111-1111-1111-1111-111111111111'
\set YOUSEF   '22222222-2222-2222-2222-222222222222'
\set LINA     '44444444-4444-4444-4444-444444444444'
\set TAREQ    '66666666-6666-6666-6666-666666666666'
\set KHALED   '33333333-3333-3333-3333-333333333333'
\set REVIEWER 'dddddddd-dddd-dddd-dddd-dddddddddddd'

\echo ''
\echo '== every photo is blurred until its owner says otherwise =='

select act_as(:'YOUSEF');
set role authenticated;

select assert(
  not has_photo_access(:'YOUSEF', :'AMIRA'),
  'being matched does NOT by itself give access to her photos'
);

select assert(
  (select count(*) from photo_gallery where user_id = :'AMIRA') = 2,
  'a matched viewer can see that she has photos'
);

select assert(
  (select bool_and(not revealed) from photo_gallery where user_id = :'AMIRA'),
  'and every one of them comes back blurred'
);

select assert(
  (select bool_and(blurred_path is not null) from photo_gallery where user_id = :'AMIRA'),
  'what is served is the blurred derivative, generated server-side'
);

-- A column that does not exist cannot leak.
select assert(
  not exists (select 1 from information_schema.columns
              where table_name = 'photo_gallery' and column_name = 'storage_path'),
  'the gallery view carries no column holding the clear original'
);

do $$
begin
  begin
    perform reveal_photo((select id from photo_gallery
                          where user_id = '11111111-1111-1111-1111-111111111111' limit 1));
    raise exception 'FAILED: a photo was revealed with no grant';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
    raise notice '  ok   reveal_photo refuses when there is no grant';
  end;
end $$;

\echo ''
\echo '== asking =='

select request_photo_access(:'AMIRA', 'أتشرف بالتعرف على عائلتك') as req \gset
select assert(:'req' <> '', 'a matched user may ask to see photos');

select assert(
  (select state from photo_access_requests where id = :'req') = 'pending_admin',
  'the request goes to a reviewer first, not straight to her'
);

do $$
begin
  begin
    perform request_photo_access('11111111-1111-1111-1111-111111111111');
    raise exception 'FAILED: a second live request to the same person was accepted';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
    raise notice '  ok   one live request per pair — the feature cannot be used to pester';
  end;
end $$;

do $$
begin
  begin
    perform request_photo_access('33333333-3333-3333-3333-333333333333');
    raise exception 'FAILED: photos were requested from a stranger';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
    raise notice '  ok   you cannot ask someone you have never been shown';
  end;
end $$;

-- She must not know the request exists until it has been screened.
select act_as(:'AMIRA');
select assert(
  (select count(*) from photo_access_requests where id = :'req') = 0,
  'she cannot see the request while it is still with the reviewer'
);

\echo ''
\echo '== the reviewer screens, then relays =='

reset role;
select act_as(:'REVIEWER');

select admin_screen_photo_request(:'req', true, 'clean history, matched a week ago');

select act_as(:'AMIRA');
set role authenticated;
select assert(
  (select count(*) from photo_access_requests where id = :'req') = 1,
  'once relayed, she sees it'
);
select assert(
  (select state from photo_access_requests where id = :'req') = 'pending_owner',
  'and it is waiting on her'
);

-- A request the reviewer blocks must never surface to her at all.
select act_as(:'TAREQ');
select draw_daily_slate(:'TAREQ', 6);
select request_photo_access(:'AMIRA') as req2 \gset

reset role;
select act_as(:'REVIEWER');
select admin_screen_photo_request(:'req2', false, 'three reports against this account');

select act_as(:'AMIRA');
set role authenticated;
select assert(
  (select count(*) from photo_access_requests where id = :'req2') = 0,
  'a blocked request never reaches her — she is never troubled by it'
);

select act_as(:'TAREQ');
select assert(
  (select count(*) from photo_access_requests where id = :'req2') = 1,
  'the requester still sees his own request, and is told nothing about why'
);

\echo ''
\echo '== she decides =='

select act_as(:'YOUSEF');
do $$
begin
  begin
    perform respond_to_photo_request(
      (select id from photo_access_requests where state = 'pending_owner' limit 1), true);
    raise exception 'FAILED: a requester approved his own request';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
    raise notice '  ok   a requester cannot approve his own request';
  end;
end $$;

select act_as(:'AMIRA');
select respond_to_photo_request(:'req', true) as grant_id \gset
select assert(:'grant_id' <> '', 'her approval is what creates the grant');

select act_as(:'YOUSEF');
select assert(has_photo_access(:'YOUSEF', :'AMIRA'), 'and only then does he have access');
select assert(
  (select bool_and(revealed) from photo_gallery where user_id = :'AMIRA'),
  'the gallery now reports her photos as revealed'
);
select assert(
  reveal_photo((select id from photo_gallery where user_id = :'AMIRA' and ordinal = 0))
    like 'reveals/%',
  'what he receives is a watermarked copy, never the original object'
);

select act_as(:'AMIRA');
select assert(
  (select view_count from photo_access_grants where id = :'grant_id') = 1,
  'every view is counted, so she can see who looked and when'
);

\echo ''
\echo '== consent is revocable, and it expires on its own =='

select revoke_photo_access(:'grant_id');
select assert(not has_photo_access(:'YOUSEF', :'AMIRA'), 'revocation takes effect immediately');

select act_as(:'YOUSEF');
select assert(
  (select bool_and(not revealed) from photo_gallery where user_id = :'AMIRA'),
  'and the photos go straight back to blurred'
);

do $$
begin
  begin
    perform reveal_photo((select id from photo_gallery
                          where user_id = '11111111-1111-1111-1111-111111111111' limit 1));
    raise exception 'FAILED: a revoked grant still revealed a photo';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
    raise notice '  ok   a revoked grant reveals nothing';
  end;
end $$;

do $$
begin
  begin
    perform revoke_photo_access((select id from photo_access_grants limit 1));
    raise exception 'FAILED: a viewer revoked a grant that was not his';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
    raise notice '  ok   only the owner or a reviewer can revoke';
  end;
end $$;

reset role;
update photo_access_grants
   set revoked_at = null, expires_at = now() - interval '1 hour'
 where id = :'grant_id';
set role authenticated;

select assert(not has_photo_access(:'YOUSEF', :'AMIRA'),
              'an expired grant denies access without anyone doing anything');

\echo ''
\echo '== screen capture =='

-- A fresh grant to exercise the capture rules against.
reset role;
select act_as(:'TAREQ');
set role authenticated;
select request_photo_access(:'AMIRA', 'أعدكم بالجدية') as req3 \gset

reset role;
select act_as(:'REVIEWER');
select admin_screen_photo_request(:'req3', true, 'ok');

select act_as(:'AMIRA');
set role authenticated;
select respond_to_photo_request(:'req3', true) as g3 \gset

select act_as(:'TAREQ');
select assert(has_photo_access(:'TAREQ', :'AMIRA'), 'the second viewer has access');

select assert(
  record_screen_event(:'g3', 'screenshot_attempt') = 'warned',
  'the first screenshot warns rather than punishing — it is usually a mistake'
);
select assert(has_photo_access(:'TAREQ', :'AMIRA'), 'and access survives it');

select assert(
  record_screen_event(:'g3', 'screenshot_attempt') = 'revoked',
  'the second screenshot revokes access automatically'
);
select assert(
  not has_photo_access(:'TAREQ', :'AMIRA'),
  'and it takes effect without the owner having to do anything'
);

do $$
begin
  begin
    perform record_screen_event(
      (select id from photo_access_grants where revoked_at is not null limit 1),
      'screenshot_attempt');
    raise exception 'FAILED: an event was recorded against a dead grant';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
    raise notice '  ok   nothing can be recorded against a revoked grant';
  end;
end $$;

-- A client must not be able to run up someone else's count and get their
-- access revoked for them.
select act_as(:'YOUSEF');
do $$
begin
  begin
    perform record_screen_event(
      (select id from photo_access_grants limit 1), 'screenshot_attempt');
    raise exception 'FAILED: one viewer reported an event against another''s grant';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
    raise notice '  ok   only the viewer on a grant can report against it';
  end;
end $$;

do $$
begin
  begin
    perform record_screen_event((select id from photo_access_grants limit 1), 'nonsense');
    raise exception 'FAILED: an unknown event kind was accepted';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
    raise notice '  ok   unknown event kinds are refused';
  end;
end $$;

do $$
begin
  begin
    insert into photo_view_events (grant_id, kind)
    values ((select id from photo_access_grants limit 1), 'screenshot_attempt');
    raise exception 'FAILED: the events table was writable directly';
  exception when insufficient_privilege then
    raise notice '  ok   events go through the function or not at all';
  end;
end $$;

-- The owner's view of what happened to her photos.
select act_as(:'AMIRA');
select assert(
  (select screenshot_count from my_photo_grants where id = :'g3') = 2,
  'she can see how many times he screenshotted them'
);
select assert(
  (select revoke_reason from my_photo_grants where id = :'g3') = 'screenshot_threshold',
  'and why the access ended'
);
select assert(
  not exists (select 1 from information_schema.columns
              where table_name = 'my_photo_grants' and column_name like '%phone%'),
  'that view carries no contact details for the viewer'
);

\echo ''
\echo '== office meetings =='

select act_as(:'YOUSEF');
select id as match_id from matches limit 1 \gset

select propose_office_meeting(:'match_id', true, 'أهلاً، هل يناسبك لقاء في المكتب؟') as meet \gset
select assert(:'meet' <> '', 'either party may propose a meeting at the office');

do $$
declare mt uuid;
begin
  select id into mt from meetings where state = 'proposed' limit 1;
  begin
    perform respond_to_meeting(mt, true);
    raise exception 'FAILED: the proposer answered on the other person''s behalf';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
    raise notice '  ok   the proposer cannot accept his own proposal';
  end;
end $$;

reset role;
select act_as(:'REVIEWER');
do $$
begin
  begin
    perform schedule_meeting((select id from meetings where state = 'proposed' limit 1),
                             (select slot_id from open_slots() limit 1));
    raise exception 'FAILED: a room was booked before both sides agreed';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
    raise notice '  ok   no room is booked until both people have agreed';
  end;
end $$;

select act_as(:'AMIRA');
set role authenticated;
select respond_to_meeting(:'meet', true, true);
select assert(
  (select state from meetings where id = :'meet') = 'pending_scheduling',
  'once both agree, it enters the scheduling queue'
);
select assert(
  (select proposer_brings_family and invitee_brings_family from meetings where id = :'meet'),
  'both said they are bringing family, which changes how the room is set up'
);

\echo ''
\echo '== slots =='

select assert((select count(*) from open_slots()) >= 3, 'open slots are offered to users');
select assert(not exists (select 1 from open_slots() where starts_at < now()),
              'a slot in the past is never offered');

do $$
begin
  begin
    perform count(*) from office_slots;
    raise exception 'FAILED: slot occupancy was browsable by a user';
  exception when insufficient_privilege then
    raise notice '  ok   slot occupancy is not browsable — it would reveal who meets whom';
  end;
end $$;

reset role;
select assert(
  not exists (select 1 from open_slots() o join office_slots s on s.id = o.slot_id
              where s.booked_count >= s.capacity),
  'a slot that is already taken is never offered'
);

select act_as(:'REVIEWER');
select slot_id from open_slots() limit 1 \gset
select schedule_meeting(:'meet', :'slot_id');

select assert((select state from meetings where id = :'meet') = 'scheduled',
              'a reviewer books the room');
select assert((select booked_count from office_slots where id = :'slot_id') = 1,
              'the slot is marked as taken');
select assert((select count(*) from meeting_attendance where meeting_id = :'meet') = 2,
              'both attendees go on the sheet');

-- One live appointment per match: two people do not need three pending
-- dates with each other.
select act_as(:'YOUSEF');
set role authenticated;
do $$
declare mid uuid;
begin
  select match_id into mid from meetings where state = 'scheduled' limit 1;
  begin
    perform propose_office_meeting(mid);
    raise exception 'FAILED: a second live meeting was proposed on the same match';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
    raise notice '  ok   one live appointment per match';
  end;
end $$;

-- Capacity has to hold against a second reviewer working the same queue,
-- so this needs a genuinely different couple.
select act_as(:'TAREQ');
select express_interest(:'TAREQ', :'AMIRA', true);
select act_as(:'AMIRA');
select express_interest(:'AMIRA', :'TAREQ', true) as m2 \gset
select assert(:'m2' <> '', 'a second couple matched');

select propose_office_meeting(:'m2') as meet2 \gset
select act_as(:'TAREQ');
select respond_to_meeting(:'meet2', true);

reset role;
select act_as(:'REVIEWER');
do $$
declare taken uuid;
begin
  select slot_id into taken from meetings where state = 'scheduled' limit 1;
  begin
    perform schedule_meeting(
      (select id from meetings where state = 'pending_scheduling' limit 1), taken);
    raise exception 'FAILED: a slot was booked twice';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
    raise notice '  ok   a slot cannot be booked twice';
  end;
end $$;

do $$
begin
  begin
    perform schedule_meeting(
      (select id from meetings where state = 'pending_scheduling' limit 1),
      (select id from office_slots where starts_at < now() limit 1));
    raise exception 'FAILED: a meeting was booked into a slot in the past';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
    raise notice '  ok   a slot in the past cannot be booked';
  end;
end $$;

\echo ''
\echo '== attendance =='

select record_meeting_outcome(:'meet', true, false, 'حضر الطرف الأول فقط');
select assert(
  (select state from meetings where id = :'meet') = 'no_show',
  'a no-show is recorded as an observed fact, not left as an argument'
);

\echo ''
\echo '== what a client can reach directly =='

select act_as(:'YOUSEF');
set role authenticated;

do $$
begin
  begin
    perform count(*) from photos;
    raise exception 'FAILED: the table holding the clear originals was readable';
  exception when insufficient_privilege then
    raise notice '  ok   the photos table, which holds the originals, is unreachable';
  end;
end $$;

reset role;

\echo ''
\echo 'Photo and meeting tests passed.'
\echo ''
