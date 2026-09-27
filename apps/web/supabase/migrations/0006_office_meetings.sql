-- =====================================================================
-- Office meetings.
--
-- The sanctioned way two people meet: a booked slot at one of our offices,
-- with a staff member present or nearby, and family welcome to attend.
--
-- This is a considerable advantage over every competitor. A first meeting
-- arranged by the platform, on neutral supervised ground, is what a family
-- in this market will actually agree to — and it removes the most dangerous
-- moment in the whole product, which is two strangers arranging to meet
-- somewhere private off the back of an app conversation.
--
-- It also means attendance is observed, so "he never showed up" and "she
-- came with her brother" are facts on the record rather than claims.
-- =====================================================================

create type meeting_state as enum (
  'proposed',            -- one side asked
  'declined',            -- the other said no
  'pending_scheduling',  -- both agreed, waiting on a slot
  'scheduled',
  'completed',
  'cancelled',
  'no_show'
);

create table offices (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  city        text not null,
  address     text not null,
  maps_url    text,
  phone_e164  text,
  timezone    text not null default 'Asia/Hebron',
  notes       text,                                  -- parking, entrance, floor
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- A slot is a real room at a real time with a named staff member on it.
-- Capacity is almost always 1: two people and their families need the room
-- to themselves.
create table office_slots (
  id            uuid primary key default gen_random_uuid(),
  office_id     uuid not null references offices(id) on delete cascade,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  capacity      int not null default 1 check (capacity > 0),
  booked_count  int not null default 0 check (booked_count >= 0),
  staff_name    text,
  room          text,
  active        boolean not null default true,
  constraint slot_time_sane check (ends_at > starts_at),
  constraint slot_not_oversold check (booked_count <= capacity)
);

create index office_slots_open
  on office_slots (office_id, starts_at)
  where active and booked_count < capacity;

create table meetings (
  id              uuid primary key default gen_random_uuid(),
  match_id        uuid not null references matches(id) on delete cascade,
  proposed_by     uuid not null references users(id) on delete cascade,
  state           meeting_state not null default 'proposed',

  slot_id         uuid references office_slots(id) on delete set null,
  office_id       uuid references offices(id) on delete set null,

  -- Either side may bring a guardian or relative. Asked explicitly,
  -- because the answer changes how the room is set up.
  proposer_brings_family boolean not null default false,
  invitee_brings_family  boolean not null default false,

  note            text,
  proposed_at     timestamptz not null default now(),
  responded_at    timestamptz,
  scheduled_at    timestamptz,
  scheduled_by    uuid references admin_users(id),
  completed_at    timestamptz,
  cancelled_at    timestamptz,
  cancelled_by    uuid references users(id),
  cancel_reason   text,

  constraint note_len check (note is null or length(note) <= 300)
);

-- One live meeting per match. Two people do not need three pending
-- appointments with each other.
create unique index meeting_one_live_per_match
  on meetings (match_id)
  where state in ('proposed', 'pending_scheduling', 'scheduled');

create index meetings_scheduling_queue on meetings (proposed_at)
  where state = 'pending_scheduling';

create table meeting_attendance (
  meeting_id    uuid not null references meetings(id) on delete cascade,
  user_id       uuid not null references users(id) on delete cascade,
  attended      boolean,
  companions    int not null default 0,
  checked_in_at timestamptz,
  staff_note    text,
  primary key (meeting_id, user_id)
);

-- ---------------------------------------------------------------------
-- Proposing and responding
-- ---------------------------------------------------------------------

create or replace function propose_office_meeting(
  p_match_id uuid, brings_family boolean default false, note text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  m  matches%rowtype;
  meeting_id uuid;
begin
  select * into m from matches where id = p_match_id;
  if not found or me not in (m.user_a, m.user_b) then
    raise exception 'no such match';
  end if;
  if m.state <> 'active' then
    raise exception 'the match is not active';
  end if;
  if blocked_between(m.user_a, m.user_b) then
    raise exception 'unavailable';
  end if;

  insert into meetings (match_id, proposed_by, proposer_brings_family, note)
  values (p_match_id, me, brings_family, left(note, 300))
  returning id into meeting_id;

  return meeting_id;
end;
$$;

create or replace function respond_to_meeting(
  p_meeting_id uuid, accept boolean, brings_family boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  mt meetings%rowtype;
  m  matches%rowtype;
begin
  select * into mt from meetings where id = p_meeting_id for update;
  if not found or mt.state <> 'proposed' then
    raise exception 'no such proposal';
  end if;

  select * into m from matches where id = mt.match_id;

  -- Only the other party may answer. Accepting your own proposal would
  -- walk a meeting into the scheduling queue with one person's consent.
  if me not in (m.user_a, m.user_b) or me = mt.proposed_by then
    raise exception 'not yours to answer';
  end if;

  update meetings
     set state = case when accept then 'pending_scheduling' else 'declined' end::meeting_state,
         invitee_brings_family = brings_family,
         responded_at = now()
   where id = p_meeting_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Scheduling (admin)
-- ---------------------------------------------------------------------

create or replace function schedule_meeting(p_meeting_id uuid, p_slot_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  s office_slots%rowtype;
  mt meetings%rowtype;
begin
  if not is_admin() then
    raise exception 'admin only';
  end if;

  select * into mt from meetings where id = p_meeting_id for update;
  if not found or mt.state <> 'pending_scheduling' then
    raise exception 'meeting is not awaiting a slot';
  end if;

  -- Lock the slot before checking capacity, or two admins working the
  -- queue at once will both see a free room and both book it.
  select * into s from office_slots where id = p_slot_id for update;
  if not found or not s.active then
    raise exception 'no such slot';
  end if;
  if s.booked_count >= s.capacity then
    raise exception 'slot is full';
  end if;
  if s.starts_at <= now() then
    raise exception 'slot is in the past';
  end if;

  update office_slots set booked_count = booked_count + 1 where id = p_slot_id;

  update meetings
     set state = 'scheduled',
         slot_id = p_slot_id,
         office_id = s.office_id,
         scheduled_at = now(),
         scheduled_by = auth.uid()
   where id = p_meeting_id;

  insert into meeting_attendance (meeting_id, user_id)
  select p_meeting_id, u
  from (select user_a as u from matches where id = mt.match_id
        union all
        select user_b from matches where id = mt.match_id) t
  on conflict do nothing;
end;
$$;

create or replace function cancel_meeting(p_meeting_id uuid, reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare mt meetings%rowtype; m matches%rowtype;
begin
  select * into mt from meetings where id = p_meeting_id for update;
  if not found or mt.state not in ('proposed', 'pending_scheduling', 'scheduled') then
    raise exception 'nothing to cancel';
  end if;

  select * into m from matches where id = mt.match_id;
  if auth.uid() not in (m.user_a, m.user_b) and not is_admin() then
    raise exception 'not yours to cancel';
  end if;

  if mt.slot_id is not null then
    update office_slots set booked_count = greatest(0, booked_count - 1)
     where id = mt.slot_id;
  end if;

  update meetings
     set state = 'cancelled', cancelled_at = now(),
         cancelled_by = auth.uid(), cancel_reason = reason
   where id = p_meeting_id;
end;
$$;

-- Recorded by staff after the appointment. A no-show is a fact, and it
-- belongs in the trust signal rather than in an argument between two
-- people afterwards.
create or replace function record_meeting_outcome(
  p_meeting_id uuid, attended_a boolean, attended_b boolean, staff_note text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare mt meetings%rowtype; m matches%rowtype;
begin
  if not is_admin() then
    raise exception 'admin only';
  end if;

  select * into mt from meetings where id = p_meeting_id for update;
  if not found or mt.state <> 'scheduled' then
    raise exception 'meeting was not scheduled';
  end if;

  select * into m from matches where id = mt.match_id;

  update meeting_attendance set attended = attended_a, checked_in_at = now(),
         staff_note = record_meeting_outcome.staff_note
   where meeting_id = p_meeting_id and user_id = m.user_a;
  update meeting_attendance set attended = attended_b, checked_in_at = now()
   where meeting_id = p_meeting_id and user_id = m.user_b;

  update meetings
     set state = case when attended_a and attended_b then 'completed' else 'no_show' end::meeting_state,
         completed_at = now()
   where id = p_meeting_id;

  if attended_a and attended_b then
    update matches set state = 'progressed' where id = mt.match_id;
  end if;
end;
$$;

-- What the app shows a user: open slots at offices, without exposing who
-- else is booked into them.
create or replace function open_slots(p_city text default null, days_ahead int default 21)
returns table (
  slot_id uuid, office_id uuid, office_name text, city text,
  address text, starts_at timestamptz, ends_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select s.id, o.id, o.name, o.city, o.address, s.starts_at, s.ends_at
  from office_slots s
  join offices o on o.id = s.office_id
  where s.active and o.active
    and s.booked_count < s.capacity
    and s.starts_at between now() + interval '24 hours' and now() + (days_ahead || ' days')::interval
    and (p_city is null or o.city = p_city)
  order by s.starts_at;
$$;

-- ---------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------

alter table offices            enable row level security;
alter table office_slots       enable row level security;
alter table meetings           enable row level security;
alter table meeting_attendance enable row level security;

create policy offices_public on offices for select using (active or is_admin());

-- Slot rows are not browsable: `booked_count` on a named room at a named
-- hour tells you who is meeting whom if you watch it. `open_slots()`
-- returns only what a user needs.
create policy office_slots_admin on office_slots for select using (is_admin());

create policy meetings_parties on meetings for select
  using (
    exists (select 1 from matches m
            where m.id = match_id and auth.uid() in (m.user_a, m.user_b))
    or is_admin()
  );

-- A chaperoning or gating wali sees the appointment, since the whole
-- point is that the family is part of it.
create policy meetings_wali on meetings for select
  using (exists (
    select 1 from matches m
    join guardians g on g.user_id in (m.user_a, m.user_b)
    where m.id = match_id
      and g.guardian_user_id = auth.uid()
      and g.revoked_at is null
      and g.level in ('chaperoned', 'gated')
  ));

create policy attendance_self on meeting_attendance for select
  using (user_id = auth.uid() or is_admin());

grant select on offices, meetings, meeting_attendance to authenticated;

grant execute on function propose_office_meeting(uuid, boolean, text) to authenticated;
grant execute on function respond_to_meeting(uuid, boolean, boolean)  to authenticated;
grant execute on function cancel_meeting(uuid, text)                  to authenticated;
grant execute on function open_slots(text, int)                       to authenticated;

revoke execute on function schedule_meeting(uuid, uuid) from authenticated, anon;
revoke execute on function record_meeting_outcome(uuid, boolean, boolean, text) from authenticated, anon;
