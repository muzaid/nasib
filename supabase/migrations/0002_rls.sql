-- =====================================================================
-- Row level security.
--
-- The Flutter client talks to Postgres directly, so RLS *is* the
-- authorisation layer, not a second line of defence. Policies are written
-- before feature work and tested adversarially.
--
-- Rules enforced here:
--   * A user reads their own rows, always.
--   * A user sees another profile only if both are admitted, neither has
--     blocked the other, and that profile was placed on their slate or
--     they are matched.
--   * Nobody but the service role touches verification, biometric or
--     admin tables.
-- =====================================================================

alter table users                 enable row level security;
alter table profiles              enable row level security;
alter table match_preferences     enable row level security;
alter table compatibility_answers enable row level security;
alter table photos                enable row level security;
alter table verifications         enable row level security;
alter table verification_evidence enable row level security;
alter table trust_scores          enable row level security;
alter table trust_score_history   enable row level security;
alter table devices               enable row level security;
alter table guardians             enable row level security;
alter table candidate_slates      enable row level security;
alter table candidate_items       enable row level security;
alter table matches               enable row level security;
alter table messages              enable row level security;
alter table reports               enable row level security;
alter table blocks                enable row level security;
alter table outcomes              enable row level security;
alter table subscriptions         enable row level security;
alter table appeals               enable row level security;
alter table admin_users           enable row level security;
alter table admin_decisions       enable row level security;
alter table admin_access_log      enable row level security;

alter table biometric.face_embeddings   enable row level security;
alter table biometric.banned_embeddings enable row level security;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------

create or replace function is_admitted(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from users where id = uid and status = 'admitted');
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admin_users where id = auth.uid() and active);
$$;

create or replace function blocked_between(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from blocks
    where (blocker_id = a and blocked_id = b)
       or (blocker_id = b and blocked_id = a)
  );
$$;

-- True when `viewer` may see `subject`: both admitted, not blocked, and
-- either matched or the subject is on the viewer's slate today.
create or replace function can_view_profile(viewer uuid, subject uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select
    viewer = subject
    or (
      is_admitted(viewer)
      and is_admitted(subject)
      and not blocked_between(viewer, subject)
      and (
        exists (
          select 1 from matches m
          where m.state in ('pending','active','progressed')
            and ((m.user_a = viewer and m.user_b = subject)
              or (m.user_b = viewer and m.user_a = subject))
        )
        or exists (
          select 1
          from candidate_slates s
          join candidate_items i on i.slate_id = s.id
          where s.user_id = viewer
            and i.candidate_user_id = subject
        )
      )
    );
$$;

-- ---------------------------------------------------------------------
-- Own-row access
-- ---------------------------------------------------------------------

create policy users_self_read   on users       for select using (auth.uid() = id or is_admin());
create policy users_self_update on users       for update using (auth.uid() = id)
  with check (auth.uid() = id);

-- Note: `status` and `tier` are deliberately NOT client-writable. A
-- trigger below rejects any attempt to change them outside the service role.
create or replace function guard_privileged_user_columns() returns trigger
language plpgsql as $$
begin
  if auth.role() <> 'service_role' then
    if new.status <> old.status or new.tier <> old.tier
       or new.phone_e164 <> old.phone_e164
       or new.date_of_birth <> old.date_of_birth then
      raise exception 'privileged column is not client-writable';
    end if;
  end if;
  return new;
end;
$$;

create trigger users_guard_privileged
  before update on users
  for each row execute function guard_privileged_user_columns();

create policy profiles_read on profiles for select
  using (can_view_profile(auth.uid(), user_id) or is_admin());
create policy profiles_write on profiles for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy prefs_own on match_preferences for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy answers_read on compatibility_answers for select
  using (can_view_profile(auth.uid(), user_id) or is_admin());
create policy answers_write on compatibility_answers for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Photo rows are readable when the profile is; the storage bucket is
-- private and served only through short-lived signed URLs, so row access
-- alone reveals nothing.
create policy photos_read on photos for select
  using (can_view_profile(auth.uid(), user_id) or is_admin());
create policy photos_write on photos for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- Verification: readable by the owner in summary form, writable by nobody
-- ---------------------------------------------------------------------

create policy verifications_own_read on verifications for select
  using (auth.uid() = user_id or is_admin());

-- No client policy on verification_evidence at all: service role only.
-- Same for biometric tables — a leak of the vector store must reveal
-- nothing on its own, and nothing in the app ever needs to read it.

create policy trust_scores_admin_read on trust_scores for select using (is_admin());
create policy trust_history_admin_read on trust_score_history for select using (is_admin());

create policy devices_own on devices for select using (auth.uid() = user_id or is_admin());

-- ---------------------------------------------------------------------
-- Guardians
-- ---------------------------------------------------------------------

create policy guardians_own on guardians for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy guardians_as_guardian_read on guardians for select
  using (auth.uid() = guardian_user_id);

-- ---------------------------------------------------------------------
-- Discovery
-- ---------------------------------------------------------------------

create policy slates_own on candidate_slates for select using (auth.uid() = user_id);
create policy slate_items_own_read on candidate_items for select
  using (exists (select 1 from candidate_slates s
                 where s.id = slate_id and s.user_id = auth.uid()));
create policy slate_items_own_decide on candidate_items for update
  using (exists (select 1 from candidate_slates s
                 where s.id = slate_id and s.user_id = auth.uid()))
  with check (exists (select 1 from candidate_slates s
                      where s.id = slate_id and s.user_id = auth.uid()));

create policy matches_participant on matches for select
  using (auth.uid() in (user_a, user_b) or is_admin());
create policy matches_participant_update on matches for update
  using (auth.uid() in (user_a, user_b))
  with check (auth.uid() in (user_a, user_b));

create policy messages_participant_read on messages for select
  using (
    exists (select 1 from matches m
            where m.id = match_id
              and (auth.uid() in (m.user_a, m.user_b)))
    or exists (  -- chaperoned or gated wali reads the thread
      select 1 from matches m
      join guardians g on g.user_id in (m.user_a, m.user_b)
      where m.id = match_id
        and g.guardian_user_id = auth.uid()
        and g.revoked_at is null
        and g.level in ('chaperoned','gated')
    )
    or is_admin()
  );

create policy messages_send on messages for insert
  with check (
    auth.uid() = sender_id
    and exists (
      select 1 from matches m
      where m.id = match_id
        and m.state = 'active'
        and auth.uid() in (m.user_a, m.user_b)
    )
  );

create policy outcomes_own on outcomes for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- Safety
-- ---------------------------------------------------------------------

-- A reporter may create a report and see their own. The reported user can
-- never see that they were reported, or by whom.
create policy reports_create on reports for insert with check (auth.uid() = reporter_id);
create policy reports_own_read on reports for select
  using (auth.uid() = reporter_id or is_admin());

create policy blocks_own on blocks for all
  using (auth.uid() = blocker_id) with check (auth.uid() = blocker_id);

create policy appeals_own on appeals for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy subscriptions_own_read on subscriptions for select
  using (auth.uid() = user_id or is_admin());

-- ---------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------

create policy admin_users_self on admin_users for select using (auth.uid() = id or is_admin());
create policy admin_decisions_read on admin_decisions for select using (is_admin());
create policy admin_decisions_insert on admin_decisions for insert with check (is_admin());
create policy admin_access_log_insert on admin_access_log for insert with check (is_admin());

-- admin_decisions is append-only, including for admins.
create rule admin_decisions_no_update as on update to admin_decisions do instead nothing;
create rule admin_decisions_no_delete as on delete to admin_decisions do instead nothing;
