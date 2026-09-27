-- Seed data for local development and for the SQL test suite.
-- Six admitted users in Ramallah and Amman, plus one rejected applicant.

begin;

-- Supabase owns auth.users; locally we create the rows we need.
insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222'),
  ('33333333-3333-3333-3333-333333333333'),
  ('44444444-4444-4444-4444-444444444444'),
  ('55555555-5555-5555-5555-555555555555'),
  ('66666666-6666-6666-6666-666666666666'),
  ('99999999-9999-9999-9999-999999999999')
on conflict do nothing;

insert into users (id, phone_e164, gender, date_of_birth, country_code, city, status, tier, admitted_at, last_active_at) values
  ('11111111-1111-1111-1111-111111111111','+970599000001','female','1998-03-12','PS','Ramallah','admitted','bronze', now(), now()),
  ('22222222-2222-2222-2222-222222222222','+970599000002','male',  '1994-07-02','PS','Ramallah','admitted','gold',   now(), now()),
  ('33333333-3333-3333-3333-333333333333','+970599000003','male',  '1990-01-20','PS','Ramallah','admitted','bronze', now(), now() - interval '20 days'),
  ('44444444-4444-4444-4444-444444444444','+962791000004','female','2000-11-05','JO','Amman',   'admitted','bronze', now(), now()),
  ('55555555-5555-5555-5555-555555555555','+962791000005','male',  '1988-05-30','JO','Amman',   'admitted','gold',   now(), now()),
  ('66666666-6666-6666-6666-666666666666','+970599000006','male',  '1996-09-09','PS','Nablus',  'admitted','bronze', now(), now()),
  ('99999999-9999-9999-9999-999999999999','+15550009999','male',   '1979-01-20','US','Houston', 'rejected','bronze', null,  now());

insert into profiles (user_id, display_name, bio, marital_status, children_count, practice_level, timeline, willing_to_relocate, family_aware, wali_required) values
  ('11111111-1111-1111-1111-111111111111','Amira','خريجة صيدلة من بيرزيت، عيلتي عارفة إني مسجلة هون.','never_married',0,'practicing','within_1_year',false,true,true),
  ('22222222-2222-2222-2222-222222222222','Yousef','Civil engineer in Ramallah, family knows I am looking.','never_married',0,'practicing','within_1_year',true,true,false),
  ('33333333-3333-3333-3333-333333333333','Khaled','Teacher. Divorced, one child living with me.','divorced',1,'moderately_practicing','when_right_person',false,true,false),
  ('44444444-4444-4444-4444-444444444444','Lina','Software developer in Amman.','never_married',0,'moderately_practicing','within_2_years',true,false,false),
  ('55555555-5555-5555-5555-555555555555','Samer','Pharmacist, widowed, no children.','widowed',0,'practicing','within_6_months',false,true,false),
  ('66666666-6666-6666-6666-666666666666','Tareq','Accountant in Nablus.','never_married',0,'practicing','within_1_year',true,true,false),
  ('99999999-9999-9999-9999-999999999999','David A.','Widowed engineer on an oil rig.','widowed',0,'cultural','within_6_months',true,false,false);

insert into match_preferences (user_id, age_min, age_max, countries, accepts_divorced, accepts_widowed, accepts_children, practice_levels) values
  ('11111111-1111-1111-1111-111111111111', 26, 36, '{PS}',    false, true,  false, '{practicing}'),
  ('22222222-2222-2222-2222-222222222222', 22, 32, '{PS,JO}', true,  true,  true,  '{}'),
  ('33333333-3333-3333-3333-333333333333', 25, 40, '{PS}',    true,  true,  true,  '{}'),
  ('44444444-4444-4444-4444-444444444444', 26, 40, '{JO,PS}', true,  true,  true,  '{}'),
  ('55555555-5555-5555-5555-555555555555', 24, 34, '{JO}',    true,  true,  true,  '{}'),
  ('66666666-6666-6666-6666-666666666666', 22, 32, '{PS}',    true,  true,  true,  '{practicing}'),
  ('99999999-9999-9999-9999-999999999999', 18, 45, '{}',      true,  true,  true,  '{}');

insert into trust_scores (user_id, identity_confidence, intent_confidence, band) values
  ('11111111-1111-1111-1111-111111111111', 98, 91, 'auto_admit'),
  ('22222222-2222-2222-2222-222222222222',100, 91, 'auto_admit'),
  ('33333333-3333-3333-3333-333333333333', 78, 70, 'review'),
  ('44444444-4444-4444-4444-444444444444', 92, 84, 'auto_admit'),
  ('55555555-5555-5555-5555-555555555555', 96, 88, 'auto_admit'),
  ('66666666-6666-6666-6666-666666666666', 88, 79, 'auto_admit'),
  ('99999999-9999-9999-9999-999999999999',  0,  0, 'auto_reject');

-- A few shared answers so compatibility_score has something to work with.
insert into compatibility_answers (user_id, question_key, answer) values
  ('11111111-1111-1111-1111-111111111111','live_after_marriage','own_home'),
  ('11111111-1111-1111-1111-111111111111','wife_works','yes'),
  ('11111111-1111-1111-1111-111111111111','children_timing','within_2_years'),
  ('22222222-2222-2222-2222-222222222222','live_after_marriage','own_home'),
  ('22222222-2222-2222-2222-222222222222','wife_works','yes'),
  ('22222222-2222-2222-2222-222222222222','children_timing','within_2_years'),
  ('66666666-6666-6666-6666-666666666666','live_after_marriage','with_family'),
  ('66666666-6666-6666-6666-666666666666','wife_works','no'),
  ('66666666-6666-6666-6666-666666666666','children_timing','immediately');

-- Amira's father is her wali, at the notified level.
insert into guardians (user_id, full_name, relation, phone_e164, level, accepted_at) values
  ('11111111-1111-1111-1111-111111111111','Abu Amira','father','+970599000111','notified', now());

commit;
