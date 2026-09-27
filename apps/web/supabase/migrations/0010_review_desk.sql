-- ---------------------------------------------------------------------
-- The review desk, the member directory, and photos.
--
-- Everything before this migration built the applicant's side. Nobody was
-- ever admitted, because admission is a human decision and there was no
-- way for a human to make it — so the member side of the product was
-- permanently empty. This is that missing half.
--
-- Three things it adds:
--
--   * A queue an admin can work: who applied, what they submitted, and
--     admit or reject with a reason that is recorded.
--   * A directory, so an admitted member sees real admitted people
--     instead of a fixture.
--   * Photo rows and signed URLs, so an uploaded picture is a real
--     object in a private bucket rather than a data URL in a browser tab.
--
-- The rule that shapes all of it: an admin is a row in `admin_users`, and
-- nothing reachable from a browser can create one. See grant_admin below.
-- ---------------------------------------------------------------------


-- ── Who am I ──────────────────────────────────────────────────────────
-- An anonymous session has no email and no name, so the Supabase
-- dashboard shows it as one of many identical rows. This is how the first
-- admin finds the id to grant, and how the app knows whether to show the
-- review desk at all.
create or replace function whoami()
  returns jsonb
  language sql
  security definer
  set search_path = public
  stable
as $$
  select jsonb_build_object(
    'user_id',  auth.uid(),
    'is_admin', is_admin(),
    'status',   (select status from users where id = auth.uid()),
    'has_row',  exists (select 1 from users where id = auth.uid())
  )
$$;

grant execute on function whoami() to authenticated, anon;


-- ── Becoming the first admin ──────────────────────────────────────────
-- Run from the Supabase SQL editor, and from nowhere else:
--
--   select grant_admin('<your user id>', 'you@example.com', 'Your Name');
--
-- There is no invite code, no secret in an environment variable, no
-- "first user becomes admin" rule. Every one of those is a path to admin
-- that exists in the deployed system, and an admin can admit accounts and
-- read every profile. The only path is someone with database credentials
-- typing a specific user id.
--
-- Two details carry the whole guarantee, and both are easy to get wrong:
--
--   * It is NOT `security definer`. A definer function runs as its owner,
--     which means `current_user` inside it is the owner and a check
--     against it always passes — the guard would read as protection and
--     be worth nothing. As an invoker function it runs with the caller's
--     privileges, and `authenticated` has no insert on admin_users.
--   * The revoke below includes PUBLIC. A new function is granted to
--     PUBLIC by default, so revoking from `authenticated` and `anon`
--     alone leaves it callable by both of them through PUBLIC. This is
--     the mistake that would have shipped a browser-reachable way to
--     become an admin.
create or replace function grant_admin(
  target uuid,
  email  text default null,
  name   text default null
) returns text
  language plpgsql
  set search_path = public
as $$
begin
  if not exists (select 1 from auth.users where id = target) then
    raise exception 'no such user: %', target;
  end if;

  insert into admin_users (id, email, full_name, role)
  values (target,
          coalesce(email, target::text || '@local'),
          coalesce(name, 'Owner'),
          'admin')
  on conflict (id) do update set active = true, role = 'admin';

  return format('%s is now an admin', target);
end;
$$;

revoke all on function grant_admin(uuid, text, text) from public, authenticated, anon;


-- ── The queue ─────────────────────────────────────────────────────────
-- What the reviewer sees. Deliberately not `select *`: a reviewer needs
-- enough to make a decision and no more, and the columns left out here
-- are left out on purpose — the phone number is not shown in a list
-- anyone can scroll past, and there is no score, because a number next to
-- a face is what a reviewer starts deferring to instead of looking.
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

  -- Every list a reviewer opens is logged, not only every profile. An
  -- insider reading the whole queue is the breach that actually happens.
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
      p.marital_status,
      p.practice_level,
      p.timeline,
      p.willing_to_relocate,
      p.family_aware,
      (select count(*) from photos ph where ph.user_id = u.id) as photo_count,
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
                 select status::text, count(*) as n from users group by status) s),
    'rows',   rows);
end;
$$;

grant execute on function admin_queue(text, int) to authenticated;


-- ── Letting a decision through the guard ──────────────────────────────
-- `users_guard_privileged` (0002) refuses any client write to status,
-- tier, phone or date of birth, and it decides by the JWT role. An admin's
-- token says `authenticated`, so the guard refuses the admin's own
-- decision too — correctly, from where it is standing: it cannot tell a
-- review decision from a patched client doing the same UPDATE.
--
-- The exemption is a transaction-local setting that only `admin_decide`
-- sets, rather than an `is_admin()` exception in the trigger. The
-- difference matters: an `is_admin()` exemption would open every write
-- path an admin has, including a direct PostgREST update, so a stolen
-- reviewer token could set anyone's status without leaving a row in
-- admin_decisions. This way the only way through the guard is the
-- function that writes the audit row in the same transaction.
create or replace function guard_privileged_user_columns() returns trigger
language plpgsql as $$
begin
  if auth.role() <> 'service_role'
     and coalesce(current_setting('nasib.reviewing', true), '') <> 'on' then
    if new.status <> old.status or new.tier <> old.tier
       or new.phone_e164 is distinct from old.phone_e164
       or new.date_of_birth <> old.date_of_birth then
      raise exception 'privileged column is not client-writable';
    end if;
  end if;
  return new;
end;
$$;


-- ── The decision ──────────────────────────────────────────────────────
-- One function for every outcome, because the audit row must be written
-- in the same transaction as the status change. Two functions, or a
-- status update with the log left to the caller, is how a decision ends
-- up with nobody's name on it.
create or replace function admin_decide(
  target      uuid,
  action      admin_action_t,
  reason_code text default 'reviewed',
  notes       text default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  next_status account_status;
begin
  if not is_admin() then
    raise exception 'not an admin';
  end if;

  if target = auth.uid() then
    -- Not a moral point, a practical one: the only account an admin can
    -- admit without review is their own, and a system where that is
    -- possible has no reviewed accounts in it.
    raise exception 'you cannot decide your own application';
  end if;

  next_status := case action
    when 'admit'            then 'admitted'
    when 'admit_with_note'  then 'admitted'
    when 'reject'           then 'rejected'
    when 'shadow_limit'     then 'shadow_limited'
    when 'lift_limit'       then 'admitted'
    when 'ban_account'      then 'banned'
    when 'unban'            then 'pending_review'
    when 'request_evidence' then 'pending_review'
    else null
  end;

  if next_status is null then
    raise exception 'action % does not map to a status', action;
  end if;

  -- Transaction-local, so it is gone the moment this function returns
  -- whether it returned normally or raised.
  perform set_config('nasib.reviewing', 'on', true);

  update users
     set status      = next_status,
         admitted_at = case when next_status = 'admitted'
                            then coalesce(admitted_at, now()) else admitted_at end
   where id = target;

  if not found then
    raise exception 'no such applicant';
  end if;

  insert into admin_decisions (admin_id, subject_user_id, action, reason_code, notes)
  values (auth.uid(), target, action, reason_code, notes);

  return jsonb_build_object('user_id', target, 'status', next_status);
end;
$$;

grant execute on function admin_decide(uuid, admin_action_t, text, text) to authenticated;


-- ── The directory ─────────────────────────────────────────────────────
-- What an admitted member sees: other admitted members of the other
-- gender, minus anyone either of them has blocked. Photos are not in
-- here at all — they are requested and granted, which is what 0005 is
-- about, and a directory that returned them would go around it.
create or replace function browse_members(limit_to int default 30)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  me users;
begin
  select * into me from users where id = auth.uid();

  if me.id is null then
    raise exception 'not signed in';
  end if;

  -- The gate, stated once. An applicant browsing the directory before
  -- being admitted would make admission decorative.
  if me.status <> 'admitted' and not is_admin() then
    return jsonb_build_object('gated', true, 'status', me.status, 'rows', '[]'::jsonb);
  end if;

  return jsonb_build_object('gated', false, 'status', me.status, 'rows', (
    select coalesce(jsonb_agg(row_to_json(c)::jsonb), '[]'::jsonb)
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
        (select count(*) from photos ph where ph.user_id = u.id) as photo_count,
        has_photo_access(auth.uid(), u.id) as photos_unlocked
      from users u
      join profiles p on p.user_id = u.id
      where u.status = 'admitted'
        and u.id <> me.id
        and u.gender <> me.gender
        and not blocked_between(me.id, u.id)
      order by u.last_active_at desc nulls last, u.admitted_at desc nulls last
      limit least(greatest(limit_to, 1), 100)
    ) c));
end;
$$;

grant execute on function browse_members(int) to authenticated;


-- ── Photos ────────────────────────────────────────────────────────────
-- The file itself goes to Supabase Storage, in a private bucket, under a
-- path that starts with the owner's user id. The row here is the record
-- of it: ordering, which one is primary, and whether a reviewer has
-- approved it.
--
-- `approved` starts false and nothing a client can call sets it true.
-- An unapproved photo is visible to its owner and to a reviewer, and to
-- nobody else, however many grants exist.
create or replace function add_photo(path text, make_primary boolean default false)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  uid   uuid := auth.uid();
  count_now int;
  new_id uuid;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  -- The path is checked, not trusted. A client that asks to register
  -- `<someone else's id>/photo.jpg` would otherwise attach their file to
  -- its own profile, and the storage policy alone would not catch it —
  -- reading a path is a different permission from claiming one.
  if path is null or path not like uid::text || '/%' then
    raise exception 'a photo path must start with your own user id';
  end if;

  select count(*) into count_now from photos where user_id = uid;
  if count_now >= 6 then
    raise exception 'ستة صور هي الحد الأقصى';
  end if;

  insert into photos (user_id, storage_path, ordinal, is_primary)
  values (uid, path, count_now,
          make_primary or count_now = 0)
  returning id into new_id;

  if make_primary or count_now = 0 then
    update photos set is_primary = (id = new_id) where user_id = uid;
  end if;

  return jsonb_build_object('id', new_id, 'storage_path', path);
end;
$$;

create or replace function my_photos()
  returns jsonb
  language sql
  security definer
  set search_path = public
  stable
as $$
  select coalesce(jsonb_agg(row_to_json(p)::jsonb order by p.ordinal), '[]'::jsonb)
  from (select id, storage_path, ordinal, is_primary, approved, created_at
          from photos where user_id = auth.uid() order by ordinal) p
$$;

create or replace function delete_photo(photo_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  gone text;
begin
  delete from photos
   where id = photo_id and user_id = auth.uid()
  returning storage_path into gone;

  if gone is null then
    raise exception 'no such photo';
  end if;

  -- The row is gone; the object in the bucket is the caller's job to
  -- remove next, and it is told the path so it can. This is deliberately
  -- not one atomic operation: a storage delete cannot be rolled back, and
  -- an orphaned object is a smaller problem than a row pointing at a file
  -- that is no longer there.
  return jsonb_build_object('deleted', photo_id, 'storage_path', gone);
end;
$$;

grant execute on function add_photo(text, boolean)  to authenticated;
grant execute on function my_photos()               to authenticated;
grant execute on function delete_photo(uuid)        to authenticated;


-- ── Storage policies ──────────────────────────────────────────────────
-- The bucket is created from the dashboard (or the statement below, if
-- storage is installed). These policies are what make it safe: a file is
-- readable by its owner and by a reviewer, and by nobody else — so a
-- signed URL is the only way another member ever sees a photo, and
-- reveal_photo in 0005 is what issues one.
do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage schema not installed — skipping bucket policies (local run)';
    return;
  end if;

  insert into storage.buckets (id, name, public)
  values ('photos', 'photos', false)
  on conflict (id) do update set public = false;

  -- Written as dynamic SQL because `create policy if not exists` does not
  -- exist, and a migration that fails on a second run is a migration
  -- nobody dares re-run.
  execute $p$ drop policy if exists photos_own_read on storage.objects $p$;
  execute $p$ create policy photos_own_read on storage.objects for select
                using (bucket_id = 'photos'
                       and (owner = auth.uid()
                            or (storage.foldername(name))[1] = auth.uid()::text
                            or is_admin())) $p$;

  execute $p$ drop policy if exists photos_own_write on storage.objects $p$;
  execute $p$ create policy photos_own_write on storage.objects for insert
                with check (bucket_id = 'photos'
                            and (storage.foldername(name))[1] = auth.uid()::text) $p$;

  execute $p$ drop policy if exists photos_own_delete on storage.objects $p$;
  execute $p$ create policy photos_own_delete on storage.objects for delete
                using (bucket_id = 'photos'
                       and (storage.foldername(name))[1] = auth.uid()::text) $p$;
end $$;


-- ── Editing your own profile after applying ───────────────────────────
-- apply_for_membership already upserts both rows, so editing is the same
-- call. What was missing is reading back everything the edit screen needs
-- to prefill — my_application returns the applicant's summary, not the
-- whole profile.
create or replace function my_profile()
  returns jsonb
  language sql
  security definer
  set search_path = public
  stable
as $$
  select jsonb_build_object(
    'user_id',        u.id,
    'status',         u.status,
    'tier',           u.tier,
    'gender',         u.gender,
    'date_of_birth',  u.date_of_birth,
    'city',           u.city,
    'country_code',   u.country_code,
    'phone',          u.phone_e164,
    'applied_at',     u.applied_at,
    'admitted_at',    u.admitted_at,
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
    'photos',        (select coalesce(jsonb_agg(row_to_json(ph)::jsonb order by ph.ordinal), '[]'::jsonb)
                        from (select id, storage_path, ordinal, is_primary, approved
                                from photos where user_id = u.id) ph)
  )
  from users u
  left join profiles p on p.user_id = u.id
  where u.id = auth.uid()
$$;

grant execute on function my_profile() to authenticated, anon;
