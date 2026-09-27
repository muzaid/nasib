-- ---------------------------------------------------------------------
-- "not signed in", said to someone who is signed in.
--
-- browse_members read the caller's `users` row and raised 'not signed in'
-- when there wasn't one. But a visitor with a valid anonymous session and
-- no application has exactly that shape: signed in, no row. The screen
-- showed an error toast telling them to do the one thing they had already
-- done.
--
-- The two cases are now separated. No session at all is still an error —
-- nothing can be decided without an identity. No application yet is a
-- gate, which is what the directory screen already knows how to show.
-- ---------------------------------------------------------------------

create or replace function browse_members(limit_to int default 30)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  me users;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  select * into me from users where id = auth.uid();

  -- Signed in, but has not applied. `none` is not an account_status — no
  -- account exists — so it is a string the screen maps to its own
  -- sentence, rather than a status value invented to fill the hole.
  if me.id is null then
    return jsonb_build_object('gated', true, 'status', 'none', 'rows', '[]'::jsonb);
  end if;

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
