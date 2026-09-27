-- =====================================================================
-- Screen capture: recording it, and making it cost something.
--
-- The client-side protection is real on Android (FLAG_SECURE blocks the
-- capture outright) and impossible on iOS (Apple exposes no API to block a
-- screenshot). That asymmetry is why the deterrent that matters lives
-- here rather than in the app: the viewer is named, the owner is told, and
-- a second attempt revokes access without her having to do anything.
--
-- A person can always photograph the screen with a second phone. Nothing
-- prevents that, which is why every revealed image is watermarked with the
-- viewer's token — a leaked photo names its source.
-- =====================================================================

alter table photo_access_grants
  add column if not exists screenshot_count int not null default 0,
  add column if not exists recording_count int not null default 0;

comment on column photo_access_grants.screenshot_count is
  'Detected screenshots. Two of them revoke the grant automatically.';

-- How many detected attempts before access is withdrawn without asking
-- the owner. One is a mistake; two is a decision.
create or replace function screenshot_revoke_threshold() returns int
language sql immutable as $$ select 2 $$;

-- ---------------------------------------------------------------------
-- The viewer's client reports the event
-- ---------------------------------------------------------------------

-- Returns what the client should tell the viewer: 'warned' on the first
-- attempt, 'revoked' when this one crossed the threshold.
create or replace function record_screen_event(p_grant_id uuid, p_kind text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  g photo_access_grants%rowtype;
  shots int;
begin
  if p_kind not in ('viewed', 'screenshot_attempt', 'screen_recording') then
    raise exception 'unknown event kind';
  end if;

  -- Only the viewer on a live grant may report against it. Without this
  -- check a client could inflate someone else's count and revoke their
  -- access for them.
  select * into g from photo_access_grants
   where id = p_grant_id
     and viewer_id = auth.uid()
     and revoked_at is null
     and expires_at > now();

  if not found then
    raise exception 'no live grant';
  end if;

  insert into photo_view_events (grant_id, kind) values (p_grant_id, p_kind);

  if p_kind = 'screen_recording' then
    update photo_access_grants
       set recording_count = recording_count + 1
     where id = p_grant_id;
    return 'noted';
  end if;

  if p_kind <> 'screenshot_attempt' then
    return 'noted';
  end if;

  update photo_access_grants
     set screenshot_count = screenshot_count + 1
   where id = p_grant_id
  returning screenshot_count into shots;

  if shots >= screenshot_revoke_threshold() then
    update photo_access_grants
       set revoked_at = now(), revoke_reason = 'screenshot_threshold'
     where id = p_grant_id;
    return 'revoked';
  end if;

  return 'warned';
end;
$$;

-- ---------------------------------------------------------------------
-- What the owner sees
-- ---------------------------------------------------------------------

-- One row per grant, with the capture history attached. This is what the
-- "who can see my photos" screen reads, so a woman can see at a glance
-- that someone screenshotted her photos and when.
create or replace view my_photo_grants as
select
  g.id,
  g.viewer_id,
  p.display_name as viewer_name,
  g.granted_at,
  g.expires_at,
  g.revoked_at,
  g.revoke_reason,
  g.view_count,
  g.last_viewed_at,
  g.screenshot_count,
  g.recording_count,
  (select max(created_at) from photo_view_events e
    where e.grant_id = g.id and e.kind = 'screenshot_attempt') as last_screenshot_at
from photo_access_grants g
join profiles p on p.user_id = g.viewer_id
where g.owner_id = auth.uid();

comment on view my_photo_grants is
  'Owner-facing. Never exposes the viewer''s contact details — only the
   name she already sees on his profile, and what he did with her photos.';

-- ---------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------

-- Events are written only through record_screen_event, which is where the
-- ownership check and the threshold live. The direct insert policy from
-- 0005 is dropped so there is exactly one way in.
drop policy if exists photo_view_events_insert on photo_view_events;
revoke insert on photo_view_events from authenticated;

grant select on my_photo_grants to authenticated;
grant execute on function record_screen_event(uuid, text) to authenticated;
grant execute on function screenshot_revoke_threshold() to authenticated;
