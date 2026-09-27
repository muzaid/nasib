-- ---------------------------------------------------------------------
-- An application has to belong to an account you can get back into.
--
-- Until now a member was an anonymous session in one browser's local
-- storage. Apply in Chrome, open the site in Safari, and the application
-- is gone — not lost in the database, but unreachable, because nothing
-- the person has proves they are the one who submitted it. Clear site
-- data and it is unreachable from that browser too.
--
-- So an application now requires an account with a credential: an email
-- (a phone, when phone sign-in exists). The check is here rather than in
-- the screen because it is the kind of rule a client cannot be trusted
-- to keep — and because an application written against an anonymous id
-- is not a smaller version of the right thing, it is an orphan the
-- review desk will spend someone's time on.
--
-- Anonymous sessions still work for everything else. Browsing before
-- applying does not need an identity anyone can return to.
-- ---------------------------------------------------------------------

-- True when the caller's account has a credential they can sign in with.
-- Checked against auth.users rather than the `is_anonymous` JWT claim so
-- it stays true for an anonymous session that has since been upgraded
-- with an email: the claim is fixed at the moment the token was issued,
-- the row is not, and a member who has just linked an email should not
-- have to sign out and back in to apply.
create or replace function has_credential()
  returns boolean
  language sql
  security definer
  set search_path = public
  stable
as $$
  select exists (
    select 1 from auth.users
     where id = auth.uid()
       and (nullif(email, '') is not null or nullif(phone, '') is not null)
  )
$$;

grant execute on function has_credential() to authenticated, anon;


create or replace function apply_for_membership(application jsonb)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  uid uuid := auth.uid();
  dob date;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  if not has_credential() then
    raise exception 'أنشئ حساباً ببريد وكلمة مرور قبل إرسال الطلب، حتى تتمكن من العودة إليه';
  end if;

  begin
    dob := (application ->> 'date_of_birth')::date;
  exception when others then
    raise exception 'date_of_birth must be a date (YYYY-MM-DD)';
  end;

  if dob is null then
    raise exception 'date_of_birth is required';
  end if;

  if dob > current_date - interval '18 years' then
    raise exception 'هذا التطبيق لمن أتمّ الثامنة عشرة';
  end if;

  insert into users (
    id, phone_e164, gender, date_of_birth, country_code, city, applied_at
  ) values (
    uid,
    nullif(trim(application ->> 'phone'), ''),
    (application ->> 'gender')::gender_t,
    dob,
    coalesce(nullif(trim(application ->> 'country_code'), ''), 'PS'),
    nullif(trim(application ->> 'city'), ''),
    now()
  )
  on conflict (id) do update set
    gender        = excluded.gender,
    country_code  = excluded.country_code,
    city          = excluded.city;

  insert into profiles (
    user_id, display_name, bio, occupation, marital_status, children_count,
    practice_level, timeline, willing_to_relocate, family_aware,
    wali_required, living_after_marriage
  ) values (
    uid,
    coalesce(nullif(trim(application ->> 'display_name'), ''), 'بدون اسم'),
    nullif(trim(application ->> 'bio'), ''),
    nullif(trim(application ->> 'occupation'), ''),
    coalesce((application ->> 'marital_status')::marital_status_t, 'never_married'),
    coalesce((application ->> 'children_count')::int, 0),
    coalesce((application ->> 'practice_level')::practice_level_t, 'prefer_not_to_say'),
    coalesce((application ->> 'timeline')::timeline_t, 'when_right_person'),
    coalesce((application ->> 'willing_to_relocate')::boolean, false),
    coalesce((application ->> 'family_aware')::boolean, false),
    coalesce((application ->> 'wali_required')::boolean, false),
    nullif(trim(application ->> 'living_after_marriage'), '')
  )
  on conflict (user_id) do update set
    display_name          = excluded.display_name,
    bio                   = excluded.bio,
    occupation            = excluded.occupation,
    marital_status        = excluded.marital_status,
    children_count        = excluded.children_count,
    practice_level        = excluded.practice_level,
    timeline              = excluded.timeline,
    willing_to_relocate   = excluded.willing_to_relocate,
    family_aware          = excluded.family_aware,
    wali_required         = excluded.wali_required,
    living_after_marriage = excluded.living_after_marriage,
    updated_at            = now();

  return my_application();
end;
$$;


-- The screens need to know, before offering the form, whether this
-- session can submit one — so the account step comes first rather than
-- after the applicant has filled in eight fields.
create or replace function whoami()
  returns jsonb
  language sql
  security definer
  set search_path = public
  stable
as $$
  select jsonb_build_object(
    'user_id',        auth.uid(),
    'is_admin',       is_admin(),
    'email',          (select nullif(email, '') from auth.users where id = auth.uid()),
    'has_credential', has_credential(),
    'is_anonymous',   not has_credential(),
    'status',         (select status from users where id = auth.uid()),
    'has_row',        exists (select 1 from users where id = auth.uid())
  )
$$;

grant execute on function whoami() to authenticated, anon;
