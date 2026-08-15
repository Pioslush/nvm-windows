-- GameDay Dock — core schema
-- All timestamps are stored as timestamptz (UTC). Display always converts to the venue's timezone.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.venues (
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

create table public.venue_members (
  venue_id   uuid not null references public.venues (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null default 'admin' check (role = 'admin'),
  created_at timestamptz not null default now(),
  primary key (venue_id, user_id)
);

create table public.docks (
  id         uuid primary key default gen_random_uuid(),
  venue_id   uuid not null references public.venues (id) on delete cascade,
  name       text not null,
  notes      text,
  created_at timestamptz not null default now()
);

create table public.events (
  id            uuid primary key default gen_random_uuid(),
  venue_id      uuid not null references public.venues (id) on delete cascade,
  name          text not null,
  event_date    date not null,
  load_in_start timestamptz not null,
  load_in_end   timestamptz not null,
  status        text not null default 'draft' check (status in ('draft', 'published', 'completed')),
  created_at    timestamptz not null default now(),
  check (load_in_end > load_in_start)
);

create table public.slots (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events (id) on delete cascade,
  dock_id    uuid not null references public.docks (id) on delete cascade,
  start_time timestamptz not null,
  end_time   timestamptz not null,
  status     text not null default 'open' check (status in ('open', 'booked', 'blocked')),
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);

create index slots_event_idx on public.slots (event_id);
create index slots_dock_idx on public.slots (dock_id);

create table public.vendors (
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

create table public.bookings (
  id            uuid primary key default gen_random_uuid(),
  slot_id       uuid not null references public.slots (id) on delete cascade,
  vendor_id     uuid not null references public.vendors (id) on delete cascade,
  status        text not null default 'pending'
                check (status in ('pending', 'confirmed', 'checked_in', 'late', 'no_show', 'cancelled')),
  purpose       text not null,
  created_at    timestamptz not null default now(),
  checked_in_at timestamptz,
  reminded_at   timestamptz
);

-- THE double-booking guard: at most one non-cancelled booking per slot,
-- enforced by the database no matter how requests race.
create unique index bookings_one_active_per_slot
  on public.bookings (slot_id)
  where status <> 'cancelled';

create index bookings_vendor_idx on public.bookings (vendor_id);

create table public.event_invites (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events (id) on delete cascade,
  vendor_email text not null check (vendor_email = lower(vendor_email)),
  token        text not null unique default encode(gen_random_bytes(24), 'hex'),
  created_at   timestamptz not null default now(),
  unique (event_id, vendor_email)
);

create table public.gate_list_tokens (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events (id) on delete cascade,
  token      text not null unique default encode(gen_random_bytes(24), 'hex'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- Creating a venue automatically makes the creator an admin member.
create or replace function public.handle_new_venue()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.venue_members (venue_id, user_id, role)
  values (new.id, new.created_by, 'admin');
  return new;
end;
$$;

create trigger on_venue_created
  after insert on public.venues
  for each row execute function public.handle_new_venue();

-- Bookings may only be created against open slots of published events.
-- (The unique index above handles races; this handles stale UIs pointing at
-- blocked slots or draft events.)
create or replace function public.check_booking_slot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot_status text;
  v_event_status text;
begin
  select s.status, e.status into v_slot_status, v_event_status
    from public.slots s
    join public.events e on e.id = s.event_id
   where s.id = new.slot_id
     for update of s;

  if v_slot_status is null then
    raise exception 'slot not found';
  end if;
  if v_event_status <> 'published' then
    raise exception 'event is not open for booking';
  end if;
  if v_slot_status = 'blocked' then
    raise exception 'slot is blocked';
  end if;
  return new;
end;
$$;

create trigger before_booking_insert
  before insert on public.bookings
  for each row execute function public.check_booking_slot();

-- Keep slots.status in sync with the active booking.
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

-- ---------------------------------------------------------------------------
-- RLS helper functions (security definer so policies never recurse)
-- ---------------------------------------------------------------------------

create or replace function public.is_venue_admin(p_venue_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.venue_members
     where venue_id = p_venue_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_event_admin(p_event_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
      from public.events e
      join public.venue_members m on m.venue_id = e.venue_id
     where e.id = p_event_id and m.user_id = auth.uid()
  );
$$;

-- The signed-in user's email, lowercased, from the JWT.
create or replace function public.current_email()
returns text
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

create or replace function public.is_invited_to_event(p_event_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.event_invites
     where event_id = p_event_id and vendor_email = public.current_email()
  );
$$;

-- Vendor can see an event if they are invited and it isn't a draft.
-- (Completed events stay visible so past bookings render; the booking
-- trigger separately restricts *booking* to published events only.)
create or replace function public.can_vendor_see_event(p_event_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.events e
     where e.id = p_event_id
       and e.status <> 'draft'
       and public.is_invited_to_event(e.id)
  );
$$;

create or replace function public.is_own_vendor(p_vendor_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.vendors where id = p_vendor_id and user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.venues enable row level security;
alter table public.venue_members enable row level security;
alter table public.docks enable row level security;
alter table public.events enable row level security;
alter table public.slots enable row level security;
alter table public.vendors enable row level security;
alter table public.bookings enable row level security;
alter table public.event_invites enable row level security;
alter table public.gate_list_tokens enable row level security;

-- venues
create policy "admins read their venues" on public.venues
  for select using (public.is_venue_admin(id));
create policy "authenticated users create venues" on public.venues
  for insert with check (auth.uid() = created_by);
create policy "admins update their venues" on public.venues
  for update using (public.is_venue_admin(id));
-- Vendors need venue details (name, address, timezone, approval + cutoff
-- settings) for events they can see.
create policy "invited vendors read venues" on public.venues
  for select using (
    exists (
      select 1 from public.events e
       where e.venue_id = venues.id
         and public.can_vendor_see_event(e.id)
    )
  );

-- venue_members
create policy "members read own memberships" on public.venue_members
  for select using (user_id = auth.uid());

-- docks: admins manage; invited vendors may read dock names for published events
create policy "admins manage docks" on public.docks
  for all using (public.is_venue_admin(venue_id));
create policy "invited vendors read docks" on public.docks
  for select using (
    exists (
      select 1 from public.events e
       where e.venue_id = docks.venue_id
         and public.can_vendor_see_event(e.id)
    )
  );

-- events
create policy "admins manage events" on public.events
  for all using (public.is_venue_admin(venue_id));
create policy "invited vendors read published events" on public.events
  for select using (public.can_vendor_see_event(id));

-- slots
create policy "admins manage slots" on public.slots
  for all using (public.is_event_admin(event_id));
create policy "invited vendors read slots" on public.slots
  for select using (public.can_vendor_see_event(event_id));

-- vendors
create policy "vendors manage own profile" on public.vendors
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "admins read vendors booked at their venue" on public.vendors
  for select using (
    exists (
      select 1
        from public.bookings b
        join public.slots s on s.id = b.slot_id
       where b.vendor_id = vendors.id
         and public.is_event_admin(s.event_id)
    )
  );

-- bookings
create policy "vendors read own bookings" on public.bookings
  for select using (public.is_own_vendor(vendor_id));
create policy "vendors create own bookings" on public.bookings
  for insert with check (
    public.is_own_vendor(vendor_id)
    and public.can_vendor_see_event((select event_id from public.slots where id = slot_id))
  );
create policy "vendors update own bookings" on public.bookings
  for update using (public.is_own_vendor(vendor_id));
create policy "admins manage bookings at their venue" on public.bookings
  for all using (
    public.is_event_admin((select event_id from public.slots where id = slot_id))
  );

-- event_invites
create policy "admins manage invites" on public.event_invites
  for all using (public.is_event_admin(event_id));
create policy "vendors read own invites" on public.event_invites
  for select using (vendor_email = public.current_email());

-- gate_list_tokens (the public gate page reads via the service role, which bypasses RLS)
create policy "admins manage gate tokens" on public.gate_list_tokens
  for all using (public.is_event_admin(event_id));
