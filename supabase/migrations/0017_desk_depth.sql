-- ---------------------------------------------------------------------
-- The desk, past the first pass.
--
-- Everything so far answered "what needs deciding now". A console people
-- actually work in has to answer more than that: what did I decide, who
-- decided this, where is that person, why can no meeting be scheduled.
--
-- The first of those is what prompted this. The photo screen listed only
-- unapproved photos, so once a reviewer had worked through them it was
-- empty — and looked broken. A queue you can only empty and never look
-- back at is a queue you cannot correct.
-- ---------------------------------------------------------------------


-- ── Photos, with a filter and a way back ──────────────────────────────

create or replace function admin_photo_queue(
  filter text default 'pending',
  limit_to int default 60
) returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'not an admin';
  end if;

  insert into admin_access_log (admin_id, subject_user_id, route, in_queue)
  values (auth.uid(), null, 'photo_queue:' || filter, true);

  return jsonb_build_object(
    'filter', filter,
    'counts', jsonb_build_object(
      'pending',  (select count(*) from photos where approved = false),
      'approved', (select count(*) from photos where approved = true)),
    'rows', coalesce((
      select jsonb_agg(row_to_json(q)::jsonb order by q.created_at desc)
      from (
        select
          ph.id, ph.storage_path, ph.is_primary, ph.approved, ph.created_at,
          ph.face_detected, ph.decency_score,
          u.id as user_id, u.city, u.status,
          p.display_name,
          date_part('year', age(u.date_of_birth))::int as age
        from photos ph
        join users u on u.id = ph.user_id
        left join profiles p on p.user_id = ph.user_id
        where case filter
                when 'pending'  then ph.approved = false
                when 'approved' then ph.approved = true
                else true
              end
        order by ph.created_at desc
        limit least(greatest(limit_to, 1), 200)
      ) q), '[]'::jsonb));
end;
$$;


-- Three outcomes, not two.
--
-- `delete` is final and takes the file with it. `unapprove` is the one
-- that was missing: a photo approved in haste, or fine yesterday and not
-- today, goes back to pending instead of being destroyed. A console
-- whose only correction is deletion makes reviewers cautious in the wrong
-- direction — they leave things pending rather than risk removing them.
create or replace function admin_photo_action(
  photo_id uuid,
  action   text,                    -- approve | unapprove | delete
  reason   text default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  ph photos;
begin
  if not is_admin() then
    raise exception 'not an admin';
  end if;

  if action not in ('approve', 'unapprove', 'delete') then
    raise exception 'action must be approve, unapprove or delete';
  end if;

  select * into ph from photos where id = photo_id;
  if ph.id is null then
    raise exception 'لم نعثر على هذه الصورة';
  end if;

  if action = 'approve' then
    update photos set approved = true where id = photo_id;
  elsif action = 'unapprove' then
    update photos set approved = false where id = photo_id;
  else
    delete from photos where id = photo_id;
  end if;

  insert into admin_decisions (admin_id, subject_user_id, action, reason_code, notes)
  values (auth.uid(), ph.user_id,
          (case when action = 'approve' then 'admit_with_note'
                else 'request_evidence' end)::admin_action_t,
          'photo_' || action, reason);

  return jsonb_build_object('id', photo_id, 'action', action,
                            'storage_path', ph.storage_path);
end;
$$;


-- ── Finding one person ────────────────────────────────────────────────
--
-- A queue is fine at twenty applicants and useless at two thousand. The
-- search is on name and city, and on the account id, because the id is
-- what an error report or a database row gives you.
create or replace function admin_search(q text, limit_to int default 30)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  needle text := trim(coalesce(q, ''));
begin
  if not is_admin() then
    raise exception 'not an admin';
  end if;

  if length(needle) < 2 then
    return '[]'::jsonb;
  end if;

  insert into admin_access_log (admin_id, subject_user_id, route, in_queue)
  values (auth.uid(), null, 'search', true);

  return coalesce((
    select jsonb_agg(row_to_json(r)::jsonb)
    from (
      select
        u.id, u.status, u.city,
        p.display_name,
        date_part('year', age(u.date_of_birth))::int as age,
        (select count(*) from photos ph where ph.user_id = u.id) as photo_count
      from users u
      left join profiles p on p.user_id = u.id
      where p.display_name ilike '%' || needle || '%'
         or u.city         ilike '%' || needle || '%'
         -- An id is matched by prefix, so the first segment is enough.
         or u.id::text like needle || '%'
      order by u.applied_at desc nulls last
      limit least(greatest(limit_to, 1), 100)
    ) r), '[]'::jsonb);
end;
$$;


-- ── Meetings ──────────────────────────────────────────────────────────
--
-- Both sides agree to meet, and then nothing happens, because assigning
-- a slot is `schedule_meeting` and nobody had a screen for it. This is
-- that screen's data: meetings waiting on the office, and the slots they
-- could be put in.
create or replace function admin_meetings(filter text default 'pending', limit_to int default 60)
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
  values (auth.uid(), null, 'meetings:' || filter, true);

  return jsonb_build_object(
    'filter', filter,
    'counts', jsonb_build_object(
      'pending',   (select count(*) from meetings where state in ('proposed', 'pending_scheduling')),
      'scheduled', (select count(*) from meetings where state = 'scheduled')),
    'rows', coalesce((
      select jsonb_agg(row_to_json(m)::jsonb order by m.proposed_at)
      from (
        select
          mg.id, mg.state, mg.note, mg.proposed_at, mg.scheduled_at,
          mg.proposer_brings_family, mg.invitee_brings_family,
          pa.display_name as party_a, pb.display_name as party_b,
          ua.city         as city,
          o.name          as office,
          s.starts_at, s.room, s.staff_name
        from meetings mg
        join matches mt   on mt.id = mg.match_id
        join users ua     on ua.id = mt.user_a
        left join profiles pa on pa.user_id = mt.user_a
        left join profiles pb on pb.user_id = mt.user_b
        left join office_slots s on s.id = mg.slot_id
        left join offices o      on o.id = coalesce(mg.office_id, s.office_id)
        where case filter
                when 'pending'   then mg.state in ('proposed', 'pending_scheduling')
                when 'scheduled' then mg.state = 'scheduled'
                else true
              end
        order by mg.proposed_at
        limit least(greatest(limit_to, 1), 200)
      ) m), '[]'::jsonb));
end;
$$;


-- ── Who has been doing what ───────────────────────────────────────────
--
-- Every decision and every profile opened has been recorded since the
-- desk existed. Recording it and never showing it is a half-measure: an
-- audit trail nobody reads deters nobody.
create or replace function admin_audit(limit_to int default 80)
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
    select jsonb_agg(row_to_json(e)::jsonb order by e.at desc)
    from (
      select d.created_at as at, 'decision' as kind,
             a.full_name as who,
             d.action::text as what,
             d.reason_code as detail,
             p.display_name as subject
        from admin_decisions d
        left join admin_users a on a.id = d.admin_id
        left join profiles p    on p.user_id = d.subject_user_id
      union all
      select l.created_at as at, 'access' as kind,
             a.full_name as who,
             l.route as what,
             null as detail,
             p.display_name as subject
        from admin_access_log l
        left join admin_users a on a.id = l.admin_id
        left join profiles p    on p.user_id = l.subject_user_id
       where l.subject_user_id is not null     -- opening one person's file
      order by at desc
      limit least(greatest(limit_to, 1), 300)
    ) e), '[]'::jsonb);
end;
$$;


-- Who can review, and how much they have reviewed. Read-only on purpose:
-- granting and revoking stay in the SQL editor, so a reviewer whose
-- account is taken over cannot lock out the others or promote anyone.
create or replace function admin_reviewers()
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
    select jsonb_agg(row_to_json(r)::jsonb order by r.decisions desc)
    from (
      select
        a.email, a.full_name, a.role, a.active, a.created_at,
        a.id = auth.uid() as is_me,
        (select count(*) from admin_decisions d where d.admin_id = a.id) as decisions,
        (select max(created_at) from admin_decisions d where d.admin_id = a.id) as last_decision
      from admin_users a
    ) r), '[]'::jsonb);
end;
$$;


grant execute on function admin_photo_queue(text, int)               to authenticated;
grant execute on function admin_photo_action(uuid, text, text)       to authenticated;
grant execute on function admin_search(text, int)                    to authenticated;
grant execute on function admin_meetings(text, int)                  to authenticated;
grant execute on function admin_audit(int)                           to authenticated;
grant execute on function admin_reviewers()                          to authenticated;

-- The one-filter version from 0016 is gone; its callers move to
-- admin_photo_action. Dropped rather than left behind, so there is one
-- way to act on a photo and no second path with different rules.
drop function if exists admin_decide_photo(uuid, boolean, text);
drop function if exists admin_photo_queue(int);


-- The desk's nav shows a count on every section, so the meetings waiting
-- on a slot have to be in the same call the rest of the counts come from.
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
    'matches_active', (select count(*) from matches where state = 'active'),
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
