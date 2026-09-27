-- ---------------------------------------------------------------------
-- Applying from the web.
--
-- The client cannot write to `users` and should not be able to. Its
-- privileged columns — status, tier, phone, date of birth — are guarded
-- by a trigger precisely so that a patched client cannot admit itself or
-- age itself into eligibility. So the application arrives through one
-- function, which is the only thing allowed to create those rows.
--
-- Three things this deliberately does NOT do:
--
--   * It does not set `status`. Every application starts as `applying`
--     and only the review desk moves it. A function that could return an
--     admitted user is a function worth attacking.
--   * It does not trust a caller-supplied user id. The id is
--     `auth.uid()`, always. Passing someone else's is not an error case
--     to handle, it is a case that cannot be expressed.
--   * It does not skip the 18+ check. The constraint lives on the table
--     and this runs into it like anything else; there is no path around
--     it, which is the point of putting it there.
-- ---------------------------------------------------------------------

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

  -- Parsed before anything is written, so a malformed date fails the
  -- application rather than half-creating a user.
  begin
    dob := (application ->> 'date_of_birth')::date;
  exception when others then
    raise exception 'date_of_birth must be a date (YYYY-MM-DD)';
  end;

  if dob is null then
    raise exception 'date_of_birth is required';
  end if;

  -- The adult check is on the table, and this is here only so the
  -- applicant gets a sentence they can act on instead of a constraint
  -- name. Removing it changes the message, not the rule.
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
    -- Re-applying edits the application in place, but three columns are
    -- deliberately absent from this list.
    --
    -- `status` and `tier`: an applicant editing their city must not be
    -- able to walk themselves back to `applying` after a rejection.
    --
    -- `date_of_birth`: the age you applied with is the age you applied
    -- with. Changing it is what an under-age applicant does after being
    -- turned away, so it is a review-desk correction, not a self-service
    -- edit — and the guard trigger on this table would refuse it anyway,
    -- which would surface as a constraint message rather than a decision.
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

comment on function apply_for_membership is
  'Creates or edits the caller''s application. The user id is auth.uid(); status is never settable by the client.';


-- What the applicant is allowed to know about themselves: their own
-- status and what they submitted. Never a score, never the check names,
-- never the reviewer's notes.
create or replace function my_application()
  returns jsonb
  language sql
  security definer
  set search_path = public
  stable
as $$
  select jsonb_build_object(
    'user_id',      u.id,
    'status',       u.status,
    'tier',         u.tier,
    'applied_at',   u.applied_at,
    'display_name', p.display_name,
    'city',         u.city,
    'bio',          p.bio,
    'timeline',     p.timeline,
    'family_aware', p.family_aware
  )
  from users u
  left join profiles p on p.user_id = u.id
  where u.id = auth.uid()
$$;

comment on function my_application is
  'The caller''s own application, as the applicant may see it. No score, no check names, no reviewer notes.';


-- Anonymous sign-in gives each browser a real auth.uid(), which is what
-- makes row-level security work on the web at all: without one, every
-- visitor is the same nobody and every policy is meaningless.
grant execute on function apply_for_membership(jsonb) to authenticated, anon;
grant execute on function my_application() to authenticated, anon;

-- The phone column is nullable from the web, where nothing has verified
-- it yet. It is still unique: two accounts claiming one number is the
-- oldest duplicate-account trick there is, and the constraint costs
-- nothing here.
alter table users alter column phone_e164 drop not null;

-- The chat composer warns before sending, using a JavaScript port of the
-- rules in 0008. A port can drift from what the trigger actually does,
-- and the failure mode is the worst kind: the app tells someone their
-- message is fine and the database then alters it. So the web client can
-- ask the database itself what it would remove.
--
-- Safe to expose: the function is immutable, reads no table, and is given
-- only text the caller already has.
grant execute on function redact_personal_details(text) to authenticated, anon;
