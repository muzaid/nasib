-- ---------------------------------------------------------------------
-- The web application path: apply_for_membership / my_application.
--
-- What is worth asserting here is not that the happy path works — it is
-- that the ways a client could cheat are closed: setting your own status,
-- applying as somebody else, aging yourself into eligibility, and reading
-- someone else's application.
-- ---------------------------------------------------------------------

\set ON_ERROR_STOP on
\echo == web signup ==

-- Two applicants who do not exist yet. auth.users is the FK target, so
-- they have to exist there first — in the hosted project that row is
-- created by the anonymous sign-in, not by us.
-- With emails: an application has to belong to an account its owner can
-- sign back into, so these are accounts, not anonymous sessions.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'sara@example.com'),
  ('b0000000-0000-0000-0000-00000000000b', 'omar@example.com')
on conflict (id) do update set email = excluded.email;

-- ── a complete application ────────────────────────────────────────────
select act_as('a0000000-0000-0000-0000-00000000000a');

select assert(
  (apply_for_membership(jsonb_build_object(
    'phone',               '+970599111222',
    'gender',              'female',
    'date_of_birth',       '1996-04-11',
    'country_code',        'PS',
    'city',                'رام الله',
    'display_name',        'سارة',
    'marital_status',      'never_married',
    'practice_level',      'practicing',
    'timeline',            'within_1_year',
    'willing_to_relocate', true,
    'family_aware',        true,
    'bio',                 'أدرس الصيدلة وأعمل في مختبر.'
  )) ->> 'status') = 'applying',
  'a new application starts as applying');

select assert(
  (my_application() ->> 'display_name') = 'سارة',
  'my_application returns what was submitted');

select assert(
  (my_application() ->> 'city') = 'رام الله',
  'Arabic city survives the round trip');

select assert(
  (my_application() ->> 'tier') = 'bronze',
  'tier is the table default, not something the client chose');

select assert(
  (select count(*) from profiles
    where user_id = 'a0000000-0000-0000-0000-00000000000a'
      and timeline = 'within_1_year' and willing_to_relocate) = 1,
  'the profile row is created alongside the user row');

-- ── the client cannot admit itself ────────────────────────────────────
select assert(
  (apply_for_membership(jsonb_build_object(
    'status',        'admitted',
    'tier',          'trusted',
    'gender',        'female',
    'date_of_birth', '1996-04-11',
    'display_name',  'سارة'
  )) ->> 'status') = 'applying',
  'a status in the payload is ignored, not honoured');

select assert(
  (my_application() ->> 'tier') = 'bronze',
  'a tier in the payload is ignored too');

-- ── re-applying edits, and does not resurrect a decision ──────────────
-- The review desk rejects her. This is a service-role write: the guard
-- trigger refuses it from a client, which is a rule the redaction suite
-- already asserts and this suite relies on rather than re-testing.
select set_config('request.jwt.claim.role', 'service_role', false);
update users set status = 'rejected'
  where id = 'a0000000-0000-0000-0000-00000000000a';
select set_config('request.jwt.claim.role', 'authenticated', false);

select apply_for_membership(jsonb_build_object(
  'gender', 'female', 'date_of_birth', '1996-04-11',
  'city', 'نابلس', 'display_name', 'سارة'));

select assert(
  (my_application() ->> 'status') = 'rejected',
  'editing the application does not reset a rejection');

select assert(
  (my_application() ->> 'city') = 'نابلس',
  'but the edit itself is saved');

select set_config('request.jwt.claim.role', 'service_role', false);
update users set status = 'applying'
  where id = 'a0000000-0000-0000-0000-00000000000a';
select set_config('request.jwt.claim.role', 'authenticated', false);

-- ── age ───────────────────────────────────────────────────────────────
select act_as('b0000000-0000-0000-0000-00000000000b');

do $$
declare failed boolean := false;
begin
  begin
    perform apply_for_membership(jsonb_build_object(
      'gender', 'male',
      'date_of_birth', (current_date - interval '16 years')::text,
      'display_name', 'قاصر'));
  exception when others then failed := true;
  end;
  perform assert(failed, 'a 16-year-old cannot apply');
end $$;

select assert(
  (select count(*) from users where id = 'b0000000-0000-0000-0000-00000000000b') = 0,
  'and nothing was half-written when the application failed');

do $$
declare failed boolean := false;
begin
  begin
    perform apply_for_membership(jsonb_build_object(
      'gender', 'male', 'date_of_birth', 'yesterday-ish',
      'display_name', 'سوء إدخال'));
  exception when others then failed := true;
  end;
  perform assert(failed, 'a malformed date is refused rather than coerced');
end $$;

-- The 18th birthday itself. Off-by-one here is a real person turned away
-- on the day they became eligible.
select assert(
  (apply_for_membership(jsonb_build_object(
    'gender', 'male',
    'date_of_birth', (current_date - interval '18 years')::text,
    'display_name', 'في عيد ميلاده'
  )) ->> 'status') = 'applying',
  'exactly eighteen today is eligible');

-- ── one application per caller, and only your own ─────────────────────
select assert(
  (my_application() ->> 'display_name') = 'في عيد ميلاده',
  'each caller sees their own application');

select act_as('a0000000-0000-0000-0000-00000000000a');
select assert(
  (my_application() ->> 'display_name') = 'سارة',
  'and not the other one''s');

select assert(
  (select count(*) from users
    where id in ('a0000000-0000-0000-0000-00000000000a',
                 'b0000000-0000-0000-0000-00000000000b')) = 2,
  'two callers produced exactly two users, not four');

-- ── what the applicant is not told ────────────────────────────────────
select assert(
  not (my_application() ? 'identity_confidence')
  and not (my_application() ? 'intent_confidence')
  and not (my_application() ? 'checks'),
  'no score and no check names reach the applicant');

-- ── signed out ────────────────────────────────────────────────────────
select set_config('request.jwt.claim.sub', '', false);

do $$
declare failed boolean := false;
begin
  begin
    perform apply_for_membership(jsonb_build_object(
      'gender', 'male', 'date_of_birth', '1990-01-01', 'display_name', 'مجهول'));
  exception when others then failed := true;
  end;
  perform assert(failed, 'applying without a session is refused');
end $$;

select assert(my_application() is null,
  'and reads nothing back');

\echo == web signup: done ==
