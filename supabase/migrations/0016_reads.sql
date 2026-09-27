-- ---------------------------------------------------------------------
-- The reads.
--
-- Every write this product needs already exists: request photo access,
-- respond, revoke, propose a meeting, express interest, send a message.
-- What was missing is the other half — functions that return what a
-- screen shows. Without them the screens ran on fixtures, which is why
-- the app looked like a demo however much of it was real.
--
-- Two rules shape all of it.
--
-- Each function reads auth.uid() and decides for itself what the caller
-- may see. None takes a user id as an argument: an argument is a thing a
-- patched client changes.
--
-- And each returns the fields its screen needs, never `select *`. A
-- reviewer's list does not carry phone numbers; a member's thread does
-- not carry the other person's account row; the directory carries no
-- photo paths. What is absent cannot leak.
-- ---------------------------------------------------------------------


-- ═══════════════════════════════════════════════════════════════════
-- The member's own screens
-- ═══════════════════════════════════════════════════════════════════

-- Requests to see my photos that have passed screening and are waiting
-- on me. Requests the admin blocked never appear: the point of screening
-- is that she is not troubled by them at all.
create or replace function my_photo_requests()
  returns jsonb
  language sql
  security definer
  set search_path = public
  stable
as $$
  select coalesce(jsonb_agg(row_to_json(r)::jsonb order by r.created_at), '[]'::jsonb)
  from (
    select
      req.id,
      req.note,
      req.created_at,
      req.responds_by,
      p.display_name,
      u.city,
      date_part('year', age(u.date_of_birth))::int as age,
      (u.status = 'admitted')                      as verified
    from photo_access_requests req
    join users u    on u.id = req.requester_id
    join profiles p on p.user_id = req.requester_id
    where req.owner_id = auth.uid()
      and req.state = 'pending_owner'
      and req.responds_by > now()
    order by req.created_at
  ) r
$$;


-- Who can currently see my photos, and what they have done with that.
-- The screenshot count is here because it is the number that makes
-- someone revoke, and burying it would be a kindness to the wrong party.
create or replace function my_photo_grants()
  returns jsonb
  language sql
  security definer
  set search_path = public
  stable
as $$
  select coalesce(jsonb_agg(row_to_json(g)::jsonb order by g.granted_at desc), '[]'::jsonb)
  from (
    select
      gr.id,
      p.display_name,
      gr.granted_at,
      gr.expires_at,
      greatest(0, extract(day from gr.expires_at - now())::int) as days_left,
      gr.view_count,
      gr.last_viewed_at,
      -- 'screenshot_attempt', not 'screenshot': the check constraint on
      -- photo_view_events names it that way, and a filter on the wrong
      -- literal returns zero forever without ever failing.
      (select count(*) from photo_view_events se
        where se.grant_id = gr.id
          and se.kind in ('screenshot_attempt', 'screen_recording')) as screenshots
    from photo_access_grants gr
    join profiles p on p.user_id = gr.viewer_id
    where gr.owner_id = auth.uid()
      and gr.revoked_at is null
      and gr.expires_at > now()
  ) g
$$;


-- My matches, with just enough of the other person to list them.
create or replace function my_matches()
  returns jsonb
  language sql
  security definer
  set search_path = public
  stable
as $$
  select coalesce(jsonb_agg(row_to_json(m)::jsonb order by m.created_at desc), '[]'::jsonb)
  from (
    select
      mt.id,
      mt.state,
      mt.contact_unlocked,
      mt.video_call_at,
      mt.created_at,
      other.id                                        as other_id,
      p.display_name,
      other.city,
      date_part('year', age(other.date_of_birth))::int as age,
      (select count(*) from messages ms
        where ms.match_id = mt.id and ms.sender_id <> auth.uid()
          and ms.read_at is null)                      as unread
    from matches mt
    join users other
      on other.id = case when mt.user_a = auth.uid() then mt.user_b else mt.user_a end
    join profiles p on p.user_id = other.id
    where (mt.user_a = auth.uid() or mt.user_b = auth.uid())
      and mt.state in ('active', 'pending', 'progressed')
  ) m
$$;


-- One thread. The `contact_unlocked` flag comes back with it because the
-- composer's warnings depend on it, and a screen that guessed would warn
-- about the wrong things.
create or replace function match_thread(p_match_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  m matches;
begin
  select * into m from matches
   where id = p_match_id and (user_a = auth.uid() or user_b = auth.uid());

  if m.id is null then
    raise exception 'لا توجد هذه المحادثة';
  end if;

  -- Reading the thread marks it read. Doing it here rather than in the
  -- client means it happens once, on the server, and cannot be skipped
  -- by a client that would rather not send read receipts.
  update messages set read_at = now()
   where match_id = m.id and sender_id <> auth.uid() and read_at is null;

  return jsonb_build_object(
    'match_id',         m.id,
    'contact_unlocked', m.contact_unlocked,
    'state',            m.state,
    'messages', (
      select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.created_at), '[]'::jsonb)
      from (
        select id, sender_id = auth.uid() as mine, body, redacted, flags, created_at
          from messages where match_id = m.id order by created_at
      ) x));
end;
$$;


-- Sending. The body is not sanitised here: the trigger from 0008 does
-- that on the way in, so a client that skipped this function and wrote
-- straight to the table would get the same treatment.
create or replace function send_message(p_match_id uuid, p_body text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  m matches;
  new_id uuid;
begin
  if coalesce(trim(p_body), '') = '' then
    raise exception 'الرسالة فارغة';
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


-- Meetings I am part of, with the office details once one is scheduled.
create or replace function my_meetings()
  returns jsonb
  language sql
  security definer
  set search_path = public
  stable
as $$
  select coalesce(jsonb_agg(row_to_json(m)::jsonb order by m.proposed_at desc), '[]'::jsonb)
  from (
    select
      mg.id,
      mg.state,
      mg.note,
      mg.proposed_at,
      mg.scheduled_at,
      mg.proposed_by = auth.uid() as i_proposed,
      mg.proposer_brings_family,
      mg.invitee_brings_family,
      p.display_name              as with_name,
      o.name                      as office,
      o.address,
      o.maps_url,
      s.starts_at,
      s.staff_name,
      s.room
    from meetings mg
    join matches mt on mt.id = mg.match_id
    join profiles p
      on p.user_id = case when mt.user_a = auth.uid() then mt.user_b else mt.user_a end
    left join office_slots s on s.id = mg.slot_id
    left join offices o      on o.id = coalesce(mg.office_id, s.office_id)
    where mt.user_a = auth.uid() or mt.user_b = auth.uid()
  ) m
$$;


grant execute on function my_photo_requests()        to authenticated;
grant execute on function my_photo_grants()          to authenticated;
grant execute on function my_matches()               to authenticated;
grant execute on function match_thread(uuid)         to authenticated;
grant execute on function send_message(uuid, text)   to authenticated;
grant execute on function my_meetings()              to authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- The review desk
-- ═══════════════════════════════════════════════════════════════════

-- Photos waiting to be approved.
--
-- A photo is uploaded with approved = false and nothing a client can
-- call sets it true, so until this screen existed every uploaded photo
-- was invisible to everyone but its owner. That was the intended state,
-- not an oversight — but a queue nobody can work is a queue that grows.
create or replace function admin_photo_queue(limit_to int default 60)
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
  values (auth.uid(), null, 'photo_queue', true);

  return coalesce((
    select jsonb_agg(row_to_json(q)::jsonb order by q.created_at)
    from (
      select
        ph.id,
        ph.storage_path,
        ph.is_primary,
        ph.created_at,
        ph.face_detected,
        ph.decency_score,
        u.id      as user_id,
        p.display_name,
        u.city,
        u.status,
        date_part('year', age(u.date_of_birth))::int as age
      from photos ph
      join users u    on u.id = ph.user_id
      left join profiles p on p.user_id = ph.user_id
      where ph.approved = false
      order by ph.created_at
      limit least(greatest(limit_to, 1), 200)
    ) q), '[]'::jsonb);
end;
$$;


-- Approving, or removing.
--
-- Rejecting deletes the row rather than flagging it: a photo a reviewer
-- has refused should not sit in the owner's profile looking like it might
-- yet be allowed, and keeping it would mean keeping the file too. The
-- caller is told the storage path so the object can follow.
create or replace function admin_decide_photo(
  photo_id uuid,
  approve  boolean,
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

  select * into ph from photos where id = photo_id;
  if ph.id is null then
    raise exception 'لم نعثر على هذه الصورة';
  end if;

  if approve then
    update photos set approved = true where id = photo_id;
  else
    delete from photos where id = photo_id;
  end if;

  -- Recorded against the photo's owner, so a pattern shows up on their
  -- record rather than only in a photo table nobody reads.
  insert into admin_decisions (admin_id, subject_user_id, action, reason_code, notes)
  values (auth.uid(), ph.user_id,
          (case when approve then 'admit_with_note' else 'request_evidence' end)::admin_action_t,
          case when approve then 'photo_approved' else 'photo_rejected' end,
          reason);

  return jsonb_build_object(
    'id', photo_id, 'approved', approve, 'storage_path', ph.storage_path);
end;
$$;


-- One member's whole record, for a reviewer who has opened them.
create or replace function admin_member(target uuid)
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

  -- Opening a profile is logged with the subject. This is the row that
  -- answers "who looked at her file, and when".
  insert into admin_access_log (admin_id, subject_user_id, route, in_queue)
  values (auth.uid(), target, 'member', false);

  select jsonb_build_object(
    'user_id',        u.id,
    'status',         u.status,
    'tier',           u.tier,
    'gender',         u.gender,
    'age',            date_part('year', age(u.date_of_birth))::int,
    'city',           u.city,
    'country_code',   u.country_code,
    'applied_at',     u.applied_at,
    'admitted_at',    u.admitted_at,
    'last_active_at', u.last_active_at,
    'display_name',   p.display_name,
    'bio',            p.bio,
    'occupation',     p.occupation,
    'education',      p.education,
    'marital_status', p.marital_status,
    'children_count', p.children_count,
    'practice_level', p.practice_level,
    'timeline',       p.timeline,
    'willing_to_relocate',   p.willing_to_relocate,
    'family_aware',          p.family_aware,
    'wali_required',         p.wali_required,
    'living_after_marriage', p.living_after_marriage,
    'photos', (
      select coalesce(jsonb_agg(row_to_json(ph)::jsonb order by ph.ordinal), '[]'::jsonb)
      from (select id, storage_path, ordinal, is_primary, approved, created_at
              from photos where user_id = u.id) ph),
    'decisions', (
      select coalesce(jsonb_agg(row_to_json(d)::jsonb order by d.created_at desc), '[]'::jsonb)
      from (select action, reason_code, notes, created_at,
                   (select full_name from admin_users a where a.id = ad.admin_id) as by
              from admin_decisions ad where ad.subject_user_id = u.id
             order by created_at desc limit 20) d),
    'reports_against', (
      select count(*) from reports r where r.reported_id = u.id and r.status = 'open'),
    'matches', (select count(*) from matches m
                 where (m.user_a = u.id or m.user_b = u.id) and m.state = 'active')
  ) into result
  from users u
  left join profiles p on p.user_id = u.id
  where u.id = target;

  if result is null then
    raise exception 'لا يوجد عضو بهذا المعرّف';
  end if;

  -- Deliberately absent: the phone number, and any verification score.
  -- A reviewer decides from what the applicant wrote and what the checks
  -- concluded, not from a number they will learn to defer to.
  return result;
end;
$$;


-- Reports. Both sides are named, because a report is also evidence about
-- the person who made it.
create or replace function admin_reports(filter text default 'open', limit_to int default 60)
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
  values (auth.uid(), null, 'reports:' || filter, true);

  return jsonb_build_object(
    'filter', filter,
    'counts', (select jsonb_object_agg(status, n)
                 from (select status, count(*) as n from reports group by status) s),
    'rows', coalesce((
      select jsonb_agg(row_to_json(r)::jsonb order by r.created_at desc)
      from (
        select
          rep.id,
          rep.reason,
          rep.detail,
          rep.status,
          rep.created_at,
          rep.reported_id,
          rp.display_name as reported_name,
          ru.status       as reported_status,
          rep.reporter_id,
          pr.display_name as reporter_name,
          (select count(*) from reports o
            where o.reported_id = rep.reported_id) as reports_against_total,
          (select count(*) from reports o
            where o.reporter_id = rep.reporter_id) as reports_by_reporter
        from reports rep
        join users ru     on ru.id = rep.reported_id
        left join profiles rp on rp.user_id = rep.reported_id
        left join profiles pr on pr.user_id = rep.reporter_id
        where case filter when 'open' then rep.status = 'open' else true end
        order by rep.created_at desc
        limit least(greatest(limit_to, 1), 200)
      ) r), '[]'::jsonb));
end;
$$;


create or replace function admin_resolve_report(
  report_id uuid,
  action    text,              -- actioned | dismissed
  notes     text default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  rep reports;
begin
  if not is_admin() then
    raise exception 'not an admin';
  end if;

  if action not in ('actioned', 'dismissed') then
    raise exception 'action must be actioned or dismissed';
  end if;

  update reports set status = action, resolved_at = now()
   where id = report_id
  returning * into rep;

  if rep.id is null then
    raise exception 'لا يوجد هذا البلاغ';
  end if;

  -- Dismissing is a decision too, and recording it is what makes a
  -- pattern of dismissals visible later.
  insert into admin_decisions (admin_id, subject_user_id, action, reason_code, notes)
  values (auth.uid(), rep.reported_id, 'request_evidence'::admin_action_t,
          'report_' || action, notes);

  return jsonb_build_object('id', report_id, 'status', action);
end;
$$;


-- Photo access requests waiting to be screened, before the owner is ever
-- troubled with them. `admin_screen_photo_request` in 0005 is the
-- decision; this is the list it works from.
create or replace function admin_photo_requests(limit_to int default 60)
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
  values (auth.uid(), null, 'photo_requests', true);

  return coalesce((
    select jsonb_agg(row_to_json(q)::jsonb order by q.created_at)
    from (
      select
        req.id,
        req.note,
        req.created_at,
        req.requester_id,
        rp.display_name as requester_name,
        ru.status       as requester_status,
        date_part('year', age(ru.date_of_birth))::int as requester_age,
        req.owner_id,
        op.display_name as owner_name,
        (select count(*) from photo_access_requests o
          where o.requester_id = req.requester_id) as requests_by_requester
      from photo_access_requests req
      join users ru         on ru.id = req.requester_id
      left join profiles rp on rp.user_id = req.requester_id
      left join profiles op on op.user_id = req.owner_id
      where req.state = 'pending_admin'
      order by req.created_at
      limit least(greatest(limit_to, 1), 200)
    ) q), '[]'::jsonb);
end;
$$;


-- The numbers that say whether the desk is keeping up.
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
    'matches_active', (select count(*) from matches where state = 'active'),
    'applied_7d',     (select count(*) from users where applied_at > now() - interval '7 days'),
    'decided_7d',     (select count(*) from admin_decisions where created_at > now() - interval '7 days'),
    -- The one that matters most: how long the person who has been waiting
    -- longest has been waiting. An average hides them.
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


grant execute on function admin_photo_queue(int)                    to authenticated;
grant execute on function admin_decide_photo(uuid, boolean, text)   to authenticated;
grant execute on function admin_member(uuid)                        to authenticated;
grant execute on function admin_reports(text, int)                  to authenticated;
grant execute on function admin_resolve_report(uuid, text, text)    to authenticated;
grant execute on function admin_photo_requests(int)                 to authenticated;
grant execute on function admin_stats()                             to authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- Admin actions the desk now performs from a browser
-- ═══════════════════════════════════════════════════════════════════
--
-- 0005 and 0006 revoked these from client roles, on the assumption that
-- a reviewer would act through a service-role backend. The review desk
-- runs in the browser instead, as an authenticated admin, so they are
-- granted back — to `authenticated` only, never `anon`.
--
-- Safe because each one opens with its own is_admin() check: the grant
-- decides who may call, the check decides who may act, and a member
-- calling any of them gets the same refusal as before.
grant execute on function admin_screen_photo_request(uuid, boolean, text) to authenticated;
grant execute on function schedule_meeting(uuid, uuid)                    to authenticated;
grant execute on function record_meeting_outcome(uuid, boolean, boolean, text) to authenticated;
