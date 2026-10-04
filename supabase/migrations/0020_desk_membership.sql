-- 0020 — the membership, on the desk
--
-- 0019 gave a reviewer admin_set_membership() but nothing that shows what
-- a member's membership currently is, so the only way to read it back was
-- to query the table. A reviewer who is about to change a tier needs to
-- see the tier, and the date it runs out, in the same place they change
-- it. Two keys on admin_member, and a count on admin_search so the result
-- list can show it without a second read per row.

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

  insert into admin_access_log (admin_id, subject_user_id, route, in_queue)
  values (auth.uid(), target, 'member', false);

  select jsonb_build_object(
    'user_id',        u.id,
    'status',         u.status,
    'tier',           u.tier,
    'membership',       u.membership,
    'membership_until', u.membership_until,
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

  -- Still deliberately absent: the phone number, and any verification
  -- score. A paid membership does not change what a reviewer reads.
  return result;
end;
$$;

-- create or replace keeps the old ACL, but these are re-stated rather than
-- assumed: PUBLIC holds EXECUTE on anything newly created, and a revoke
-- that names only anon and authenticated leaves that grant standing.
revoke execute on function admin_member(uuid) from public, anon;
grant execute on function admin_member(uuid) to authenticated;


-- admin_set_membership returns the tier it set, which is what the caller
-- asked for rather than what the row now holds. Returning the row's own
-- values means the screen can repaint from the answer, and a reviewer who
-- extends an existing premium sees the new end date immediately.
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
declare
  row_after users;
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
   where id = target
   returning * into row_after;

  if row_after.id is null then
    raise exception 'لا يوجد عضو بهذا المعرّف';
  end if;

  insert into admin_decisions (admin_id, subject_user_id, action, reason_code, notes)
  values (auth.uid(), target, 'admit_with_note', 'membership_' || level, notes);

  return jsonb_build_object(
    'user_id',          target,
    'membership',       row_after.membership,
    'membership_until', row_after.membership_until);
end;
$$;

revoke execute on function admin_set_membership(uuid, membership_t, int, text)
  from public, anon;
grant execute on function admin_set_membership(uuid, membership_t, int, text)
  to authenticated;
