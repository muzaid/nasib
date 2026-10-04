-- ---------------------------------------------------------------------
-- Memberships, the swipe slate, search, and the contact release.
--
-- This migration also closes the loop the product never had. Everything
-- downstream of a match — chat, photo requests, meetings — existed and
-- could never happen, because nothing ever called draw_daily_slate or
-- express_interest. `my_slate` and `swipe` are those calls.
--
-- One thing worth stating plainly where it will be read by whoever works
-- on this next: the contact release moves this product's protection. Up
-- to now the platform sat in the middle — contact details unlocked after
-- a video call, the first meeting in an office with staff. Once two
-- people have each other's number they are on their own, and nothing
-- here can help them. The release is therefore deliberately slow: both
-- must ask, a reviewer must agree, and both must pay. Each of those is a
-- place to stop.
-- ---------------------------------------------------------------------


-- ═══════════════════════════════════════════════════════════════════
-- Memberships
-- ═══════════════════════════════════════════════════════════════════
--
-- A new type rather than values added to `tier_t`. ALTER TYPE ... ADD
-- VALUE cannot be used in the same transaction that adds it, and the
-- migration bundle runs as one transaction — so extending the old enum
-- would work when the files are run one at a time and fail when they are
-- pasted together, which is the worst kind of difference.
do $$ begin
  create type membership_t as enum ('basic', 'premium', 'golden');
exception when duplicate_object then null; end $$;

alter table users add column if not exists
  membership membership_t not null default 'basic';
alter table users add column if not exists
  membership_until timestamptz;

create index if not exists users_membership_idx on users(membership);


-- What each tier gets, as rows rather than as code. Prices and limits
-- change for commercial reasons, often, and a migration per change is a
-- deployment per change.
create table if not exists membership_benefits (
  membership        membership_t primary key,
  daily_candidates  int not null,
  can_see_interest  boolean not null default false,
  can_search        boolean not null default false,
  -- 0 = full price, 100 = free. A discount rather than a flag, so
  -- "golden releases are free" and "premium pays half" are the same rule.
  release_discount  int not null default 0 check (release_discount between 0 and 100),
  monthly_price     numeric(10, 2),
  currency          text not null default 'ILS'
);

insert into membership_benefits
  (membership, daily_candidates, can_see_interest, can_search, release_discount)
values
  ('basic',   5,  false, false, 0),
  ('premium', 10, true,  true,  50),
  ('golden',  20, true,  true,  100)
on conflict (membership) do nothing;


create or replace function my_benefits()
  returns jsonb
  language sql
  security definer
  set search_path = public
  stable
as $$
  select jsonb_build_object(
    'membership',       coalesce(u.membership, 'basic'),
    'membership_until', u.membership_until,
    'daily_candidates', b.daily_candidates,
    'can_see_interest', b.can_see_interest,
    'can_search',       b.can_search,
    'release_discount', b.release_discount)
  from users u
  join membership_benefits b on b.membership = u.membership
  where u.id = auth.uid()
$$;


create or replace function all_memberships()
  returns jsonb
  language sql
  stable
  set search_path = public
as $$
  select coalesce(jsonb_agg(row_to_json(b)::jsonb order by b.daily_candidates), '[]'::jsonb)
  from membership_benefits b
$$;


-- Set by a reviewer, never by the member. Payment for the membership
-- itself is out of band for now — a transfer, confirmed by a person —
-- so the thing that grants it is the same thing that records who granted
-- it and why.
create or replace function admin_set_membership(
  target     uuid,
  level      membership_t,
  months     int default 1,
  notes      text default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'not an admin';
  end if;

  update users
     set membership = level,
         membership_until = case
           when level = 'basic' then null
           else greatest(coalesce(membership_until, now()), now())
                + make_interval(months => greatest(months, 1))
         end
   where id = target;

  if not found then
    raise exception 'لا يوجد عضو بهذا المعرّف';
  end if;

  insert into admin_decisions (admin_id, subject_user_id, action, reason_code, notes)
  values (auth.uid(), target, 'admit_with_note', 'membership_' || level, notes);

  return jsonb_build_object('user_id', target, 'membership', level);
end;
$$;


-- ═══════════════════════════════════════════════════════════════════
-- The slate, as cards
-- ═══════════════════════════════════════════════════════════════════

/**
 * Today's candidates, in order, with each one's decision so far.
 *
 * The size comes from the membership rather than a constant: that is the
 * one lever that sells a tier without changing what the review promises.
 */
create or replace function my_slate()
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  uid uuid := auth.uid();
  me users;
  size int;
  slate uuid;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  select * into me from users where id = uid;
  if me.id is null then
    return jsonb_build_object('gated', true, 'status', 'none', 'cards', '[]'::jsonb);
  end if;
  if me.status <> 'admitted' then
    return jsonb_build_object('gated', true, 'status', me.status, 'cards', '[]'::jsonb);
  end if;

  select daily_candidates into size
    from membership_benefits where membership = me.membership;

  slate := draw_daily_slate(uid, coalesce(size, 5));

  return jsonb_build_object(
    'gated', false,
    'membership', me.membership,
    'size', size,
    'cards', coalesce((
      select jsonb_agg(row_to_json(c)::jsonb order by c.rank)
      from (
        select
          ci.candidate_user_id as id,
          ci.rank,
          ci.decision,
          p.display_name,
          u.city,
          date_part('year', age(u.date_of_birth))::int as age,
          p.bio,
          p.occupation,
          p.education,
          p.marital_status,
          p.practice_level,
          p.timeline,
          p.willing_to_relocate,
          p.family_aware,
          p.height_cm,
          (select count(*) from photos ph
            where ph.user_id = ci.candidate_user_id and ph.approved) as photo_count,
          has_photo_access(uid, ci.candidate_user_id) as photos_unlocked
        from candidate_items ci
        join users u    on u.id = ci.candidate_user_id
        join profiles p on p.user_id = ci.candidate_user_id
        where ci.slate_id = slate
        order by ci.rank
      ) c), '[]'::jsonb));
end;
$$;


/** A swipe. Returns the match id when it was mutual, null otherwise. */
create or replace function swipe(candidate uuid, interested boolean, note text default null)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  match_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  match_id := express_interest(auth.uid(), candidate, interested, note);

  -- Deliberately says nothing about the other person's decision unless it
  -- produced a match. "They have not decided yet" and "they said no" must
  -- be indistinguishable, or a declined person learns they were declined.
  return jsonb_build_object(
    'matched',  match_id is not null,
    'match_id', match_id);
end;
$$;


/**
 * Who has shown interest in you, for a membership that may see it.
 *
 * This is the one benefit that changes what the product tells people, so
 * the gate is checked here and not in the screen. A basic member gets a
 * count — enough to know there is something to buy, not enough to act on
 * — and nothing else.
 */
create or replace function my_admirers()
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  uid uuid := auth.uid();
  allowed boolean;
  total int;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  select b.can_see_interest into allowed
    from users u join membership_benefits b on b.membership = u.membership
   where u.id = uid;

  select count(*) into total
    from candidate_items ci
    join candidate_slates cs on cs.id = ci.slate_id
   where ci.candidate_user_id = uid
     and ci.decision = 'interested'
     and not exists (
       select 1 from matches m
        where (m.user_a = least(uid, cs.user_id) and m.user_b = greatest(uid, cs.user_id)));

  if not coalesce(allowed, false) then
    return jsonb_build_object('allowed', false, 'count', total, 'rows', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'allowed', true,
    'count', total,
    'rows', coalesce((
      select jsonb_agg(row_to_json(a)::jsonb order by a.at desc)
      from (
        select
          cs.user_id as id,
          ci.decided_at as at,
          p.display_name,
          u.city,
          date_part('year', age(u.date_of_birth))::int as age,
          p.timeline,
          p.marital_status
        from candidate_items ci
        join candidate_slates cs on cs.id = ci.slate_id
        join users u    on u.id = cs.user_id
        join profiles p on p.user_id = cs.user_id
        where ci.candidate_user_id = uid
          and ci.decision = 'interested'
          and u.status = 'admitted'
          and not blocked_between(uid, cs.user_id)
        order by ci.decided_at desc
        limit 50
      ) a), '[]'::jsonb));
end;
$$;


/**
 * Search, for a membership that may.
 *
 * Returns the same shape as the slate so one card renders both. The
 * hard filters of the matching engine still apply — a search cannot
 * surface someone the matcher would never have offered, or it becomes a
 * way around the deal-breakers both sides declared.
 */
create or replace function search_members(filters jsonb default '{}'::jsonb)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  uid uuid := auth.uid();
  me users;
  allowed boolean;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  select * into me from users where id = uid;
  if me.id is null or me.status <> 'admitted' then
    return jsonb_build_object('allowed', true, 'gated', true, 'rows', '[]'::jsonb);
  end if;

  select b.can_search into allowed
    from membership_benefits b where b.membership = me.membership;

  if not coalesce(allowed, false) then
    return jsonb_build_object('allowed', false, 'gated', false, 'rows', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'allowed', true, 'gated', false,
    'rows', coalesce((
      select jsonb_agg(row_to_json(r)::jsonb)
      from (
        select
          u.id,
          p.display_name,
          u.city,
          date_part('year', age(u.date_of_birth))::int as age,
          p.bio,
          p.occupation,
          p.marital_status,
          p.practice_level,
          p.timeline,
          p.willing_to_relocate,
          p.family_aware,
          (select count(*) from photos ph
            where ph.user_id = u.id and ph.approved) as photo_count,
          has_photo_access(uid, u.id) as photos_unlocked
        from eligible_candidates(uid) e
        join users u    on u.id = e.candidate_id
        join profiles p on p.user_id = u.id
        where (filters ->> 'city' is null
               or u.city ilike '%' || (filters ->> 'city') || '%')
          and (filters ->> 'min_age' is null
               or date_part('year', age(u.date_of_birth)) >= (filters ->> 'min_age')::int)
          and (filters ->> 'max_age' is null
               or date_part('year', age(u.date_of_birth)) <= (filters ->> 'max_age')::int)
          and (filters ->> 'marital_status' is null
               or p.marital_status = (filters ->> 'marital_status')::marital_status_t)
          and (filters ->> 'practice_level' is null
               or p.practice_level = (filters ->> 'practice_level')::practice_level_t)
          and (filters ->> 'timeline' is null
               or p.timeline = (filters ->> 'timeline')::timeline_t)
          and (filters ->> 'willing_to_relocate' is null
               or p.willing_to_relocate = (filters ->> 'willing_to_relocate')::boolean)
        order by u.last_active_at desc nulls last
        limit 60
      ) r), '[]'::jsonb));
end;
$$;


grant execute on function my_benefits()                              to authenticated;
grant execute on function all_memberships()                          to authenticated, anon;
grant execute on function admin_set_membership(uuid, membership_t, int, text) to authenticated;
grant execute on function my_slate()                                 to authenticated;
grant execute on function swipe(uuid, boolean, text)                 to authenticated;
grant execute on function my_admirers()                              to authenticated;
grant execute on function search_members(jsonb)                      to authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- The contact release — "Bingo"
-- ═══════════════════════════════════════════════════════════════════
--
-- Both ask, a reviewer agrees, both pay, then each sees the other's
-- number. Four gates, and the order is the design: a single person
-- cannot start it, a reviewer sees the pair before money is involved,
-- and nobody's number appears until both have paid.
--
-- Payment is a status a reviewer sets after a transfer, not a card
-- integration. That is deliberate for now — it means no card data comes
-- near this system and no provider has to exist before the flow works —
-- and it is why every amount here is recorded rather than charged.

do $$ begin
  create type release_state as enum (
    'pending_other',     -- one pressed, waiting for the other
    'pending_admin',     -- both pressed, waiting on a reviewer
    'declined_by_admin',
    'awaiting_payment',  -- approved; the clock is running
    'released',          -- both paid; numbers exchanged
    'expired',           -- the window closed with only one payment
    'cancelled'
  );
exception when duplicate_object then null; end $$;


create table if not exists contact_releases (
  id            uuid primary key default gen_random_uuid(),
  match_id      uuid not null unique references matches(id) on delete cascade,
  state         release_state not null default 'pending_other',

  a_user        uuid not null references users(id) on delete cascade,
  b_user        uuid not null references users(id) on delete cascade,
  a_pressed_at  timestamptz,
  b_pressed_at  timestamptz,

  admin_id      uuid references admin_users(id),
  admin_at      timestamptz,
  admin_reason  text,

  -- Per side, because the discount is per membership: two people on the
  -- same match can legitimately owe different amounts.
  a_amount      numeric(10, 2),
  b_amount      numeric(10, 2),
  currency      text not null default 'ILS',
  a_paid_at     timestamptz,
  b_paid_at     timestamptz,
  a_reference   text,                    -- transfer reference, typed by a reviewer
  b_reference   text,

  -- The clock. If it runs out with one payment in, that payment is owed
  -- back, and `refund_due_to` names who to return it to rather than
  -- leaving it to be worked out from timestamps later.
  pay_by        timestamptz,
  refund_due_to uuid references users(id),
  refunded_at   timestamptz,

  released_at   timestamptz,
  created_at    timestamptz not null default now(),

  constraint ordered_parties check (a_user < b_user)
);

create index if not exists contact_releases_state_idx on contact_releases(state);

alter table contact_releases enable row level security;
drop policy if exists contact_releases_parties on contact_releases;
create policy contact_releases_parties on contact_releases for select
  using (auth.uid() in (a_user, b_user) or is_admin());


-- The price before any discount. A function rather than a constant so it
-- can be changed without a migration, and so a reviewer can read the
-- current figure.
create or replace function release_base_price()
  returns numeric
  language sql
  immutable
as $$ select 50.00::numeric $$;


/**
 * Press Bingo.
 *
 * Idempotent per side: pressing twice is pressing once. The first press
 * creates the request and tells nobody — the other person is not told
 * that someone is waiting on them, because that is pressure, and because
 * learning it would reveal interest that the product keeps private until
 * it is mutual.
 */
create or replace function press_bingo(p_match_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  uid uuid := auth.uid();
  m   matches;
  r   contact_releases;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  select * into m from matches
   where id = p_match_id and (user_a = uid or user_b = uid);
  if m.id is null then
    raise exception 'لا توجد هذه المحادثة';
  end if;
  if m.state not in ('active', 'progressed') then
    raise exception 'هذه المحادثة مغلقة';
  end if;

  insert into contact_releases (match_id, a_user, b_user)
  values (m.id, m.user_a, m.user_b)
  on conflict (match_id) do nothing;

  select * into r from contact_releases where match_id = m.id;

  -- Past the asking stage, pressing again does nothing. Re-opening a
  -- declined or expired request from a button would undo a decision
  -- somebody made.
  if r.state not in ('pending_other', 'pending_admin') then
    return jsonb_build_object('state', r.state, 'changed', false);
  end if;

  if uid = r.a_user then
    update contact_releases set a_pressed_at = coalesce(a_pressed_at, now())
     where id = r.id;
  else
    update contact_releases set b_pressed_at = coalesce(b_pressed_at, now())
     where id = r.id;
  end if;

  update contact_releases
     set state = case when a_pressed_at is not null and b_pressed_at is not null
                      then 'pending_admin'::release_state
                      else 'pending_other'::release_state end
   where id = r.id
  returning * into r;

  return jsonb_build_object('state', r.state, 'changed', true);
end;
$$;


/** What this match's release looks like to one of its two parties. */
create or replace function my_release(p_match_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  uid uuid := auth.uid();
  r   contact_releases;
  mine boolean;
  other_phone text;
  my_phone text;
begin
  select * into r from contact_releases
   where match_id = p_match_id and (a_user = uid or b_user = uid);

  if r.id is null then
    return jsonb_build_object('exists', false);
  end if;

  mine := (uid = r.a_user);

  -- The numbers, and only once released. Everything before that returns
  -- the state and nothing else.
  if r.state = 'released' then
    select phone_e164 into other_phone from users
     where id = case when mine then r.b_user else r.a_user end;
    select phone_e164 into my_phone from users where id = uid;
  end if;

  return jsonb_build_object(
    'exists', true,
    'state', r.state,
    'i_pressed', case when mine then r.a_pressed_at is not null
                      else r.b_pressed_at is not null end,
    -- Whether the other person pressed is told only once both have, which
    -- is the moment it stops being information about them alone.
    'both_pressed', r.a_pressed_at is not null and r.b_pressed_at is not null,
    'my_amount', case when mine then r.a_amount else r.b_amount end,
    'i_paid',    case when mine then r.a_paid_at is not null else r.b_paid_at is not null end,
    'other_paid', case when mine then r.b_paid_at is not null else r.a_paid_at is not null end,
    'currency', r.currency,
    'pay_by', r.pay_by,
    'refund_due', r.refund_due_to = uid,
    'refunded_at', r.refunded_at,
    'other_phone', other_phone,
    'my_phone', my_phone);
end;
$$;


/** Either party can call it off while it is still pending. */
create or replace function cancel_release(p_match_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  r contact_releases;
begin
  select * into r from contact_releases
   where match_id = p_match_id and (a_user = auth.uid() or b_user = auth.uid());

  if r.id is null then
    raise exception 'لا يوجد طلب';
  end if;

  -- Not after payment. Money in means a reviewer decides, so that a
  -- refund is a decision with a person behind it.
  if r.state not in ('pending_other', 'pending_admin') then
    raise exception 'لا يمكن الإلغاء في هذه المرحلة. راسل الدعم.';
  end if;

  update contact_releases set state = 'cancelled' where id = r.id;
  return jsonb_build_object('state', 'cancelled');
end;
$$;


-- ── the reviewer's side ───────────────────────────────────────────────

create or replace function admin_releases(filter text default 'pending', limit_to int default 60)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'not an admin';
  end if;

  insert into admin_access_log (admin_id, subject_user_id, route, in_queue)
  values (auth.uid(), null, 'releases:' || filter, true);

  return jsonb_build_object(
    'filter', filter,
    'base_price', release_base_price(),
    'counts', jsonb_build_object(
      'pending',  (select count(*) from contact_releases where state = 'pending_admin'),
      'awaiting', (select count(*) from contact_releases where state = 'awaiting_payment'),
      'refunds',  (select count(*) from contact_releases
                    where refund_due_to is not null and refunded_at is null)),
    'rows', coalesce((
      select jsonb_agg(row_to_json(r)::jsonb order by r.created_at)
      from (
        select
          cr.id, cr.state, cr.created_at, cr.pay_by,
          cr.a_user, pa.display_name as a_name, ua.membership as a_membership,
          cr.a_amount, cr.a_paid_at,
          cr.b_user, pb.display_name as b_name, ub.membership as b_membership,
          cr.b_amount, cr.b_paid_at,
          cr.currency, cr.refund_due_to, cr.refunded_at,
          cr.match_id,
          mt.video_call_at,
          (select count(*) from messages ms where ms.match_id = cr.match_id) as messages,
          (select count(*) from reports rp
            where rp.reported_id in (cr.a_user, cr.b_user) and rp.status = 'open') as open_reports
        from contact_releases cr
        join matches mt on mt.id = cr.match_id
        join users ua   on ua.id = cr.a_user
        join users ub   on ub.id = cr.b_user
        left join profiles pa on pa.user_id = cr.a_user
        left join profiles pb on pb.user_id = cr.b_user
        where case filter
                when 'pending'  then cr.state = 'pending_admin'
                when 'awaiting' then cr.state = 'awaiting_payment'
                when 'refunds'  then cr.refund_due_to is not null and cr.refunded_at is null
                when 'released' then cr.state = 'released'
                else true
              end
        order by cr.created_at
        limit least(greatest(limit_to, 1), 200)
      ) r), '[]'::jsonb));
end;
$$;


/**
 * Approve or refuse a release, and set the price.
 *
 * The amounts are computed here, from each side's membership, rather
 * than passed in — a price a client could name is a price a client could
 * change. `days` is the window; when it passes with one payment in, the
 * payer is owed their money back.
 */
create or replace function admin_decide_release(
  release_id uuid,
  approve    boolean,
  days       int default 3,
  reason     text default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  r contact_releases;
  base numeric := release_base_price();
  a_disc int;
  b_disc int;
begin
  if not is_admin() then
    raise exception 'not an admin';
  end if;

  select * into r from contact_releases where id = release_id;
  if r.id is null then
    raise exception 'لا يوجد هذا الطلب';
  end if;
  if r.state <> 'pending_admin' then
    raise exception 'هذا الطلب ليس بانتظار المراجعة';
  end if;

  if not approve then
    update contact_releases
       set state = 'declined_by_admin', admin_id = auth.uid(),
           admin_at = now(), admin_reason = reason
     where id = r.id;
    return jsonb_build_object('state', 'declined_by_admin');
  end if;

  select b.release_discount into a_disc
    from users u join membership_benefits b on b.membership = u.membership
   where u.id = r.a_user;
  select b.release_discount into b_disc
    from users u join membership_benefits b on b.membership = u.membership
   where u.id = r.b_user;

  update contact_releases
     set state = 'awaiting_payment',
         admin_id = auth.uid(), admin_at = now(), admin_reason = reason,
         a_amount = round(base * (100 - coalesce(a_disc, 0)) / 100.0, 2),
         b_amount = round(base * (100 - coalesce(b_disc, 0)) / 100.0, 2),
         pay_by = now() + make_interval(days => greatest(days, 1))
   where id = r.id
  returning * into r;

  -- A side that owes nothing is already paid. Otherwise a golden member
  -- would sit waiting to pay zero, and the window would expire on them.
  if r.a_amount = 0 then
    update contact_releases set a_paid_at = now(), a_reference = 'membership'
     where id = r.id;
  end if;
  if r.b_amount = 0 then
    update contact_releases set b_paid_at = now(), b_reference = 'membership'
     where id = r.id;
  end if;

  perform settle_release(r.id);

  return jsonb_build_object('state', (select state from contact_releases where id = r.id),
                            'a_amount', r.a_amount, 'b_amount', r.b_amount,
                            'pay_by', r.pay_by);
end;
$$;


/** Record that one side has paid. The reference is the transfer's. */
create or replace function admin_mark_paid(
  release_id uuid,
  which_user uuid,
  reference  text default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  r contact_releases;
begin
  if not is_admin() then
    raise exception 'not an admin';
  end if;

  select * into r from contact_releases where id = release_id;
  if r.id is null then
    raise exception 'لا يوجد هذا الطلب';
  end if;
  if r.state <> 'awaiting_payment' then
    raise exception 'هذا الطلب ليس بانتظار الدفع';
  end if;
  if which_user not in (r.a_user, r.b_user) then
    raise exception 'هذا الشخص ليس طرفاً في هذا الطلب';
  end if;

  if which_user = r.a_user then
    update contact_releases set a_paid_at = now(), a_reference = reference where id = r.id;
  else
    update contact_releases set b_paid_at = now(), b_reference = reference where id = r.id;
  end if;

  insert into admin_decisions (admin_id, subject_user_id, action, reason_code, notes)
  values (auth.uid(), which_user, 'admit_with_note', 'release_paid', reference);

  return settle_release(r.id);
end;
$$;


/**
 * Release when both have paid. Called after every payment, and by the
 * expiry job — so there is one place that decides a release has happened
 * rather than two that have to agree.
 */
create or replace function settle_release(release_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  r contact_releases;
begin
  select * into r from contact_releases where id = release_id;

  if r.state = 'awaiting_payment'
     and r.a_paid_at is not null and r.b_paid_at is not null then
    update contact_releases
       set state = 'released', released_at = now()
     where id = r.id;

    -- The match is marked as having gone past the platform. It is still
    -- a match, and the chat still works and is still filtered — but the
    -- numbers are out, and the record should say when that happened.
    update matches set state = 'progressed' where id = r.match_id;

    return jsonb_build_object('state', 'released');
  end if;

  return jsonb_build_object('state', r.state);
end;
$$;


/**
 * Close the windows that have run out.
 *
 * Run on a schedule. A release that reached its deadline with exactly
 * one payment leaves that payment owed back; the row names who, so the
 * refund queue is a query rather than an investigation.
 */
create or replace function expire_releases()
  returns int
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  closed int := 0;
begin
  with expired as (
    update contact_releases
       set state = 'expired',
           refund_due_to = case
             when a_paid_at is not null and b_paid_at is null then a_user
             when b_paid_at is not null and a_paid_at is null then b_user
             else null end
     where state = 'awaiting_payment'
       and pay_by < now()
    returning 1)
  select count(*) into closed from expired;

  return closed;
end;
$$;


/** A refund has been sent. Recorded, because money leaving needs a name. */
create or replace function admin_mark_refunded(release_id uuid, reference text default null)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  r contact_releases;
begin
  if not is_admin() then
    raise exception 'not an admin';
  end if;

  select * into r from contact_releases where id = release_id;
  if r.id is null or r.refund_due_to is null then
    raise exception 'لا يوجد مبلغ مستحق الإرجاع في هذا الطلب';
  end if;
  if r.refunded_at is not null then
    raise exception 'أُرجع المبلغ بالفعل';
  end if;

  update contact_releases set refunded_at = now() where id = r.id;

  insert into admin_decisions (admin_id, subject_user_id, action, reason_code, notes)
  values (auth.uid(), r.refund_due_to, 'admit_with_note', 'release_refunded', reference);

  return jsonb_build_object('refunded', true);
end;
$$;


-- ── a member's own phone number ───────────────────────────────────────
--
-- There is nothing to release if nobody gave a number. Members sign up
-- with an email, so this is where the number arrives — and it can be set
-- once, not changed, because a number that can be swapped after a
-- release is a way to hand someone a stranger's phone.
create or replace function set_my_phone(phone text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  cleaned text := regexp_replace(coalesce(phone, ''), '[^0-9+]', '', 'g');
  existing text;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if length(cleaned) < 9 then
    raise exception 'أدخل رقم هاتف صالحاً';
  end if;

  select phone_e164 into existing from users where id = auth.uid();
  if existing is not null and existing <> cleaned then
    raise exception 'لتغيير رقمك، راسل الدعم';
  end if;

  perform set_config('nasib.reviewing', 'on', true);
  update users set phone_e164 = cleaned where id = auth.uid();

  return jsonb_build_object('phone', cleaned);
end;
$$;


grant execute on function press_bingo(uuid)                          to authenticated;
grant execute on function my_release(uuid)                           to authenticated;
grant execute on function cancel_release(uuid)                       to authenticated;
grant execute on function set_my_phone(text)                         to authenticated;
grant execute on function admin_releases(text, int)                  to authenticated;
grant execute on function admin_decide_release(uuid, boolean, int, text) to authenticated;
grant execute on function admin_mark_paid(uuid, uuid, text)          to authenticated;
grant execute on function admin_mark_refunded(uuid, text)            to authenticated;

revoke all on function settle_release(uuid)   from public, anon, authenticated;
revoke all on function expire_releases()      from public, anon, authenticated;
revoke all on function release_base_price()   from public, anon;
grant execute on function settle_release(uuid) to service_role;
grant execute on function expire_releases()    to service_role;
grant execute on function release_base_price() to authenticated, service_role;


-- The desk's nav counts every section from one call, so the releases
-- waiting on a reviewer belong in it too.
create or replace function admin_stats()
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'not an admin';
  end if;

  return jsonb_build_object(
    'by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                    from (select status::text, count(*) as n from users group by status) s),
    'waiting',        (select count(*) from users where status in ('applying', 'pending_review')),
    'admitted',       (select count(*) from users where status = 'admitted'),
    'photos_pending', (select count(*) from photos where approved = false),
    'requests_pending', (select count(*) from photo_access_requests where state = 'pending_admin'),
    'reports_open',   (select count(*) from reports where status = 'open'),
    'meetings_pending', (select count(*) from meetings
                          where state in ('proposed', 'pending_scheduling')),
    'releases_pending', (select count(*) from contact_releases
                          where state = 'pending_admin'
                             or (refund_due_to is not null and refunded_at is null)),
    'matches_active', (select count(*) from matches where state = 'active'),
    'memberships',    (select coalesce(jsonb_object_agg(membership, n), '{}'::jsonb)
                         from (select membership::text, count(*) as n
                                 from users group by membership) m),
    'applied_7d',     (select count(*) from users where applied_at > now() - interval '7 days'),
    'decided_7d',     (select count(*) from admin_decisions where created_at > now() - interval '7 days'),
    'longest_wait_hours', (
      select coalesce(round(extract(epoch from now() - min(applied_at)) / 3600)::int, 0)
        from users where status in ('applying', 'pending_review') and applied_at is not null),
    'median_decision_hours', (
      select coalesce(round(
        percentile_cont(0.5) within group (
          order by extract(epoch from d.created_at - u.applied_at) / 3600))::int, 0)
        from admin_decisions d join users u on u.id = d.subject_user_id
       where u.applied_at is not null and d.created_at > now() - interval '30 days')
  );
end;
$$;

grant execute on function admin_stats() to authenticated;
