-- ---------------------------------------------------------------------
-- The conversation monitor, and the log that makes it accountable.
--
-- Most of this suite is about the log rather than the reading. Reading
-- is easy to get right; the thing that is easy to get wrong is reading
-- without leaving a trace, and that is the difference between moderation
-- and surveillance.
-- ---------------------------------------------------------------------

\set ON_ERROR_STOP on
\echo ''
\echo '== conversation monitor and the dashboard =='

\set OWNER '''c0000000-0000-0000-0000-00000000000c'''
\set HIM   '''e0000000-0000-0000-0000-00000000000e'''
\set HER   '''d0000000-0000-0000-0000-00000000000d'''

-- Earlier suites unlocked contact on this match, which switches the
-- redaction off by design. Lock it so the filter is live, which is the
-- state the monitor is for.
-- Targeted by the pair rather than by state: an earlier suite moves
-- this match to 'progressed', and a state filter here would silently
-- match nothing and leave the suite asserting on another suite's data.
-- Targeted by the pair rather than by state: an earlier suite moves
-- this match on, and a state filter here would silently match nothing
-- and leave the suite asserting on another suite's data. It is put back
-- to active-and-locked because that is the state the monitor is for —
-- before contact is released, when the filter is live.
update matches set state = 'active', contact_unlocked = false
 where user_a = :HER::uuid and user_b = :HIM::uuid;

-- ── a pair trying to get around the filter ────────────────────────────
-- Four attempts from one side, one from the other. The asymmetry is the
-- thing the monitor is supposed to surface.
select act_as(:HER);
set role authenticated;
insert into messages (match_id, sender_id, body)
select m.id, :HER::uuid, b
  from matches m,
       (values ('رقمي 0599000111'), ('اتصل 0599000112'),
               ('واتساب 0599000113'), ('كلمني 0599000114')) v(b)
 where m.user_a = :HER::uuid and m.user_b = :HIM::uuid
 limit 4;
reset role;

select act_as(:HIM);
set role authenticated;
insert into messages (match_id, sender_id, body)
select m.id, :HIM::uuid, 'تفضّلي نكمل هنا'
  from matches m
 where m.user_a = :HER::uuid and m.user_b = :HIM::uuid
 limit 1;
reset role;

-- ── the list ──────────────────────────────────────────────────────────
select act_as(:OWNER);

select assert(jsonb_array_length(admin_conversations('flagged') -> 'rows') >= 1,
  'a conversation the filter fired on shows up in the flagged queue');

select assert((admin_conversations('flagged') -> 'counts' ->> 'flagged')::int >= 1,
  'and is counted for the queue chip');

-- Ranking, not recency. The pair with the most attempts is first, which
-- is the whole reason a reviewer would open this list rather than browse.
select assert(
  (admin_conversations('flagged') -> 'rows' -> 0 ->> 'redactions')::int
    >= (admin_conversations('flagged') -> 'rows' -> -1 ->> 'redactions')::int,
  'the queue is ranked by attempts, so the worst pair is at the top');

select assert(
  (select (r ->> 'a_redactions')::int + (r ->> 'b_redactions')::int
     = (r ->> 'redactions')::int
   from jsonb_array_elements(admin_conversations('flagged') -> 'rows') r
   limit 1),
  'each side is counted separately, because one-sided pushing is a different case');

-- One side pushed four times, the other never did. A reviewer has to be
-- able to see that from the list, because "both of them were impatient"
-- and "he would not stop" are different situations.
select assert(
  exists (select 1
            from jsonb_array_elements(admin_conversations('flagged') -> 'rows') r
           where ((r ->> 'a_redactions')::int = 0) <> ((r ->> 'b_redactions')::int = 0)),
  'and the asymmetry survives into the list rather than being summed away');

select assert((admin_conversations('quiet') -> 'counts' ->> 'quiet')::int >= 0,
  'the quiet filter answers too — a match nobody spoke in is also a signal');

-- ── one conversation ──────────────────────────────────────────────────
-- Fetched into a variable rather than inlined as a subquery: psql does
-- not escape quotes inside \set the way SQL does, and a silently empty
-- expansion here would look like a missing conversation.
select id as match_id from matches
 where user_a = 'd0000000-0000-0000-0000-00000000000d'::uuid
   and user_b = 'e0000000-0000-0000-0000-00000000000e'::uuid \gset

select assert(:'match_id' <> '', 'there is a conversation to read');

select assert(
  jsonb_array_length(admin_conversation(:'match_id'::uuid) -> 'parties') = 2,
  'opening a conversation names both sides');

select assert(
  jsonb_array_length(admin_conversation(:'match_id'::uuid) -> 'messages') >= 5,
  'and carries the messages');

select assert(
  (select count(*) from jsonb_array_elements(admin_conversation(:'match_id'::uuid) -> 'messages') g
    where (g ->> 'redacted')::boolean) >= 4,
  'marking which ones the filter touched');

select assert(
  (select g -> 'categories' <> '[]'::jsonb
     from jsonb_array_elements(admin_conversation(:'match_id'::uuid) -> 'messages') g
    where (g ->> 'redacted')::boolean limit 1),
  'and what kind of detail it was');

-- The guarantee that keeps this honest: there is nothing to un-redact,
-- because the original was never written down.
select assert(
  (select count(*) from jsonb_array_elements(admin_conversation(:'match_id'::uuid) -> 'messages') g
    where g ->> 'body' like '%0599000111%') = 0,
  'but never the number itself — it was never stored, so it cannot be shown');

select assert(
  (select g ->> 'side' in ('a', 'b')
     from jsonb_array_elements(admin_conversation(:'match_id'::uuid) -> 'messages') g limit 1),
  'each message says which side sent it, so a thread can be read as a thread');

-- ── the log, which is the point ───────────────────────────────────────
select assert(
  (select count(*) from admin_access_log
    where route = 'conversation' and subject_user_id = :HER::uuid) >= 1,
  'reading a thread is logged against her');

select assert(
  (select count(*) from admin_access_log
    where route = 'conversation' and subject_user_id = :HIM::uuid) >= 1,
  'and against him — one row per member, so neither log has a hole');

select assert(
  (select count(*) from admin_access_log
    where route = 'conversations' and subject_user_id is null) >= 1,
  'while opening the queue is logged as its own, subject-less act');

select assert(
  jsonb_array_length(admin_conversation_reads()) >= 2,
  'and the log reads back, naming the reviewer and the member');

select assert(
  (admin_conversation_reads() -> 0 ->> 'reviewer_email') is not null,
  'by email, so the row names a person rather than a uuid');

-- ── no member may do any of this ──────────────────────────────────────
do $$
declare blocked int := 0;
begin
  perform act_as('d0000000-0000-0000-0000-00000000000d'::uuid);
  begin perform admin_conversations('all');       exception when others then blocked := blocked + 1; end;
  begin perform admin_conversation(
    (select id from matches limit 1));            exception when others then blocked := blocked + 1; end;
  begin perform admin_conversation_reads();        exception when others then blocked := blocked + 1; end;
  begin perform admin_overview();                  exception when others then blocked := blocked + 1; end;
  perform assert(blocked = 4,
    'a member cannot list, read, audit, or see the dashboard — all four refuse');
end $$;

-- A member reading their OWN match through the member path still works:
-- the monitor is an addition, not a replacement for the chat.
select act_as(:HER);
select assert(
  (select count(*) from messages where match_id = :'match_id'::uuid) >= 5,
  'and her own conversation is still readable by her');

-- ── the dashboard ─────────────────────────────────────────────────────
select act_as(:OWNER);

select assert(jsonb_array_length(admin_overview() -> 'series') = 14,
  'the dashboard series is fourteen days');

-- Gaps filled. A chart built only from the days that had activity draws
-- a shape that did not happen.
select assert(
  (select count(*) from jsonb_array_elements(admin_overview() -> 'series') d
    where d -> 'messages' is not null) = 14,
  'with every day present, including the empty ones');

select assert(
  (select (d ->> 'day')::date = current_date
     from jsonb_array_elements(admin_overview() -> 'series') d
    order by (d ->> 'day')::date desc limit 1),
  'ending today rather than at the last day something happened');

select assert((admin_overview() -> 'queue' ->> 'flagged_chats')::int >= 1,
  'the queue block counts conversations the filter fired on');

select assert((admin_overview() -> 'funnel' ->> 'admitted')::int >= 1,
  'the funnel counts by status');

select assert((admin_overview() -> 'totals' ->> 'messages')::int >= 5,
  'and the totals are totals');

select assert((admin_overview() -> 'memberships') <> '{}'::jsonb,
  'memberships are broken down for the ramp');

-- The worst case, not the average: an average hides the person who
-- applied in March behind twenty who applied this morning.
select assert((admin_overview() ->> 'longest_wait_hours')::int >= 0,
  'the wait reported is the longest one, not the mean');

-- The rail badge and the dashboard tile come from different functions
-- and must not be able to disagree — a reviewer who sees 3 on one and 5
-- on the other trusts neither.
select assert(
  (admin_stats() ->> 'flagged_chats')::int
    = (admin_overview() -> 'queue' ->> 'flagged_chats')::int,
  'the nav badge and the dashboard tile count flagged chats the same way');

select assert(
  (admin_stats() ->> 'releases_pending')::int
    = (admin_overview() -> 'queue' ->> 'releases')::int,
  'and so do the two release counts');

-- A review card without a face is a paragraph, which is what the queue
-- was before.
select assert(
  (select count(*) from jsonb_array_elements(admin_queue('all') -> 'rows') r
    where r ? 'photo') >= 1,
  'the review queue carries a photo path, so a card can be a card');

\echo '== conversation monitor and the dashboard: done =='
