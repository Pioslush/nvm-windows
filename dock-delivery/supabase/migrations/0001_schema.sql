-- Dock & Delivery Scheduling — schema, triggers, RLS.
-- Forked from GameDay Dock; replaces the single-day "event" concept with
-- continuous, recurring dock availability (warehouses/3PLs book on an
-- ongoing basis, not for one bounded event's load-in window).

create extension if not exists pgcrypto;

-- ── facilities (was venues) ─────────────────────────────────────────────
create table public.facilities (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  city               text not null,
  timezone           text not null default 'America/Denver',
  address            text,
  require_approval   boolean not null default true,
  cancellation_cutoff_hours integer not null default 12 check (cancellation_cutoff_hours >= 0),
  created_by         uuid not null references auth.users (id),
  stripe_customer_id text,
  created_at         timestamptz not null default now()
);

create table public.facility_members (
  facility_id uuid not null references public.facilities (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null default 'admin' check (role = 'admin'),
  created_at  timestamptz not null default now(),
  primary key (facility_id, user_id)
);

create or replace function public.handle_new_facility()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.facility_members (facility_id, user_id, role)
  values (new.id, new.created_by, 'admin');
  return new;
end;
$$;

create trigger on_facility_created
  after insert on public.facilities
  for each row execute function public.handle_new_facility();

-- ── docks ────────────────────────────────────────────────────────────────
create table public.docks (
  id          uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities (id) on delete cascade,
  name        text not null,
  notes       text,
  created_at  timestamptz not null default now()
);

-- ── dock_availability: recurring weekly template ────────────────────────
-- Replaces GameDay's "create an event, generate slots for its load-in
-- window" with a standing weekly schedule per dock. Concrete slot rows are
-- materialized from this on a rolling horizon (see generateSlotsForDock).
create table public.dock_availability (
  id                    uuid primary key default gen_random_uuid(),
  dock_id               uuid not null references public.docks (id) on delete cascade,
  day_of_week           smallint not null check (day_of_week between 0 and 6), -- 0=Sunday
  start_time            time not null,
  end_time              time not null,
  slot_interval_minutes integer not null default 30 check (slot_interval_minutes > 0),
  created_at            timestamptz not null default now(),
  check (end_time > start_time),
  unique (dock_id, day_of_week)
);

-- ── slots ────────────────────────────────────────────────────────────────
-- No event_id: a slot is scoped directly to its dock. unique(dock_id,
-- start_time) makes slot generation idempotent (on conflict do nothing).
create table public.slots (
  id         uuid primary key default gen_random_uuid(),
  dock_id    uuid not null references public.docks (id) on delete cascade,
  start_time timestamptz not null,
  end_time   timestamptz not null,
  status     text not null default 'open' check (status in ('open', 'booked', 'blocked')),
  created_at timestamptz not null default now(),
  check (end_time > start_time),
  unique (dock_id, start_time)
);

create index slots_dock_idx on public.slots (dock_id);
create index slots_start_time_idx on public.slots (start_time);

-- ── carriers (was vendors) ───────────────────────────────────────────────
create table public.carriers (
  id            uuid primary key default gen_random_uuid(),
  company_name  text not null,
  contact_name  text not null,
  phone         text not null,
  email         text not null,
  vehicle_type  text not null,
  license_plate text,
  user_id       uuid not null unique references auth.users (id) on delete cascade,
  created_at    timestamptz not null default now()
);

-- ── bookings ─────────────────────────────────────────────────────────────
create table public.bookings (
  id            uuid primary key default gen_random_uuid(),
  slot_id       uuid not null references public.slots (id) on delete cascade,
  carrier_id    uuid not null references public.carriers (id) on delete cascade,
  status        text not null default 'pending'
                check (status in ('pending', 'confirmed', 'checked_in', 'late', 'no_show', 'cancelled')),
  purpose       text not null,
  created_at    timestamptz not null default now(),
  checked_in_at timestamptz,
  reminded_at   timestamptz
);

-- THE double-booking guard: at most one non-cancelled booking per slot,
-- enforced by the database no matter how requests race. Unchanged from
-- GameDay Dock — already slot-scoped only, no event dependency.
create unique index bookings_one_active_per_slot
  on public.bookings (slot_id)
  where status <> 'cancelled';

create index bookings_carrier_idx on public.bookings (carrier_id);

-- ── facility_invites (was event_invites) ────────────────────────────────
-- A standing carrier <-> facility relationship, not scoped to one event.
-- Once invited, a carrier can always see and book that facility's open
-- slots (until the invite is removed).
create table public.facility_invites (
  id            uuid primary key default gen_random_uuid(),
  facility_id   uuid not null references public.facilities (id) on delete cascade,
  carrier_email text not null check (carrier_email = lower(carrier_email)),
  token         text not null unique default encode(gen_random_bytes(24), 'hex'),
  created_at    timestamptz not null default now(),
  unique (facility_id, carrier_email)
);

-- ── dock_manifest_tokens (was gate_list_tokens) ─────────────────────────
-- Facility-scoped bearer token for the public, unauthenticated manifest
-- page. Unlike GameDay's per-event token, this isn't scoped to a single
-- day — the manifest page filters bookings to "today" (facility timezone)
-- at render time, so one token stays useful indefinitely (revocable).
create table public.dock_manifest_tokens (
  id          uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities (id) on delete cascade,
  token       text not null unique default encode(gen_random_bytes(24), 'hex'),
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

-- ── booking triggers ─────────────────────────────────────────────────────
create or replace function public.check_booking_slot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_start  timestamptz;
begin
  select status, start_time into v_status, v_start
    from public.slots
   where id = new.slot_id
     for update;

  if v_status is null then
    raise exception 'slot not found';
  end if;
  if v_status = 'blocked' then
    raise exception 'slot is blocked';
  end if;
  if v_start < now() then
    raise exception 'slot is in the past';
  end if;
  return new;
end;
$$;

create trigger before_booking_insert
  before insert on public.bookings
  for each row execute function public.check_booking_slot();

-- Keeps slots.status in sync with whether an active booking exists.
-- Unchanged from GameDay Dock — already slot/booking-scoped only.
create or replace function public.sync_slot_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot uuid;
  v_has_active boolean;
begin
  v_slot := coalesce(new.slot_id, old.slot_id);
  select exists (
    select 1 from public.bookings
     where slot_id = v_slot and status <> 'cancelled'
  ) into v_has_active;

  update public.slots
     set status = case when v_has_active then 'booked' else 'open' end
   where id = v_slot and status <> 'blocked';
  return null;
end;
$$;

create trigger after_booking_change
  after insert or update or delete on public.bookings
  for each row execute function public.sync_slot_status();

-- ── RLS helper functions ────────────────────────────────────────────────
create or replace function public.current_email()
returns text
language sql
set search_path = public
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

create or replace function public.is_facility_admin(p_facility_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.facility_members
     where facility_id = p_facility_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_invited_to_facility(p_facility_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.facility_invites
     where facility_id = p_facility_id and carrier_email = public.current_email()
  );
$$;

create or replace function public.is_own_carrier(p_carrier_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.carriers where id = p_carrier_id and user_id = auth.uid()
  );
$$;

-- ── RLS: enable + policies ───────────────────────────────────────────────
alter table public.facilities enable row level security;
alter table public.facility_members enable row level security;
alter table public.docks enable row level security;
alter table public.dock_availability enable row level security;
alter table public.slots enable row level security;
alter table public.carriers enable row level security;
alter table public.bookings enable row level security;
alter table public.facility_invites enable row level security;
alter table public.dock_manifest_tokens enable row level security;

-- facilities
create policy "admins read their facilities" on public.facilities
  for select using (public.is_facility_admin(id));
create policy "authenticated users create facilities" on public.facilities
  for insert with check (auth.uid() = created_by);
create policy "admins update their facilities" on public.facilities
  for update using (public.is_facility_admin(id));
create policy "invited carriers read facilities" on public.facilities
  for select using (public.is_invited_to_facility(id));

-- facility_members (writes only via handle_new_facility, security definer)
create policy "members read own memberships" on public.facility_members
  for select using (user_id = auth.uid());

-- docks
create policy "admins manage docks" on public.docks
  for all using (public.is_facility_admin(facility_id));
create policy "invited carriers read docks" on public.docks
  for select using (public.is_invited_to_facility(facility_id));

-- dock_availability (admin only — carriers only need the generated slots)
create policy "admins manage dock availability" on public.dock_availability
  for all using (
    public.is_facility_admin((select facility_id from public.docks where id = dock_id))
  );

-- slots
create policy "admins manage slots" on public.slots
  for all using (
    public.is_facility_admin((select facility_id from public.docks where id = dock_id))
  );
create policy "invited carriers read slots" on public.slots
  for select using (
    public.is_invited_to_facility((select facility_id from public.docks where id = dock_id))
  );

-- carriers
create policy "carriers manage own profile" on public.carriers
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "admins read carriers booked at their facility" on public.carriers
  for select using (
    exists (
      select 1
        from public.bookings b
        join public.slots s on s.id = b.slot_id
        join public.docks d on d.id = s.dock_id
       where b.carrier_id = carriers.id
         and public.is_facility_admin(d.facility_id)
    )
  );

-- bookings
create policy "carriers read own bookings" on public.bookings
  for select using (public.is_own_carrier(carrier_id));
create policy "carriers create own bookings" on public.bookings
  for insert with check (
    public.is_own_carrier(carrier_id)
    and public.is_invited_to_facility((
      select d.facility_id
        from public.slots s
        join public.docks d on d.id = s.dock_id
       where s.id = slot_id
    ))
  );
create policy "carriers update own bookings" on public.bookings
  for update using (public.is_own_carrier(carrier_id));
create policy "admins manage bookings at their facility" on public.bookings
  for all using (
    public.is_facility_admin((
      select d.facility_id
        from public.slots s
        join public.docks d on d.id = s.dock_id
       where s.id = slot_id
    ))
  );

-- facility_invites
create policy "admins manage facility invites" on public.facility_invites
  for all using (public.is_facility_admin(facility_id));
create policy "carriers read own invites" on public.facility_invites
  for select using (carrier_email = public.current_email());

-- dock_manifest_tokens (public manifest page reads via service role, bypassing RLS)
create policy "admins manage manifest tokens" on public.dock_manifest_tokens
  for all using (public.is_facility_admin(facility_id));
