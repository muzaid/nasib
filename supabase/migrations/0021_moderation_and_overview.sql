-- 0021 — reading conversations, and a dashboard worth looking at
--
-- Two things, and the first one needs saying plainly: this migration lets
-- a reviewer read members' private messages. That is a real power and it
-- is built the way a real power should be.
--
-- What makes it defensible rather than voyeuristic:
--
--   1. Every thread opened is written to admin_access_log, naming the
--      reviewer and BOTH members. "Who read her messages, and when" is a
--      query, not an investigation.
--   2. The list is ranked by how often the redaction filter fired, not by
--      recency. 0008 strips contact details on write and records which
--      categories it stripped; a pair that has tried eleven times to pass
--      a phone number is the pair worth reading. A reviewer who opens the
--      top of this list is looking at the people most likely to be
--      working around the platform, rather than browsing strangers'
--      courtships.
--   3. There is nothing to un-redact. The original text was never
--      stored — 0008 cleans the body in a BEFORE trigger — so a reviewer
--      sees that a number was sent, never the number. This cannot be
--      turned on later without changing how messages are written, which
--      is the point.
--
-- The members have to be told this in the terms before it is used.
-- Monitoring an arranged-introduction platform for scams and coercion is
-- ordinary and expected; doing it without saying so is not.

-- ═══════════════════════════════════════════════════════════════════
-- What the filter caught, per conversation
-- ═══════════════════════════════════════════════════════════════════

-- Counting redactions per match on every list render is a sequential scan
-- of messages. It is small now and will not stay small.
create index if not exists messages_redacted_idx
  on messages(match_id) where redacted;


/**
 * Every conversation, ranked by circumvention attempts.
 *
 * filter:
 *   'flagged'  — the filter fired at least once (the default, and the
 *                only one that is a queue rather than a browse)
 *   'reported' — one party has an open report against them
 *   'active'   — a message in the last week
 *   'quiet'    — matched, but nobody has spoken
 *   'all'      — everything, newest first
 */
create or replace function admin_conversations(
  filter   text default 'flagged',
  limit_to int  default 60
) returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  result jsonb;
begin
  if not is_admin() then
    raise exception 'not an admin';
  end if;

  -- The list itself is logged, without a subject: opening the queue is
  -- not the same act as reading one pair's messages, and conflating them
  -- would make the per-member log useless.
  insert into admin_access_log (admin_id, subject_user_id, route, in_queue)
  values (auth.uid(), null, 'conversations', true);

  with convo as (
    select m.id,
           m.state,
           m.user_a,
           m.user_b,
           m.created_at,
           pa.display_name as a_name,
           pb.display_name as b_name,
           (select count(*) from messages g where g.match_id = m.id) as messages,
           (select count(*) from messages g where g.match_id = m.id and g.redacted) as redactions,
           (select max(g.created_at) from messages g where g.match_id = m.id) as last_at,
           (select count(*) from reports r
             where r.status = 'open' and r.reported_id in (m.user_a, m.user_b)) as reports,
           -- Which side is doing the reaching. A conversation where one
           -- person keeps pushing their number at someone who never
           -- reciprocates is a different situation from two people
           -- impatient with the platform, and the difference matters.
           (select count(*) from messages g
             where g.match_id = m.id and g.redacted and g.sender_id = m.user_a) as a_redactions,
           (select count(*) from messages g
             where g.match_id = m.id and g.redacted and g.sender_id = m.user_b) as b_redactions
      from matches m
      left join profiles pa on pa.user_id = m.user_a
      left join profiles pb on pb.user_id = m.user_b
  )
  select jsonb_build_object(
    'filter', filter,
    'counts', jsonb_build_object(
      'flagged',  (select count(*) from convo where redactions > 0),
      'reported', (select count(*) from convo where reports > 0),
      'active',   (select count(*) from convo where last_at > now() - interval '7 days'),
      'quiet',    (select count(*) from convo where messages = 0),
      'all',      (select count(*) from convo)),
    'rows', coalesce((
      select jsonb_agg(row_to_json(r)::jsonb)
      from (
        select id as match_id, state, user_a, user_b, a_name, b_name,
               messages, redactions, a_redactions, b_redactions,
               reports, last_at, created_at
          from convo
         where case filter
                 when 'flagged'  then redactions > 0
                 when 'reported' then reports > 0
                 when 'active'   then last_at > now() - interval '7 days'
                 when 'quiet'    then messages = 0
                 else true
               end
         -- Flagged conversations sort by attempts; the rest by recency,
         -- because "what happened lately" is the question those answer.
         order by case when filter = 'flagged' then redactions else 0 end desc,
                  coalesce(last_at, created_at) desc
         limit greatest(least(limit_to, 200), 1)) r), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke execute on function admin_conversations(text, int) from public, anon;
grant  execute on function admin_conversations(text, int) to authenticated;


/**
 * One conversation, in full, with both sides named.
 *
 * This is the read that is logged against both members. `redacted` on a
 * message means the filter removed something; `categories` says what kind
 * of thing it was. The text that was removed is not here and is not
 * anywhere — see the header.
 */
create or replace function admin_conversation(target_match uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  m      matches;
  result jsonb;
begin
  if not is_admin() then
    raise exception 'not an admin';
  end if;

  select * into m from matches where id = target_match;
  if m.id is null then
    raise exception 'لا توجد محادثة بهذا المعرّف';
  end if;

  -- Two rows, one per member. A single row naming one of them would make
  -- the other's log incomplete, and the log is the whole safeguard.
  insert into admin_access_log (admin_id, subject_user_id, route, in_queue)
  values (auth.uid(), m.user_a, 'conversation', false),
         (auth.uid(), m.user_b, 'conversation', false);

  select jsonb_build_object(
    'match_id',   m.id,
    'state',      m.state,
    'created_at', m.created_at,
    'wali_present',     m.wali_present,
    'contact_unlocked', m.contact_unlocked,
    'parties', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'user_id',    u.id,
               'name',       p.display_name,
               'age',        date_part('year', age(u.date_of_birth))::int,
               'city',       u.city,
               'status',     u.status,
               'membership', u.membership,
               'side',       case when u.id = m.user_a then 'a' else 'b' end,
               'reports_against',
                 (select count(*) from reports r
                   where r.reported_id = u.id and r.status = 'open'),
               'redactions',
                 (select count(*) from messages g
                   where g.match_id = m.id and g.sender_id = u.id and g.redacted)
             ) order by case when u.id = m.user_a then 0 else 1 end), '[]'::jsonb)
      from users u
      left join profiles p on p.user_id = u.id
      where u.id in (m.user_a, m.user_b)),
    'messages', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id',         g.id,
               'sender_id',  g.sender_id,
               'side',       case when g.sender_id = m.user_a then 'a' else 'b' end,
               'body',       g.body,
               'redacted',   g.redacted,
               'categories', coalesce(g.flags -> 'redacted_categories', '[]'::jsonb),
               'read_at',    g.read_at,
               'created_at', g.created_at
             ) order by g.created_at), '[]'::jsonb)
      from messages g where g.match_id = m.id),
    'release', (
      select row_to_json(c)::jsonb from (
        select state, a_amount, b_amount, a_paid_at, b_paid_at, pay_by,
               refund_due_to, refunded_at
          from contact_releases where match_id = m.id) c),
    'meeting', (
      select row_to_json(t)::jsonb from (
        select state, proposed_at, scheduled_at
          from meetings where match_id = m.id
         order by proposed_at desc limit 1) t)
  ) into result;

  return result;
end;
$$;

revoke execute on function admin_conversation(uuid) from public, anon;
grant  execute on function admin_conversation(uuid) to authenticated;


/**
 * Who has been reading whose messages.
 *
 * The log is only a safeguard if somebody can read it, so it is a
 * function rather than a table a future reviewer might not know about.
 * It covers the 'conversation' route specifically — the one that exposes
 * private text.
 */
create or replace function admin_conversation_reads(limit_to int default 100)
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
    select jsonb_agg(row_to_json(r)::jsonb)
    from (
      select l.created_at,
             a.full_name as reviewer,
             a.email     as reviewer_email,
             p.display_name as subject,
             l.subject_user_id
        from admin_access_log l
        join admin_users a on a.id = l.admin_id
        left join profiles p on p.user_id = l.subject_user_id
       where l.route = 'conversation'
       order by l.created_at desc
       limit greatest(least(limit_to, 500), 1)) r), '[]'::jsonb);
end;
$$;

revoke execute on function admin_conversation_reads(int) from public, anon;
grant  execute on function admin_conversation_reads(int) to authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- The dashboard
-- ═══════════════════════════════════════════════════════════════════

/**
 * One read for the whole dashboard.
 *
 * Deliberately one call: a dashboard that makes eleven requests shows
 * eleven loading states and gets a different answer in each of them, so
 * the tiles disagree with each other while they settle.
 *
 * `series` is fourteen days ending today, with the gaps filled. A chart
 * drawn from only the days that had activity draws a different shape
 * than the one that happened.
 */
create or replace function admin_overview()
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  result jsonb;
begin
  if not is_admin() then
    raise exception 'not an admin';
  end if;

  with days as (
    select generate_series(
             (current_date - interval '13 days')::date,
             current_date::date,
             interval '1 day')::date as day
  )
  select jsonb_build_object(
    -- ── the funnel, which is one scale and so one chart ──
    'funnel', jsonb_build_object(
      'applying',       (select count(*) from users where status = 'applying'),
      'pending_review', (select count(*) from users where status = 'pending_review'),
      'admitted',       (select count(*) from users where status = 'admitted'),
      'rejected',       (select count(*) from users where status = 'rejected'),
      'shadow_limited', (select count(*) from users where status = 'shadow_limited'),
      'banned',         (select count(*) from users where status = 'banned')),

    -- ── what is waiting on a person ──
    'queue', jsonb_build_object(
      'applications', (select count(*) from users
                        where status in ('applying', 'pending_review')),
      'photos',       (select count(*) from photos where not approved),
      'requests',     (select count(*) from photo_access_requests
                        where state = 'pending_admin'),
      'reports',      (select count(*) from reports where status = 'open'),
      'meetings',     (select count(*) from meetings
                        where state in ('proposed', 'pending_scheduling')),
      -- Same definition as admin_stats uses, so the dashboard tile and
      -- the nav badge cannot disagree: waiting on a reviewer, plus any
      -- refund owed but not yet paid back.
      'releases',     (select count(*) from contact_releases
                        where state = 'pending_admin'
                           or (refund_due_to is not null and refunded_at is null)),
      'flagged_chats',(select count(distinct match_id) from messages where redacted)),

    -- ── the longest anyone has been waiting, in hours ──
    -- An average hides the person who applied in March. The worst case is
    -- the number that means something to the applicant.
    'longest_wait_hours', coalesce((
      select ceil(extract(epoch from (now() - min(applied_at))) / 3600)::int
        from users where status in ('applying', 'pending_review')
         and applied_at is not null), 0),

    -- ── fourteen days, gaps filled ──
    'series', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'day',      d.day,
               'signups',  (select count(*) from users u
                             where u.created_at::date = d.day),
               'matches',  (select count(*) from matches m
                             where m.created_at::date = d.day),
               'messages', (select count(*) from messages g
                             where g.created_at::date = d.day)
             ) order by d.day), '[]'::jsonb)
      from days d),

    -- ── memberships, which are ordered, so a ramp rather than hues ──
    'memberships', (
      select coalesce(jsonb_object_agg(membership, n), '{}'::jsonb)
      from (select membership, count(*) as n from users group by membership) s),

    'cities', (
      select coalesce(jsonb_agg(row_to_json(c)::jsonb), '[]'::jsonb)
      from (select coalesce(city, '—') as city, count(*) as n
              from users where status = 'admitted'
             group by city order by count(*) desc, city limit 6) c),

    -- ── outcomes, which are the only number that says the thing works ──
    'outcomes', (
      select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb)
      from (select kind, count(*) as n from outcomes group by kind) o),

    'totals', jsonb_build_object(
      'members',   (select count(*) from users),
      'matches',   (select count(*) from matches where state = 'active'),
      'messages',  (select count(*) from messages),
      'releases',  (select count(*) from contact_releases where state = 'released'),
      'reviewers', (select count(*) from admin_users where active))
  ) into result;

  return result;
end;
$$;

revoke execute on function admin_overview() from public, anon;
grant  execute on function admin_overview() to authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- A face on the review card
-- ═══════════════════════════════════════════════════════════════════

-- admin_queue returned everything about an applicant except what they
-- look like, so the desk could only ever render a paragraph. Reviewing an
-- application is partly looking at the person, and the review card needs
-- the photo to be a card at all.
--
-- The primary photo, approved or not: an unapproved photo is exactly what
-- a reviewer is there to look at, and the photo queue shows it unveiled
-- already.
create or replace function admin_queue(
  filter text default 'waiting',
  limit_to int default 50
) returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  rows jsonb;
begin
  if not is_admin() then
    raise exception 'not an admin';
  end if;

  insert into admin_access_log (admin_id, subject_user_id, route, in_queue)
  values (auth.uid(), null, 'queue:' || filter, true);

  select coalesce(jsonb_agg(row_to_json(q)::jsonb order by q.applied_at desc nulls last), '[]'::jsonb)
    into rows
  from (
    select
      u.id,
      u.status,
      u.gender,
      u.city,
      u.country_code,
      u.applied_at,
      date_part('year', age(u.date_of_birth))::int as age,
      p.display_name,
      p.bio,
      p.occupation,
      p.education,
      p.marital_status,
      p.practice_level,
      p.timeline,
      p.willing_to_relocate,
      p.family_aware,
      p.wali_required,
      (select count(*) from photos ph where ph.user_id = u.id) as photo_count,
      -- is_primary first, then the lowest ordinal: the same photo the
      -- member chose to lead with.
      (select ph.storage_path from photos ph
        where ph.user_id = u.id
        order by ph.is_primary desc, ph.ordinal
        limit 1) as photo,
      (select count(*) from reports r
        where r.reported_id = u.id and r.status = 'open') as reports_against,
      (select created_at from admin_decisions d
        where d.subject_user_id = u.id order by created_at desc limit 1) as decided_at
    from users u
    left join profiles p on p.user_id = u.id
    where case filter
            when 'waiting'  then u.status in ('applying', 'pending_review')
            when 'admitted' then u.status = 'admitted'
            when 'rejected' then u.status = 'rejected'
            else true                      -- 'all'
          end
    order by u.applied_at desc nulls last
    limit least(greatest(limit_to, 1), 200)
  ) q;

  return jsonb_build_object(
    'filter', filter,
    'counts', (select jsonb_object_agg(status, n) from (
                 select status::text, count(*) as n from users group by status) c),
    'rows', rows);
end;
$$;

revoke execute on function admin_queue(text, int) from public, anon;
grant  execute on function admin_queue(text, int) to authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- One more count on the nav
-- ═══════════════════════════════════════════════════════════════════

-- The rail badges all come from admin_stats, so the conversation monitor
-- needs its count there too. Same expression as the dashboard's queue
-- block, so the badge and the tile cannot disagree.
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
    'flagged_chats',  (select count(distinct match_id) from messages where redacted),
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

revoke execute on function admin_stats() from public, anon;
grant  execute on function admin_stats() to authenticated;
