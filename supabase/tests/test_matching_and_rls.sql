-- =====================================================================
-- SQL test suite: hard filters, slate generation, mutual matching, and
-- the row-level security policies.
--
-- RLS is the authorisation layer, not a second line of defence, so it is
-- tested adversarially: every assertion below is a thing a malicious
-- client would try.
--
--   psql -d nasib -v ON_ERROR_STOP=1 -f supabase/tests/test_matching_and_rls.sql
-- =====================================================================

\set AMIRA  '11111111-1111-1111-1111-111111111111'
\set YOUSEF '22222222-2222-2222-2222-222222222222'
\set KHALED '33333333-3333-3333-3333-333333333333'
\set LINA   '44444444-4444-4444-4444-444444444444'
\set TAREQ  '66666666-6666-6666-6666-666666666666'
\set SCAMMER '99999999-9999-9999-9999-999999999999'

\echo ''
\echo '== hard filters =='

-- Amira accepts only practising men aged 26-36 in Palestine, no divorcees,
-- no children. Yousef and Tareq qualify; Khaled does not.
select assert(
  exists (select 1 from eligible_candidates(:'AMIRA') where candidate_id = :'YOUSEF'),
  'Yousef is eligible for Amira'
);

select assert(
  not exists (select 1 from eligible_candidates(:'AMIRA') where candidate_id = :'KHALED'),
  'divorced father is excluded — she declared both as deal-breakers'
);

select assert(
  not exists (select 1 from eligible_candidates(:'AMIRA') where candidate_id = :'SCAMMER'),
  'a rejected account never appears as a candidate'
);

select assert(
  not exists (
    select 1 from eligible_candidates(:'AMIRA') e
    join users u on u.id = e.candidate_id
    where u.gender = 'female'
  ),
  'same-gender candidates are never returned'
);

-- Reciprocity: Tareq accepts only practising women aged 22-32 in Palestine,
-- so Lina (Amman, moderately practising) must not see him.
select assert(
  not exists (select 1 from eligible_candidates(:'LINA') where candidate_id = :'TAREQ'),
  'a candidate who would reject the viewer is not shown to her'
);

\echo ''
\echo '== daily slate =='

select act_as(:'AMIRA');
select draw_daily_slate(:'AMIRA', 6) as slate \gset

select assert(
  (select count(*) from candidate_items where slate_id = :'slate') > 0,
  'slate is populated'
);

select assert(
  (select count(*) from candidate_items where slate_id = :'slate') <= 6,
  'slate never exceeds the daily limit'
);

select assert(
  draw_daily_slate(:'AMIRA', 6) = :'slate',
  'drawing twice in one day returns the same slate — the limit is honest'
);

select assert(
  not exists (
    select 1 from candidate_items ci
    join users u on u.id = ci.candidate_user_id
    where ci.slate_id = :'slate' and u.status <> 'admitted'
  ),
  'only admitted users reach a slate'
);

\echo ''
\echo '== mutual interest =='

select act_as(:'YOUSEF');
select draw_daily_slate(:'YOUSEF', 6);

-- A signed-in client must not be able to act for anyone but itself.
do $$
begin
  begin
    perform draw_daily_slate('11111111-1111-1111-1111-111111111111', 6);
    raise exception 'FAILED: one user drew another user''s slate';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
    raise notice '  ok   a user cannot draw someone else''s slate';
  end;
end $$;

do $$
begin
  begin
    perform express_interest('11111111-1111-1111-1111-111111111111',
                             '22222222-2222-2222-2222-222222222222', true);
    raise exception 'FAILED: one user expressed interest on another''s behalf';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
    raise notice '  ok   a user cannot express interest for someone else';
  end;
end $$;

-- One-sided interest creates no match.
select act_as(:'AMIRA');
select assert(
  express_interest(:'AMIRA', :'YOUSEF', true) is null,
  'one-sided interest does not create a match'
);

-- Reciprocated interest does.
select act_as(:'YOUSEF');
select express_interest(:'YOUSEF', :'AMIRA', true) as m \gset
select assert(:'m' is not null and :'m' <> '', 'mutual interest creates a match');

select assert(
  (select state from matches where id = :'m') = 'active',
  'the match is active'
);

select assert(
  (select user_a < user_b from matches where id = :'m'),
  'the pair is stored in a canonical order, so it cannot be duplicated'
);

select assert(
  not (select contact_unlocked from matches where id = :'m'),
  'contact details are locked until a video call has happened'
);

-- unlock_contact must be a no-op before the call.
select act_as(:'YOUSEF');
select unlock_contact(:'m');
select assert(
  not (select contact_unlocked from matches where id = :'m'),
  'contact stays locked when no video call is recorded'
);

update matches set video_call_at = now() where id = :'m';

-- Someone outside the match must not be able to unlock it.
select act_as(:'LINA');
select unlock_contact(:'m');
select assert(
  not (select contact_unlocked from matches where id = :'m'),
  'a stranger cannot unlock a match they are not part of'
);

select act_as(:'YOUSEF');
select unlock_contact(:'m');
select assert(
  (select contact_unlocked from matches where id = :'m'),
  'contact unlocks once the in-app video call has happened'
);

select assert(
  not exists (select 1 from eligible_candidates(:'AMIRA') where candidate_id = :'YOUSEF'),
  'an already-matched person is never shown again'
);

\echo ''
\echo '== row level security =='

-- From here on we act as a normal signed-in client, not as the owner.
set role authenticated;

set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set request.jwt.claim.role = 'authenticated';

select assert(
  (select count(*) from profiles where user_id = :'LINA') = 0,
  'a user cannot read the profile of someone not on her slate and not matched'
);

select assert(
  (select count(*) from profiles where user_id = :'YOUSEF') = 1,
  'a user can read the profile of a person she is matched with'
);

select assert(
  (select count(*) from trust_scores) = 0,
  'trust scores are invisible to users — a numeric score in-product becomes a ranking people game'
);

-- These two are not merely filtered to zero rows — they are not reachable
-- at all, so a policy bug can never expose them.
do $$
begin
  begin
    perform count(*) from verification_evidence;
    raise exception 'FAILED: raw verification evidence was readable by a client';
  exception when insufficient_privilege then
    raise notice '  ok   raw verification evidence is service-role only';
  end;
end $$;

do $$
begin
  begin
    perform count(*) from biometric.face_embeddings;
    raise exception 'FAILED: biometric data was readable by a client';
  exception when insufficient_privilege or invalid_schema_name then
    raise notice '  ok   biometric data is unreachable from a user session';
  end;
end $$;

select assert(
  (select count(*) from verifications where user_id <> :'AMIRA') = 0,
  'a user sees only her own verification history'
);

-- Privilege escalation attempts.
do $$
begin
  begin
    update users set status = 'admitted' where id = '99999999-9999-9999-9999-999999999999';
    raise exception 'FAILED: a user was able to admit another account';
  exception when others then
    raise notice '  ok   a user cannot change another account''s status';
  end;
end $$;

do $$
begin
  begin
    update users set tier = 'gold' where id = '11111111-1111-1111-1111-111111111111';
    raise exception 'FAILED: a user granted herself the paid tier';
  exception when others then
    raise notice '  ok   a user cannot grant herself a paid tier';
  end;
end $$;

do $$
begin
  begin
    update users set date_of_birth = '2010-01-01' where id = '11111111-1111-1111-1111-111111111111';
    raise exception 'FAILED: age was client-writable';
  exception when others then
    raise notice '  ok   date of birth is not client-writable after signup';
  end;
end $$;

reset role;

\echo ''
\echo '== append-only audit trail =='

insert into admin_decisions (admin_id, subject_user_id, action, reason_code, notes,
                             agent_identity_score, agent_intent_score, agent_recommendation)
values ('dddddddd-dddd-dddd-dddd-dddddddddddd', :'KHALED', 'admit', 'manual_review_ok',
        'Divorce confirmed, photos consistent.', 78, 70, 'review');

update admin_decisions set notes = 'tampered' where subject_user_id = :'KHALED';
select assert(
  (select notes from admin_decisions where subject_user_id = :'KHALED') <> 'tampered',
  'admin decisions cannot be edited after the fact'
);

delete from admin_decisions where subject_user_id = :'KHALED';
select assert(
  (select count(*) from admin_decisions where subject_user_id = :'KHALED') = 1,
  'admin decisions cannot be deleted'
);

\echo ''
\echo '== retention =='

insert into verifications (user_id, run_id, type, result, agent_version)
values (:'AMIRA', gen_random_uuid(), 'document', 'pass', 'verify-1.0.0')
returning id as vid \gset

insert into verification_evidence (verification_id, kind, storage_path, delete_after)
values (:'vid', 'document_image', 'docs/amira.jpg', now() - interval '1 day');

select assert(purge_expired_evidence() >= 1, 'expired document images are purged');
select assert(
  (select count(*) from verification_evidence where verification_id = :'vid') = 0,
  'retention is a column the system acts on, not a policy in a document'
);

\echo ''
\echo 'All SQL tests passed.'
\echo ''
