-- ---------------------------------------------------------------------
-- The refusals a person can actually reach, in the language of the app.
--
-- The client shows what the server said, verbatim, because that is how
-- the 18+ refusal reaches an applicant already written for them rather
-- than reworded by a screen. The cost is that every English `raise
-- exception` a person can reach arrives as an English toast in an Arabic
-- app — which is what "you cannot decide your own application" looked
-- like on a phone.
--
-- Only the reachable ones are translated. The others are programmer
-- errors — a client sending an action that maps to no status, a path
-- claiming someone else's prefix — and English is the right language for
-- a message whose only reader is whoever is debugging it.
-- ---------------------------------------------------------------------

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
    raise exception 'not an admin';   -- the screen catches this one by name
  end if;

  if target = auth.uid() then
    raise exception 'لا يبتّ المراجع في طلبه';
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

  perform set_config('nasib.reviewing', 'on', true);

  update users
     set status      = next_status,
         admitted_at = case when next_status = 'admitted'
                            then coalesce(admitted_at, now()) else admitted_at end
   where id = target;

  if not found then
    raise exception 'لا يوجد طلب بهذا المعرّف';
  end if;

  insert into admin_decisions (admin_id, subject_user_id, action, reason_code, notes)
  values (auth.uid(), target, action, reason_code, notes);

  return jsonb_build_object('user_id', target, 'status', next_status);
end;
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
    -- Reachable two ways: a second tab already deleted it, or someone
    -- passed a photo id that is not theirs. Both get the same sentence;
    -- "that is not your photo" would confirm the photo exists.
    raise exception 'لم نعثر على هذه الصورة';
  end if;

  return jsonb_build_object('deleted', photo_id, 'storage_path', gone);
end;
$$;
