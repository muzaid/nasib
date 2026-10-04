-- ---------------------------------------------------------------------
-- Memberships, the slate, and the contact release.
--
-- The release is the part with money and a deadline in it, so most of
-- this is about the ways it can go wrong: one person pressing, one
-- person paying, the window running out, and every one of those from the
-- wrong account.
-- ---------------------------------------------------------------------

\set ON_ERROR_STOP on
\echo ''
\echo '== memberships and the contact release =='

\set OWNER '''c0000000-0000-0000-0000-00000000000c'''
\set HIM   '''e0000000-0000-0000-0000-00000000000e'''
\set HER   '''d0000000-0000-0000-0000-00000000000d'''

-- ── memberships ───────────────────────────────────────────────────────
select act_as(:HER);
select assert((my_benefits() ->> 'membership') = 'basic',
  'everyone starts on basic');
select assert((my_benefits() ->> 'daily_candidates')::int = 5,
  'which is five candidates a day');
select assert((my_benefits() ->> 'can_search')::boolean = false,
  'and no search');

select act_as(:OWNER);
select assert((admin_set_membership(:HER::uuid, 'golden', 3) ->> 'membership') = 'golden',
  'a reviewer can set a membership');
-- The answer carries the row's own end date, so the desk can repaint from
-- it instead of guessing what three months from now came to.
select assert(
  ((admin_set_membership(:HER::uuid, 'golden', 3) ->> 'membership_until')::timestamptz
     - now()) > interval '5 months',
  'and extending an existing one adds to the date rather than replacing it');
select assert(
  (admin_set_membership(:HER::uuid, 'basic') -> 'membership_until') = 'null'::jsonb,
  'while dropping to basic clears the date, because basic does not run out');
select assert((admin_member(:HER::uuid) ->> 'membership') = 'basic',
  'and the record shows the membership a reviewer is about to change');

select assert((admin_set_membership(:HER::uuid, 'golden', 3) ->> 'membership') = 'golden',
  'set back to golden for the rest of this suite');

select act_as(:HER);
select assert((my_benefits() ->> 'daily_candidates')::int = 20,
  'golden sees more candidates');
select assert((my_benefits() ->> 'can_search')::boolean,
  'and can search');
select assert((my_benefits() ->> 'release_discount')::int = 100,
  'and pays nothing to release a contact');

-- A member cannot promote themselves.
do $$
declare failed boolean := false;
begin
  begin perform admin_set_membership('d0000000-0000-0000-0000-00000000000d'::uuid, 'golden');
  exception when others then failed := true; end;
  perform assert(failed, 'but cannot set their own membership');
end $$;

-- ── search is gated, and the gate is in the database ──────────────────
select assert((search_members('{}'::jsonb) ->> 'allowed')::boolean,
  'a golden member may search');

select act_as(:OWNER);
select admin_set_membership(:HER::uuid, 'basic');
select act_as(:HER);
select assert((search_members('{}'::jsonb) ->> 'allowed')::boolean = false,
  'a basic member may not — checked here, not in the screen');
select assert(jsonb_array_length(search_members('{}'::jsonb) -> 'rows') = 0,
  'and gets no rows to work around it with');

-- ── who is interested in me ───────────────────────────────────────────
select assert((my_admirers() ->> 'allowed')::boolean = false,
  'a basic member is not shown who is interested');
select assert((my_admirers() ? 'count'),
  'but is told how many, which is the reason to upgrade');

select act_as(:OWNER);
select admin_set_membership(:HER::uuid, 'premium');
select act_as(:HER);
select assert((my_admirers() ->> 'allowed')::boolean,
  'a premium member is shown them');

-- ── the release ───────────────────────────────────────────────────────
-- A match between the two admitted members from the review desk suite.
insert into matches (user_a, user_b, state)
values (least(:HER::uuid, :HIM::uuid), greatest(:HER::uuid, :HIM::uuid), 'active')
on conflict (user_a, user_b) do update set state = 'active';

-- Both need a number for there to be anything to release.
select act_as(:HER);
select assert((set_my_phone('+970 59 111 2222') ->> 'phone') = '+970591112222',
  'a member can add their number, and it is normalised');

do $$
declare failed boolean := false;
begin
  begin perform set_my_phone('+970599999999');
  exception when others then failed := true; end;
  perform assert(failed, 'but cannot change it once set — a swapped number hands over a stranger''s');
end $$;

select act_as(:HIM);
select set_my_phone('+970598887777');

-- One press is not enough.
select act_as(:HER);
select assert(
  (press_bingo((select id from matches
     where state in ('active','progressed')
       and (user_a = :HER or user_b = :HER) limit 1)) ->> 'state') = 'pending_other',
  'one press waits for the other');

select assert(
  (my_release((select id from matches
     where state in ('active','progressed')
       and (user_a = :HER or user_b = :HER) limit 1)) ->> 'both_pressed')::boolean = false,
  'and the presser is not told anything about the other side');

-- Pressing twice is pressing once.
select press_bingo((select id from matches
   where state in ('active','progressed') and (user_a = :HER::uuid or user_b = :HER::uuid) limit 1));
select assert(
  (select count(*) from contact_releases) = 1,
  'pressing again does not make a second request');

-- Both pressed: now a reviewer sees it.
select act_as(:HIM);
select assert(
  (press_bingo((select id from matches
     where state in ('active','progressed')
       and (user_a = :HIM::uuid or user_b = :HIM::uuid) limit 1)) ->> 'state') = 'pending_admin',
  'the second press sends it to the review desk');

-- Nobody outside the pair can touch it.
select act_as(:OWNER);
do $$
declare failed boolean := false;
begin
  begin perform press_bingo((select match_id from contact_releases limit 1));
  exception when others then failed := true; end;
  perform assert(failed, 'someone who is not in the match cannot press for them');
end $$;

-- The price comes from each side's membership, not from the caller.
select assert((admin_decide_release((select id from contact_releases limit 1), true, 3)
  ->> 'state') = 'awaiting_payment', 'a reviewer approves it and the clock starts');

select assert(
  (select a_amount <> b_amount from contact_releases limit 1),
  'the two sides owe different amounts, because their memberships differ');

select assert(
  (select b_amount from contact_releases limit 1) = release_base_price(),
  'the basic member pays the full price');

-- Paying.
select assert((admin_mark_paid(
  (select id from contact_releases limit 1), :HER::uuid, 'bank-ref-1') ->> 'state')
  <> 'released', 'one payment does not release anything');

select act_as(:HER);
select assert(
  (my_release((select match_id from contact_releases limit 1)) -> 'other_phone') = 'null'::jsonb,
  'and no number is visible while it is half paid');

select act_as(:OWNER);
select assert((admin_mark_paid(
  (select id from contact_releases limit 1), :HIM::uuid, 'bank-ref-2') ->> 'state')
  = 'released', 'the second payment releases it');

select act_as(:HER);
select assert(
  (my_release((select match_id from contact_releases limit 1)) ->> 'other_phone')
    = '+970598887777',
  'and each side sees the other''s number');

select act_as(:HIM);
select assert(
  (my_release((select match_id from contact_releases limit 1)) ->> 'other_phone')
    = '+970591112222',
  'both of them');

-- ── the window running out ────────────────────────────────────────────
\echo ''
\echo '-- expiry'

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-0000000000f1', 'x@example.com'),
  ('f2000000-0000-0000-0000-0000000000f2', 'y@example.com')
on conflict (id) do nothing;

insert into users (id, phone_e164, gender, date_of_birth, country_code, status)
values ('f1000000-0000-0000-0000-0000000000f1', '+970590000001', 'female', '1995-01-01', 'PS', 'admitted'),
       ('f2000000-0000-0000-0000-0000000000f2', '+970590000002', 'male',   '1993-01-01', 'PS', 'admitted')
on conflict (id) do nothing;
insert into profiles (user_id, display_name, marital_status, practice_level, timeline, willing_to_relocate)
values ('f1000000-0000-0000-0000-0000000000f1', 'منى', 'never_married', 'practicing', 'within_1_year', false),
       ('f2000000-0000-0000-0000-0000000000f2', 'سامي', 'never_married', 'practicing', 'within_1_year', false)
on conflict (user_id) do nothing;

insert into matches (user_a, user_b, state)
values (least('f1000000-0000-0000-0000-0000000000f1'::uuid, 'f2000000-0000-0000-0000-0000000000f2'::uuid),
        greatest('f1000000-0000-0000-0000-0000000000f1'::uuid, 'f2000000-0000-0000-0000-0000000000f2'::uuid),
        'active');

select act_as('f1000000-0000-0000-0000-0000000000f1');
select press_bingo((select id from matches where user_a = least('f1000000-0000-0000-0000-0000000000f1'::uuid,'f2000000-0000-0000-0000-0000000000f2'::uuid)));
select act_as('f2000000-0000-0000-0000-0000000000f2');
select press_bingo((select id from matches where user_a = least('f1000000-0000-0000-0000-0000000000f1'::uuid,'f2000000-0000-0000-0000-0000000000f2'::uuid)));

select act_as(:OWNER);
select admin_decide_release(
  (select id from contact_releases where state = 'pending_admin' limit 1), true, 3);
select admin_mark_paid(
  (select id from contact_releases where state = 'awaiting_payment' limit 1),
  'f1000000-0000-0000-0000-0000000000f1', 'paid-in-time');

-- The deadline passes.
update contact_releases set pay_by = now() - interval '1 hour'
 where state = 'awaiting_payment';

select assert(expire_releases() = 1, 'the window closes on an unpaid release');
select assert(
  (select state from contact_releases
    where a_user = 'f1000000-0000-0000-0000-0000000000f1'
       or b_user = 'f1000000-0000-0000-0000-0000000000f1') = 'expired',
  'and the request expires');
select assert(
  (select refund_due_to from contact_releases
    where a_user = 'f1000000-0000-0000-0000-0000000000f1'
       or b_user = 'f1000000-0000-0000-0000-0000000000f1')
  = 'f1000000-0000-0000-0000-0000000000f1',
  'naming the person who paid as the one owed money back');

select act_as('f1000000-0000-0000-0000-0000000000f1');
select assert(
  (my_release((select match_id from contact_releases where state = 'expired' limit 1))
    ->> 'refund_due')::boolean,
  'who is told they are owed it');
select assert(
  (my_release((select match_id from contact_releases where state = 'expired' limit 1))
    -> 'other_phone') = 'null'::jsonb,
  'and gets no number');

select act_as(:OWNER);
select assert(
  (select count(*) from jsonb_array_elements(admin_releases('refunds') -> 'rows')) = 1,
  'the refund queue is a query, not an investigation');
select assert((admin_mark_refunded(
  (select id from contact_releases where state = 'expired' limit 1), 'refund-ref')
  ->> 'refunded')::boolean, 'and a refund can be recorded');

do $$
declare failed boolean := false;
begin
  begin perform admin_mark_refunded(
    (select id from contact_releases where state = 'expired' limit 1), 'again');
  exception when others then failed := true; end;
  perform assert(failed, 'but not twice');
end $$;

-- ── none of the reviewer's half is reachable by a member ──────────────
select act_as(:HER);
do $$
declare blocked int := 0;
begin
  begin perform admin_releases(); exception when others then blocked := blocked + 1; end;
  begin perform admin_decide_release(gen_random_uuid(), true);
                                    exception when others then blocked := blocked + 1; end;
  begin perform admin_mark_paid(gen_random_uuid(), gen_random_uuid());
                                    exception when others then blocked := blocked + 1; end;
  begin perform admin_mark_refunded(gen_random_uuid());
                                    exception when others then blocked := blocked + 1; end;
  perform assert(blocked = 4, 'a member cannot approve, price, or settle their own release');
end $$;

select assert(
  not has_function_privilege('authenticated', 'settle_release(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'expire_releases()', 'execute'),
  'and cannot settle or expire one directly either');

\echo '== memberships and the contact release: done =='
