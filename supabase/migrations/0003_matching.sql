-- =====================================================================
-- Matching: hard filters, scoring, and the daily slate.
--
-- Hard filters are applied in SQL and are never relaxed by the ranker.
-- Breaking a declared deal-breaker to widen the pool destroys trust
-- faster than showing fewer candidates.
-- =====================================================================

create or replace function age_years(dob date) returns int
language sql immutable as $$
  select extract(year from age(current_date, dob))::int;
$$;

-- ---------------------------------------------------------------------
-- Eligible candidates: every hard filter, both directions.
-- Reciprocity matters — a candidate who would reject the viewer on their
-- own stated filters is not a candidate.
-- ---------------------------------------------------------------------

create or replace function eligible_candidates(viewer uuid)
returns table (candidate_id uuid)
language sql stable security definer set search_path = public as $$
  with me as (
    select u.*, p.*, mp.*
    from users u
    join profiles p          on p.user_id = u.id
    join match_preferences mp on mp.user_id = u.id
    where u.id = viewer
  )
  select c.id
  from users c
  join profiles cp           on cp.user_id = c.id
  join match_preferences cmp on cmp.user_id = c.id
  cross join me
  where c.id <> viewer
    and c.status = 'admitted'
    and cp.discoverable
    and c.gender <> me.gender

    -- viewer's filters applied to the candidate
    and age_years(c.date_of_birth) between me.age_min and me.age_max
    and (cardinality(me.countries) = 0 or c.country_code = any(me.countries))
    and (cardinality(me.cities)    = 0 or c.city        = any(me.cities))
    and (me.accepts_divorced or cp.marital_status <> 'divorced')
    and (me.accepts_widowed  or cp.marital_status <> 'widowed')
    and (me.accepts_children or cp.children_count = 0)
    and (cardinality(me.practice_levels) = 0 or cp.practice_level = any(me.practice_levels))
    and (cardinality(me.timelines)       = 0 or cp.timeline       = any(me.timelines))
    and (not me.requires_verified_document or exists (
          select 1 from verifications v
          where v.user_id = c.id and v.type = 'document' and v.result = 'pass'))

    -- candidate's filters applied to the viewer
    and age_years(me.date_of_birth) between cmp.age_min and cmp.age_max
    and (cardinality(cmp.countries) = 0 or me.country_code = any(cmp.countries))
    and (cmp.accepts_divorced or me.marital_status <> 'divorced')
    and (cmp.accepts_widowed  or me.marital_status <> 'widowed')
    and (cmp.accepts_children or me.children_count = 0)
    and (cardinality(cmp.practice_levels) = 0 or me.practice_level = any(cmp.practice_levels))

    -- relocation has to be possible for at least one of them
    and (c.city = me.city or me.willing_to_relocate or cp.willing_to_relocate)

    -- wali requirement is mutual: if she requires one, he must accept it
    and (not me.wali_required or coalesce(cp.family_aware, false))

    and not blocked_between(viewer, c.id)

    -- never show the same person twice
    and not exists (
      select 1 from candidate_slates s
      join candidate_items i on i.slate_id = s.id
      where s.user_id = viewer and i.candidate_user_id = c.id
    )
    and not exists (
      select 1 from matches m
      where (m.user_a = least(viewer, c.id) and m.user_b = greatest(viewer, c.id))
    );
$$;

-- ---------------------------------------------------------------------
-- Compatibility: share of answered questions where the two agree.
-- ---------------------------------------------------------------------

create or replace function compatibility_score(a uuid, b uuid)
returns real language sql stable security definer set search_path = public as $$
  select case
    when count(*) = 0 then 0.5
    else (count(*) filter (where ca.answer = cb.answer))::real / count(*)::real
  end
  from compatibility_answers ca
  join compatibility_answers cb using (question_key)
  where ca.user_id = a and cb.user_id = b;
$$;

-- Responsiveness: people who reply get shown more, ghosts get shown less.
create or replace function responsiveness_score(uid uuid)
returns real language sql stable security definer set search_path = public as $$
  with mine as (
    select m.id from matches m
    where uid in (m.user_a, m.user_b) and m.state in ('active','progressed','unmatched')
  ),
  replied as (
    select count(distinct m.id) as n
    from mine m
    join messages msg on msg.match_id = m.id and msg.sender_id = uid
  )
  select case
    when (select count(*) from mine) = 0 then 0.6   -- neutral prior for new users
    else least(1.0, (select n from replied)::real / (select count(*) from mine)::real)
  end;
$$;

-- ---------------------------------------------------------------------
-- Ranking. Weights are deliberate and documented:
--   compatibility 0.40  — declared values and expectations
--   identity      0.20  — verified profiles surface first
--   intent        0.15  — seriousness, never shown to users
--   responsive    0.15  — ghosts sink
--   recency       0.10
-- Plus ~15% exploration, applied when the slate is drawn.
-- ---------------------------------------------------------------------

create or replace function candidate_score(viewer uuid, candidate uuid)
returns real language sql stable security definer set search_path = public as $$
  select
      0.40 * compatibility_score(viewer, candidate)
    + 0.20 * coalesce((select identity_confidence from trust_scores where user_id = candidate), 50) / 100.0
    + 0.15 * coalesce((select intent_confidence   from trust_scores where user_id = candidate), 50) / 100.0
    + 0.15 * responsiveness_score(candidate)
    + 0.10 * greatest(0.0, 1.0 - (extract(epoch from (now() - coalesce(
             (select last_active_at from users where id = candidate), now()))) / 1209600.0))
$$;

-- ---------------------------------------------------------------------
-- Draw the daily slate. Small and deliberate: when candidates are
-- limited people read profiles instead of rating faces.
-- ---------------------------------------------------------------------

create or replace function draw_daily_slate(viewer uuid, slate_size int default 6)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  slate uuid;
  explore_n int := greatest(1, (slate_size * 0.15)::int);
begin
  -- The caller passes a user id, but the id that counts is the session's.
  -- A function that trusts its parameter lets any signed-in client act as
  -- anyone else.
  if viewer is distinct from auth.uid() and not is_admin() then
    raise exception 'you can only draw your own slate';
  end if;
  viewer := coalesce(auth.uid(), viewer);

  if not is_admitted(viewer) then
    raise exception 'user is not admitted';
  end if;

  select id into slate from candidate_slates
   where user_id = viewer and slate_date = current_date;
  if found then
    return slate;
  end if;

  insert into candidate_slates(user_id, slate_date)
  values (viewer, current_date)
  returning id into slate;

  -- Top-ranked candidates ...
  insert into candidate_items(slate_id, candidate_user_id, rank, score)
  select slate, t.candidate_id, row_number() over (order by t.s desc), t.s
  from (
    select e.candidate_id, candidate_score(viewer, e.candidate_id) as s
    from eligible_candidates(viewer) e
    order by s desc
    limit slate_size - explore_n
  ) t;

  -- ... plus a small random tail, so a handful of profiles do not absorb
  -- all the attention on the platform.
  insert into candidate_items(slate_id, candidate_user_id, rank, score)
  select slate, e.candidate_id, slate_size - explore_n + row_number() over (), 0
  from eligible_candidates(viewer) e
  where e.candidate_id not in (
    select candidate_user_id from candidate_items where slate_id = slate
  )
  order by random()
  limit explore_n
  on conflict do nothing;

  return slate;
end;
$$;

-- ---------------------------------------------------------------------
-- Expressing interest. A match is created only on mutual interest.
-- ---------------------------------------------------------------------

create or replace function express_interest(viewer uuid, candidate uuid, interested boolean, note text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  m_id uuid;
  reciprocated boolean;
begin
  -- Without this, a client could express interest on someone else's behalf
  -- and manufacture a match between two people who never agreed to one.
  if viewer is distinct from auth.uid() then
    raise exception 'you can only answer for yourself';
  end if;

  update candidate_items ci
     set decision   = case when interested then 'interested' else 'declined' end::slate_decision_t,
         decided_at = now(),
         note       = coalesce(express_interest.note, ci.note)
    from candidate_slates s
   where ci.slate_id = s.id
     and s.user_id = viewer
     and ci.candidate_user_id = candidate;

  if not interested then
    return null;
  end if;

  select exists (
    select 1
    from candidate_slates s
    join candidate_items i on i.slate_id = s.id
    where s.user_id = candidate
      and i.candidate_user_id = viewer
      and i.decision = 'interested'
  ) into reciprocated;

  if not reciprocated then
    return null;
  end if;

  insert into matches(user_a, user_b, state, wali_present)
  values (
    least(viewer, candidate), greatest(viewer, candidate), 'active',
    exists (select 1 from guardians g
            where g.user_id in (viewer, candidate)
              and g.revoked_at is null
              and g.level in ('chaperoned','gated'))
  )
  on conflict (user_a, user_b) do update set state = 'active'
  returning id into m_id;

  return m_id;
end;
$$;

-- Contact details stay blocked until a video call has happened inside
-- the app. This is the strongest single anti-catfish control we have.
create or replace function unlock_contact(match_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update matches m
     set contact_unlocked = true
   where m.id = match_id
     and m.video_call_at is not null
     -- and the caller is actually one of the two people in it
     and auth.uid() in (m.user_a, m.user_b);
end;
$$;
