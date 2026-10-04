-- =====================================================================
-- Nasib — core schema
-- Gated-entry marriage platform. Identity, verification evidence and
-- matching are deliberately separable so biometric data can be isolated
-- and purged without touching the social graph.
-- =====================================================================

create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- Biometric data lives in its own schema, with its own grants.
create schema if not exists biometric;

-- ---------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------

do $ddl$ begin
  create type account_status as enum (
    'applying',        -- still filling in the application
    'pending_review',  -- submitted, agent or human deciding
    'admitted',
    'rejected',
    'shadow_limited',  -- visible but receives no new candidates
    'suspended',
    'banned',
    'paused',          -- user-initiated (e.g. engaged)
    'closed'
  );
exception when duplicate_object then null; end $ddl$;

do $ddl$ begin
  create type gender_t            as enum ('male','female');
exception when duplicate_object then null; end $ddl$;
do $ddl$ begin
  create type marital_status_t    as enum ('never_married','divorced','widowed');
exception when duplicate_object then null; end $ddl$;
do $ddl$ begin
  create type practice_level_t    as enum ('practicing','moderately_practicing','cultural','prefer_not_to_say');
exception when duplicate_object then null; end $ddl$;
do $ddl$ begin
  create type timeline_t          as enum ('within_6_months','within_1_year','within_2_years','when_right_person');
exception when duplicate_object then null; end $ddl$;
do $ddl$ begin
  create type wali_level_t        as enum ('off','notified','chaperoned','gated');
exception when duplicate_object then null; end $ddl$;
do $ddl$ begin
  create type photo_visibility_t  as enum ('hidden','blurred','on_match','visible_to_verified');
exception when duplicate_object then null; end $ddl$;
do $ddl$ begin
  create type tier_t              as enum ('bronze','gold','family');
exception when duplicate_object then null; end $ddl$;

do $ddl$ begin
  create type verification_type_t as enum (
    'phone','device','liveness','face_match','duplicate_face',
    'reverse_image','document','consistency','intent','scam_pattern','behavioural'
  );
exception when duplicate_object then null; end $ddl$;
do $ddl$ begin
  create type verification_result_t as enum ('pass','fail','inconclusive','skipped','error');
exception when duplicate_object then null; end $ddl$;

do $ddl$ begin
  create type decision_band_t as enum ('auto_admit','review','auto_reject');
exception when duplicate_object then null; end $ddl$;

do $ddl$ begin
  create type admin_action_t as enum (
    'admit','admit_with_note','request_evidence','reject',
    'shadow_limit','lift_limit','ban_device','ban_face','ban_account','unban'
  );
exception when duplicate_object then null; end $ddl$;

do $ddl$ begin
  create type report_reason_t as enum (
    'fake_profile','already_married','asked_for_money','harassment',
    'inappropriate_content','not_serious','underage','other'
  );
exception when duplicate_object then null; end $ddl$;

do $ddl$ begin
  create type match_state_t   as enum ('pending','active','unmatched','blocked','progressed');
exception when duplicate_object then null; end $ddl$;
do $ddl$ begin
  create type outcome_kind_t  as enum ('married','engaged','ended','not_compatible','left_platform');
exception when duplicate_object then null; end $ddl$;
do $ddl$ begin
  create type slate_decision_t as enum ('pending','interested','declined','expired');
exception when duplicate_object then null; end $ddl$;

-- ---------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------

create table if not exists users (
  id              uuid primary key references auth.users(id) on delete cascade,
  phone_e164      text not null unique,
  gender          gender_t not null,
  date_of_birth   date not null,
  country_code    text not null,
  city            text,
  locale          text not null default 'ar',
  status          account_status not null default 'applying',
  tier            tier_t not null default 'bronze',
  applied_at      timestamptz,
  admitted_at     timestamptz,
  last_active_at  timestamptz,
  created_at      timestamptz not null default now(),
  -- 18+ is enforced in the database, not only in the client.
  constraint users_adult_only check (date_of_birth <= (current_date - interval '18 years'))
);

create index if not exists users_status_idx      on users(status);
create index if not exists users_discovery_idx   on users(status, gender, country_code, city);

-- ---------------------------------------------------------------------
-- Profile and declared intent
-- ---------------------------------------------------------------------

create table if not exists profiles (
  user_id            uuid primary key references users(id) on delete cascade,
  display_name       text not null,
  bio                text,
  bio_language       text,                       -- detected: ar, ar-lev, arabizi, en, ...
  education          text,
  occupation         text,
  marital_status     marital_status_t not null,
  children_count     int not null default 0,
  children_living_with_user boolean not null default false,
  practice_level     practice_level_t not null,
  covers_hijab       boolean,                    -- women; null = not stated
  keeps_beard        boolean,                    -- men; null = not stated
  madhhab            text,
  family_origin      text,                       -- e.g. "Al-Khalil", optional
  languages          text[] not null default '{}',
  height_cm          int,
  smokes             boolean,

  -- Marriage-readiness — these are the fields people actually filter on.
  timeline           timeline_t not null,
  willing_to_relocate boolean not null,
  relocate_to        text[],
  family_aware       boolean not null default false,
  wali_required      boolean not null default false,
  living_after_marriage text,                    -- 'own_home' | 'with_family' | 'undecided'

  photo_visibility   photo_visibility_t not null default 'on_match',
  discoverable       boolean not null default true,
  updated_at         timestamptz not null default now(),
  created_at         timestamptz not null default now()
);

-- Hard filters the matcher must never override.
create table if not exists match_preferences (
  user_id             uuid primary key references users(id) on delete cascade,
  age_min             int not null,
  age_max             int not null,
  countries           text[] not null default '{}',
  cities              text[] not null default '{}',
  accepts_divorced    boolean not null default true,
  accepts_widowed     boolean not null default true,
  accepts_children    boolean not null default true,
  practice_levels     practice_level_t[] not null default '{}',
  timelines           timeline_t[] not null default '{}',
  requires_verified_document boolean not null default false,
  constraint sane_age_range check (age_min >= 18 and age_max >= age_min)
);

create table if not exists compatibility_answers (
  user_id       uuid not null references users(id) on delete cascade,
  question_key  text not null,
  answer        text not null,
  answered_at   timestamptz not null default now(),
  primary key (user_id, question_key)
);

create table if not exists photos (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  storage_path  text not null,
  ordinal       int  not null default 0,
  is_primary    boolean not null default false,
  face_detected boolean,
  decency_score real,                            -- 0..1, higher = more likely to need review
  approved      boolean not null default false,
  created_at    timestamptz not null default now()
);

create index if not exists photos_user_idx on photos(user_id, ordinal);

-- ---------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------

-- One row per check run. Never updated, never overwritten: when a
-- threshold changes you must still be able to see which rules a past
-- decision was made under.
create table if not exists verifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  run_id        uuid not null,                   -- groups the checks of one pipeline run
  type          verification_type_t not null,
  vendor        text,
  result        verification_result_t not null,
  score         real,                            -- vendor-native, 0..1 where meaningful
  agent_version text not null,
  details       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists verifications_user_idx on verifications(user_id, created_at desc);
create index if not exists verifications_run_idx  on verifications(run_id);

-- Vendor payloads and document images. `delete_after` is a column the
-- system acts on, not a policy in a document — see purge_expired_evidence().
create table if not exists verification_evidence (
  id              uuid primary key default gen_random_uuid(),
  verification_id uuid not null references verifications(id) on delete cascade,
  kind            text not null,                 -- 'document_image' | 'liveness_frame' | 'vendor_payload'
  storage_path    text,
  payload         jsonb,
  delete_after    timestamptz not null,
  created_at      timestamptz not null default now()
);

create index if not exists evidence_expiry_idx on verification_evidence(delete_after);

-- Identity and intent are held separately and never blended into one number.
create table if not exists trust_scores (
  user_id             uuid primary key references users(id) on delete cascade,
  identity_confidence int not null default 0 check (identity_confidence between 0 and 100),
  intent_confidence   int not null default 0 check (intent_confidence   between 0 and 100),
  band                decision_band_t not null default 'review',
  agent_version       text,
  computed_at         timestamptz not null default now()
);

create table if not exists trust_score_history (
  id                  bigserial primary key,
  user_id             uuid not null references users(id) on delete cascade,
  identity_confidence int not null,
  intent_confidence   int not null,
  band                decision_band_t not null,
  reason              text,
  created_at          timestamptz not null default now()
);

create table if not exists devices (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references users(id) on delete cascade,
  fingerprint      text not null,
  platform         text not null,
  integrity_verdict text,                        -- Play Integrity / App Attest result
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  unique (user_id, fingerprint)
);

create index if not exists devices_fingerprint_idx on devices(fingerprint);

create table if not exists banned_devices (
  fingerprint text primary key,
  reason      text,
  banned_at   timestamptz not null default now()
);

create table if not exists banned_phones (
  phone_e164 text primary key,
  reason     text,
  banned_at  timestamptz not null default now()
);

-- --- biometric schema: isolated, separately encrypted, no readable FKs ---

create table if not exists biometric.face_embeddings (
  user_id    uuid primary key,
  embedding  vector(512) not null,
  model      text not null,
  created_at timestamptz not null default now()
);

create index if not exists face_embeddings_ann_idx
  on biometric.face_embeddings using hnsw (embedding vector_cosine_ops);

-- Vectors from removed accounts, with no identity attached. This is what
-- stops a banned user returning with a new phone number.
create table if not exists biometric.banned_embeddings (
  id         uuid primary key default gen_random_uuid(),
  embedding  vector(512) not null,
  model      text not null,
  reason_code text,
  banned_at  timestamptz not null default now()
);

create index if not exists banned_embeddings_ann_idx
  on biometric.banned_embeddings using hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------
-- Wali / guardian
-- ---------------------------------------------------------------------

create table if not exists guardians (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  guardian_user_id  uuid references users(id) on delete set null,
  full_name         text not null,
  relation          text not null,               -- father, brother, mother, uncle, ...
  phone_e164        text not null,
  level             wali_level_t not null default 'notified',
  invited_at        timestamptz not null default now(),
  accepted_at       timestamptz,
  revoked_at        timestamptz
);

create index if not exists guardians_user_idx on guardians(user_id) where revoked_at is null;

-- ---------------------------------------------------------------------
-- Discovery and matching
-- ---------------------------------------------------------------------

-- The daily slate is materialised, not computed on request: it enforces
-- the daily limit honestly and records what each user was actually shown.
create table if not exists candidate_slates (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  slate_date  date not null,
  generated_at timestamptz not null default now(),
  unique (user_id, slate_date)
);

create table if not exists candidate_items (
  slate_id          uuid not null references candidate_slates(id) on delete cascade,
  candidate_user_id uuid not null references users(id) on delete cascade,
  rank              int not null,
  score             real,
  decision          slate_decision_t not null default 'pending',
  decided_at        timestamptz,
  note              text,
  primary key (slate_id, candidate_user_id)
);

create table if not exists matches (
  id                uuid primary key default gen_random_uuid(),
  user_a            uuid not null references users(id) on delete cascade,
  user_b            uuid not null references users(id) on delete cascade,
  state             match_state_t not null default 'pending',
  video_call_at     timestamptz,
  contact_unlocked  boolean not null default false,
  wali_present      boolean not null default false,
  created_at        timestamptz not null default now(),
  ended_at          timestamptz,
  constraint ordered_pair check (user_a < user_b),
  unique (user_a, user_b)
);

create index if not exists matches_user_a_idx on matches(user_a, state);
create index if not exists matches_user_b_idx on matches(user_b, state);

create table if not exists messages (
  id          uuid primary key default gen_random_uuid(),
  match_id    uuid not null references matches(id) on delete cascade,
  sender_id   uuid not null references users(id) on delete cascade,
  body        text not null,
  redacted    boolean not null default false,     -- contact details stripped pre-video-call
  flags       jsonb not null default '{}'::jsonb, -- classifier output
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists messages_match_idx on messages(match_id, created_at desc);

create table if not exists outcomes (
  id          uuid primary key default gen_random_uuid(),
  match_id    uuid references matches(id) on delete set null,
  user_id     uuid not null references users(id) on delete cascade,
  kind        outcome_kind_t not null,
  note        text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Safety and moderation
-- ---------------------------------------------------------------------

create table if not exists reports (
  id            uuid primary key default gen_random_uuid(),
  reporter_id   uuid not null references users(id) on delete set null,
  reported_id   uuid not null references users(id) on delete cascade,
  match_id      uuid references matches(id) on delete set null,
  reason        report_reason_t not null,
  detail        text,
  status        text not null default 'open',    -- open | actioned | dismissed
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz
);

create index if not exists reports_open_idx on reports(status, created_at) where status = 'open';

create table if not exists blocks (
  blocker_id  uuid not null references users(id) on delete cascade,
  blocked_id  uuid not null references users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

create table if not exists admin_users (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null unique,
  full_name   text not null,
  role        text not null default 'reviewer',  -- reviewer | lead | admin
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Append-only. Audit trail, dispute defence, and the labelled dataset
-- used to tune the agent's thresholds.
create table if not exists admin_decisions (
  id                     uuid primary key default gen_random_uuid(),
  admin_id               uuid not null references admin_users(id),
  subject_user_id        uuid not null references users(id) on delete cascade,
  action                 admin_action_t not null,
  reason_code            text not null,
  notes                  text,
  agent_identity_score   int,
  agent_intent_score     int,
  agent_recommendation   decision_band_t,
  run_id                 uuid,
  created_at             timestamptz not null default now()
);

create index if not exists admin_decisions_subject_idx on admin_decisions(subject_user_id, created_at desc);

create table if not exists appeals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  message     text not null,
  status      text not null default 'open',
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

-- Every profile a reviewer opens is logged. An insider abusing the
-- console is a more likely breach than an external attacker.
create table if not exists admin_access_log (
  id          bigserial primary key,
  admin_id    uuid not null references admin_users(id),
  subject_user_id uuid,
  route       text not null,
  in_queue    boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists subscriptions (
  user_id     uuid primary key references users(id) on delete cascade,
  tier        tier_t not null,
  provider    text not null,                     -- apple | google
  expires_at  timestamptz,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Retention enforcement
-- ---------------------------------------------------------------------

create or replace function purge_expired_evidence() returns int
language plpgsql security definer as $$
declare removed int;
begin
  with gone as (
    delete from verification_evidence
    where delete_after < now()
    returning 1
  )
  select count(*) into removed from gone;
  return removed;
end;
$$;

comment on function purge_expired_evidence is
  'Run hourly. ID images are deleted 7 days after decision, liveness frames after 30.';

-- Messages are kept 90 days past an unmatch, for abuse investigation only.
create or replace function purge_stale_messages() returns int
language plpgsql security definer as $$
declare removed int;
begin
  with gone as (
    delete from messages m
    using matches mt
    where m.match_id = mt.id
      and mt.state in ('unmatched','blocked')
      and mt.ended_at < now() - interval '90 days'
    returning 1
  )
  select count(*) into removed from gone;
  return removed;
end;
$$;
