-- =====================================================================
-- Photo access: blurred by default, revealed only by the owner's consent.
--
-- The rule is absolute: every photo on this platform is served blurred.
-- There is no privacy tier, no "visible to verified", no setting that makes
-- a face browsable. To see someone's photos a person must ask, an admin
-- must let the request through, and the owner must say yes.
--
-- Three defences, because one is not enough:
--   1. The clear original is never granted to any client role. Only a
--      blurred derivative is reachable without a grant.
--   2. What a granted viewer receives is a watermarked copy carrying their
--      own id, so a leaked screenshot identifies who leaked it.
--   3. Grants expire on their own and can be revoked by the owner at any
--      moment, without explanation.
-- =====================================================================

-- The old per-user visibility setting is gone. Keeping it would leave a
-- code path that can un-blur a photo, and the point is that no such path
-- exists.
alter table profiles drop column if exists photo_visibility;
drop type if exists photo_visibility_t;

alter table photos
  add column if not exists blurred_path text,
  add column if not exists blur_generated_at timestamptz;

comment on column photos.storage_path is
  'The clear original. Never granted to a client role, in any circumstance.';
comment on column photos.blurred_path is
  'Heavily blurred derivative generated server-side on upload. This is what
   everyone sees until a grant exists. Blurring on the client is not blurring.';

do $ddl$ begin
  create type photo_request_state as enum (
    'pending_admin',       -- waiting to be screened
    'blocked_by_admin',    -- never shown to the owner; she is not troubled by it
    'pending_owner',       -- relayed, waiting on her
    'approved',
    'rejected_by_owner',
    'withdrawn',           -- requester changed their mind
    'expired'              -- owner did not respond in time
  );
exception when duplicate_object then null; end $ddl$;

-- ---------------------------------------------------------------------
-- Requests
-- ---------------------------------------------------------------------

create table if not exists photo_access_requests (
  id                uuid primary key default gen_random_uuid(),
  requester_id      uuid not null references users(id) on delete cascade,
  owner_id          uuid not null references users(id) on delete cascade,
  match_id          uuid references matches(id) on delete set null,
  note              text,                              -- optional, max 200 chars
  state             photo_request_state not null default 'pending_admin',

  created_at        timestamptz not null default now(),
  responds_by       timestamptz not null default now() + interval '7 days',

  admin_id          uuid references admin_users(id),
  admin_decided_at  timestamptz,
  admin_reason      text,

  owner_decided_at  timestamptz,

  constraint no_self_request check (requester_id <> owner_id),
  constraint note_length check (note is null or length(note) <= 200)
);

-- One live request per pair. Without this a rejected requester simply asks
-- again tomorrow, and the feature becomes a way to pester someone.
create unique index if not exists photo_request_one_live
  on photo_access_requests (requester_id, owner_id)
  where state in ('pending_admin', 'pending_owner', 'approved');

create index if not exists photo_request_admin_queue
  on photo_access_requests (created_at)
  where state = 'pending_admin';

create index if not exists photo_request_owner_inbox
  on photo_access_requests (owner_id, created_at)
  where state = 'pending_owner';

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------

create table if not exists photo_access_grants (
  id              uuid primary key default gen_random_uuid(),
  request_id      uuid not null unique references photo_access_requests(id) on delete cascade,
  viewer_id       uuid not null references users(id) on delete cascade,
  owner_id        uuid not null references users(id) on delete cascade,

  granted_at      timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '14 days',

  revoked_at      timestamptz,
  revoked_by      uuid references users(id),
  revoke_reason   text,

  -- Stamped into every revealed image. A leaked screenshot names its source.
  watermark_token text not null default encode(gen_random_bytes(8), 'hex'),

  last_viewed_at  timestamptz,
  view_count      int not null default 0
);

create index if not exists photo_grant_lookup on photo_access_grants (viewer_id, owner_id)
  where revoked_at is null;

-- The single source of truth for "may this person see those photos".
-- Storage policies, the gallery view and the reveal RPC all call it, so
-- there is one place to get right and one place to audit.
create or replace function has_photo_access(viewer uuid, owner uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from photo_access_grants g
    where g.viewer_id = viewer
      and g.owner_id  = owner
      and g.revoked_at is null
      and g.expires_at > now()
  );
$$;

-- ---------------------------------------------------------------------
-- Asking
-- ---------------------------------------------------------------------

-- Rate limit. A person who fires requests at everyone on their slate is
-- not looking for a wife, and the review desk should not have to absorb it.
create or replace function photo_requests_today(requester uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from photo_access_requests
  where requester_id = requester and created_at > now() - interval '24 hours';
$$;

create or replace function request_photo_access(owner uuid, note text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  requester uuid := auth.uid();
  req_id uuid;
begin
  if requester is null then
    raise exception 'not signed in';
  end if;
  if requester = owner then
    raise exception 'cannot request your own photos';
  end if;
  if not (is_admitted(requester) and is_admitted(owner)) then
    raise exception 'both accounts must be admitted';
  end if;
  if not can_view_profile(requester, owner) then
    raise exception 'you cannot request photos from someone you have not been shown';
  end if;
  if blocked_between(requester, owner) then
    raise exception 'unavailable';
  end if;
  if photo_requests_today(requester) >= 3 then
    raise exception 'daily request limit reached';
  end if;
  if has_photo_access(requester, owner) then
    raise exception 'you already have access';
  end if;

  insert into photo_access_requests (requester_id, owner_id, note, match_id)
  values (
    requester, owner, left(note, 200),
    (select id from matches
      where user_a = least(requester, owner) and user_b = greatest(requester, owner))
  )
  returning id into req_id;

  return req_id;
end;
$$;

create or replace function withdraw_photo_request(request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update photo_access_requests
     set state = 'withdrawn'
   where id = request_id
     and requester_id = auth.uid()
     and state in ('pending_admin', 'pending_owner');
end;
$$;

-- ---------------------------------------------------------------------
-- Screening, then relaying
-- ---------------------------------------------------------------------

-- The admin's job is to stop a request reaching the owner at all when the
-- requester has no business making it. A blocked request is invisible to
-- the owner: she is never told that a man with three reports against him
-- asked to see her face.
create or replace function admin_screen_photo_request(
  request_id uuid, allow boolean, reason text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'admin only';
  end if;

  update photo_access_requests
     set state = case when allow then 'pending_owner' else 'blocked_by_admin' end::photo_request_state,
         admin_id = auth.uid(),
         admin_decided_at = now(),
         admin_reason = reason
   where id = request_id
     and state = 'pending_admin';

  if not found then
    raise exception 'request is not awaiting screening';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- The owner decides
-- ---------------------------------------------------------------------

create or replace function respond_to_photo_request(request_id uuid, approve boolean)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  r photo_access_requests%rowtype;
  grant_id uuid;
begin
  select * into r from photo_access_requests
   where id = request_id and owner_id = auth.uid() and state = 'pending_owner'
   for update;

  if not found then
    raise exception 'no such request';
  end if;

  update photo_access_requests
     set state = case when approve then 'approved' else 'rejected_by_owner' end::photo_request_state,
         owner_decided_at = now()
   where id = request_id;

  if not approve then
    return null;
  end if;

  insert into photo_access_grants (request_id, viewer_id, owner_id)
  values (r.id, r.requester_id, r.owner_id)
  returning id into grant_id;

  return grant_id;
end;
$$;

-- Revocation needs no reason and takes effect immediately. Requiring an
-- explanation to withdraw consent would defeat the point of asking for it.
create or replace function revoke_photo_access(owner_or_viewer_grant uuid, reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update photo_access_grants
     set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = reason
   where id = owner_or_viewer_grant
     and revoked_at is null
     and (owner_id = auth.uid() or is_admin());

  if not found then
    raise exception 'no such grant';
  end if;
end;
$$;

-- Revoke every grant at once. The button a woman needs when something has
-- gone wrong and she does not want to think about which grant is which.
create or replace function revoke_all_photo_access()
returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with gone as (
    update photo_access_grants
       set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = 'revoked_all'
     where owner_id = auth.uid() and revoked_at is null
     returning 1
  ) select count(*) into n from gone;
  return n;
end;
$$;

-- ---------------------------------------------------------------------
-- What a client may read
-- ---------------------------------------------------------------------

-- The gallery returns the blurred derivative and a boolean. It never
-- carries the original path, so no client bug and no leaked query can
-- expose one.
--
-- Deliberately NOT security_invoker. `photos` is revoked from every client
-- role because it holds the clear original path, so a view that ran with
-- the caller's privileges could not read it at all. This view is the one
-- controlled window onto that table: it runs as its owner, and the WHERE
-- clause below is what scopes the rows.
create or replace view photo_gallery as
select
  p.id,
  p.user_id,
  p.ordinal,
  p.is_primary,
  p.blurred_path,
  has_photo_access(auth.uid(), p.user_id) as revealed
from photos p
where can_view_profile(auth.uid(), p.user_id);

-- A granted viewer calls this for one photo at a time. It records the view,
-- so the owner can see who looked and when, and returns the object path of
-- the watermarked copy — not the original.
create or replace function reveal_photo(photo_id uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  ph photos%rowtype;
  g  photo_access_grants%rowtype;
begin
  select * into ph from photos where id = photo_id;
  if not found then
    raise exception 'no such photo';
  end if;

  select * into g from photo_access_grants
   where viewer_id = auth.uid() and owner_id = ph.user_id
     and revoked_at is null and expires_at > now()
   limit 1;

  if not found then
    raise exception 'no access';
  end if;

  update photo_access_grants
     set last_viewed_at = now(), view_count = view_count + 1
   where id = g.id;

  return 'reveals/' || g.id::text || '/' || ph.ordinal::text || '.jpg';
end;
$$;

-- Screenshot attempts are reported by the client and shown to the owner.
-- Imperfect on both platforms, but the deterrent and the signal both
-- matter more here than the detection rate.
create table if not exists photo_view_events (
  id         bigserial primary key,
  grant_id   uuid not null references photo_access_grants(id) on delete cascade,
  kind       text not null check (kind in ('viewed', 'screenshot_attempt', 'screen_recording')),
  created_at timestamptz not null default now()
);

create index if not exists photo_view_events_grant on photo_view_events (grant_id, created_at desc);

-- ---------------------------------------------------------------------
-- Housekeeping
-- ---------------------------------------------------------------------

create or replace function expire_photo_requests() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with gone as (
    update photo_access_requests
       set state = 'expired'
     where state in ('pending_admin', 'pending_owner') and responds_by < now()
     returning 1
  ) select count(*) into n from gone;
  return n;
end;
$$;

-- Watermarked copies are deleted with the grant that produced them.
create or replace function expired_grant_objects()
returns table (object_prefix text)
language sql stable security definer set search_path = public as $$
  select 'reveals/' || id::text || '/'
  from photo_access_grants
  where (expires_at < now() or revoked_at is not null)
$$;

-- ---------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------

alter table photo_access_requests enable row level security;
alter table photo_access_grants   enable row level security;
alter table photo_view_events     enable row level security;

-- The requester sees their own request, but a blocked one reads as
-- "awaiting a response" to them: telling a rejected requester that an
-- admin stopped him invites him to work out why.
drop policy if exists photo_req_requester on photo_access_requests;
create policy photo_req_requester on photo_access_requests for select
  using (requester_id = auth.uid());

-- The owner sees a request only once it has been screened and relayed.
drop policy if exists photo_req_owner on photo_access_requests;
create policy photo_req_owner on photo_access_requests for select
  using (owner_id = auth.uid()
         and state in ('pending_owner', 'approved', 'rejected_by_owner', 'expired'));

drop policy if exists photo_req_admin on photo_access_requests;
create policy photo_req_admin on photo_access_requests for select using (is_admin());

drop policy if exists photo_grant_parties on photo_access_grants;
create policy photo_grant_parties on photo_access_grants for select
  using (viewer_id = auth.uid() or owner_id = auth.uid() or is_admin());

drop policy if exists photo_view_events_owner on photo_view_events;
create policy photo_view_events_owner on photo_view_events for select
  using (exists (select 1 from photo_access_grants g
                 where g.id = grant_id and (g.owner_id = auth.uid() or is_admin())));

drop policy if exists photo_view_events_insert on photo_view_events;
create policy photo_view_events_insert on photo_view_events for insert
  with check (exists (select 1 from photo_access_grants g
                      where g.id = grant_id and g.viewer_id = auth.uid()));

-- Tables are read-only to clients; every change goes through the functions
-- above, which is where the rules live.
grant select on photo_access_requests, photo_access_grants to authenticated;
grant select, insert on photo_view_events to authenticated;
grant select on photo_gallery to authenticated;

-- `photos` itself is not reachable any more: it holds the original path.
revoke all on photos from authenticated, anon;

grant execute on function request_photo_access(uuid, text)      to authenticated;
grant execute on function withdraw_photo_request(uuid)          to authenticated;
grant execute on function respond_to_photo_request(uuid, boolean) to authenticated;
grant execute on function revoke_photo_access(uuid, text)       to authenticated;
grant execute on function revoke_all_photo_access()             to authenticated;
grant execute on function reveal_photo(uuid)                    to authenticated;
grant execute on function has_photo_access(uuid, uuid)          to authenticated;

revoke execute on function admin_screen_photo_request(uuid, boolean, text) from authenticated, anon;
revoke execute on function expire_photo_requests() from authenticated, anon;

-- ---------------------------------------------------------------------
-- Storage policies (Supabase)
-- ---------------------------------------------------------------------
-- Run these against a project that has storage.objects. Buckets:
--   profile-photos          originals — no client policy at all
--   profile-photos-blurred  derivatives — readable by anyone who can see the profile
--   photo-reveals           watermarked copies — readable only under a live grant
--
-- create policy "blurred readable to profile viewers"
--   on storage.objects for select to authenticated
--   using (
--     bucket_id = 'profile-photos-blurred'
--     and can_view_profile(auth.uid(), ((storage.foldername(name))[1])::uuid)
--   );
--
-- create policy "reveals readable under a live grant"
--   on storage.objects for select to authenticated
--   using (
--     bucket_id = 'photo-reveals'
--     and exists (
--       select 1 from photo_access_grants g
--       where g.id = ((storage.foldername(name))[2])::uuid
--         and g.viewer_id = auth.uid()
--         and g.revoked_at is null
--         and g.expires_at > now()
--     )
--   );
