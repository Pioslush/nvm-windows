# Dock Delivery

**Stop double-booking your dock.** Warehouses and distribution centers set
weekly dock availability, carriers book open slots any time, and security
gets an always-current, read-only dock manifest.

- **Facility admins** set up docks, define recurring weekly availability
  (auto-generates bookable slots), invite carriers, approve bookings, run
  the day-of dashboard, and share a dock manifest link.
- **Carriers** (free) open an invite link once, then can always come back
  and book any open slot at that facility — reschedule, cancel, or tap
  "I'm running late."
- **Security** opens a tokenized, read-only, phone-friendly dock manifest
  showing today's confirmed deliveries — no login.

Built with Next.js (App Router) + TypeScript + Tailwind, Supabase (Postgres +
RLS + magic-link auth), and Resend for email. Deploys to Vercel.

Forked from [GameDay Dock](../gameday-dock/) (event-scoped, sports-venue
dock booking) and redesigned for continuous scheduling — see
[PHASES.md](PHASES.md) for what changed and why.

---

## Quick start (local)

### 1. Create a Supabase project

A project named **Dock Delivery** (`hxcfoheddkpwaikiuonx`, region
`us-east-2`) already exists in the Pioslush org with both migrations applied
— skip straight to step 2 and use its connection details below if that's the
one you're using. To set up a different project instead:

1. Go to [supabase.com](https://supabase.com) → New project (free tier is fine).
2. In the dashboard, open **SQL Editor** and run the migrations **in order**:
   [`0001_schema.sql`](supabase/migrations/0001_schema.sql) (every table,
   trigger, and RLS policy), then
   [`0002_tighten_function_grants.sql`](supabase/migrations/0002_tighten_function_grants.sql)
   (revoke direct RPC access to internal RLS-helper/trigger functions from
   `anon`/unauthenticated callers — every `CREATE FUNCTION` gets an implicit
   `PUBLIC` execute grant by default, which this migration removes before
   granting back only what `authenticated` needs for RLS policies to work).
3. **Authentication → URL Configuration**: set *Site URL* to
   `http://localhost:3000` and add `http://localhost:3000/auth/callback` to
   *Redirect URLs*. (Add your production URL here too when you deploy.)

**Connection details for the existing Dock Delivery project:**
```
NEXT_PUBLIC_SUPABASE_URL=https://hxcfoheddkpwaikiuonx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh4Y2ZvaGVkZGtwd2Fpa2l1b254Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcxNjQ4MzAsImV4cCI6MjEwMjc0MDgzMH0.RrAFH_FTwyQTg5im2NG5CsIKJTFp6J-uI9FEW8dMoRg
```
The **service role key** is secret and not written here — grab it yourself
from the Supabase dashboard → Project Settings → API → `service_role` secret,
and put it only in `.env.local` (never commit it).

### 2. Configure the app

```bash
cd dock-delivery
npm install
cp .env.example .env.local   # then fill it in
```

Fill `.env.local` from **Project Settings → API** in Supabase. `RESEND_API_KEY`
is optional locally — without it, every email is printed to the terminal
running the dev server, which is actually convenient for testing magic links
aside, Supabase sends those itself.

### 3. Seed demo data (optional but recommended)

```bash
npm run seed
```

Creates **Demo Distribution Center** (1 facility, 2 docks, weekly
availability 7 days a week 8am–6pm, ~7 days of generated slots, 3 carriers,
2 bookings, a dock manifest link). Demo accounts — sign in with a magic
link to any of:

| Email | Role |
|---|---|
| `admin@demo.dockdelivery.test` | Facility admin |
| `freight@demo.dockdelivery.test` | Carrier, confirmed booking |
| `pallet@demo.dockdelivery.test` | Carrier, pending booking |
| `produce@demo.dockdelivery.test` | Invited carrier, hasn't booked |

> Magic links for `.test` addresses obviously won't deliver — in the Supabase
> dashboard use **Authentication → Users → … → Send magic link**, or grab the
> link from **Logs**. For real testing, seed is optional: just sign up with
> your real email.

### 4. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Tests

```bash
npm run test:db
```

Spins up a **throwaway local PostgreSQL cluster** (needs `postgresql`
installed), applies the real migration, and proves — among other things —
that **two simultaneous bookings for the same slot can never both succeed**
(including a 50-way concurrent stampede test). The guarantee is a partial
unique index in the database, not application logic, so it holds no matter
how requests race.

---

## Deploying to Vercel

Roughly half a day, most of it waiting on DNS. Steps 1–4 can be done in any
order; step 5 is the gate.

**1. Import the repo.** In Vercel, import this repository and set the
project's **Root Directory** to `dock-delivery`. Don't deploy yet — it will
build, but every page needing the service role will 500 until step 2.

**2. Set environment variables** (Vercel → Project → Settings →
Environment Variables). All of these come from Supabase → Project Settings →
API, except the last three:

| Variable | Where it comes from | Required? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → API → Project URL | **Yes** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → API → `anon` public key | **Yes** |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → API → `service_role` **secret** | **Yes** |
| `NEXT_PUBLIC_APP_URL` | Your production URL, no trailing slash | Yes in prod |
| `CRON_SECRET` | Any random string you generate | Yes in prod |
| `RESEND_API_KEY` | Resend → API Keys | Optional* |
| `EMAIL_FROM` | e.g. `Dock Delivery <dock@yourdomain.com>` | Optional* |

\* Without a Resend key the app still works — emails print to the server log
instead of being delivered. Fine for a first demo, not for a pilot.

> **The service role key is a secret.** It bypasses every RLS policy. It
> belongs in Vercel's environment variables and `.env.local` only — never in
> the repo, never in a `NEXT_PUBLIC_*` variable.

**3. Point Supabase at the deployed URL.** Supabase → Authentication → URL
Configuration → set *Site URL* to your production URL and add
`https://YOUR-URL/auth/callback` to *Redirect URLs*. Skipping this makes
magic-link sign-in bounce back to localhost.

**4. Verify your Resend sending domain** (skip if you're demoing without
email), then set `RESEND_API_KEY` and `EMAIL_FROM`.

**5. Check the config before you ship.** Pull the production variables down
and run the pre-flight — it verifies every variable is present *and* that
the service-role key actually authenticates against the project:

```bash
vercel env pull .env.production.local
npm run preflight
```

It exits non-zero and names what's wrong. A missing key and a wrong key look
identical at runtime (an opaque 500 on the manifest page); this tells them
apart before a prospect sees either.

**6. Deploy**, then seed a demo facility so there's something to click
through on a call:

```bash
npm run seed
```

`vercel.json` schedules two crons automatically: `/api/cron/reminders`
(hourly — sends each booking's reminder once, ~24h before its slot) and
`/api/cron/generate-slots` (daily — keeps every dock's rolling ~21-day slot
horizon topped up from its weekly availability template).

**7. Walk the demo path once yourself, on a phone**, before you show anyone:
set a dock's weekly hours → confirm slots appear → open the invite link in a
private window → book a slot → try to book it again → open the manifest
link. That's the whole pitch, and it takes four minutes to confirm.

## How it fits together

```
app/
  (admin)/          Facility admin: schedule (date-picker bookings view),
                    docks/[id] (weekly availability + slot grid), today
                    (day-of dashboard), carriers (invite management),
                    settings
  carrier/          Carrier: my deliveries, profile,
                    facilities/[id] (slot picker, day-grouped)
  invite/[token]/   Invite landing (works before the carrier has an account)
  manifest/[token]/ Public read-only dock manifest for security — always
                    shows today's confirmed deliveries
  api/cron/         Reminder emails + rolling slot generation (Vercel Cron)
  actions/          All server actions (admin.ts, carrier.ts)
lib/                Supabase clients, auth helpers, time/timezone, email,
                    slot generation
supabase/migrations/  Schema, triggers, and RLS policies — the source of truth
scripts/            seed.ts (demo data), test-db.sh (throwaway-Postgres tests)
tests/              Double-booking + RLS acceptance tests
```

Security model in one paragraph: admins and carriers use Supabase magic-link
auth, and **every** table is protected by Row Level Security — admins only
see their facility's data; carriers only see facilities they were invited to
(matched on their signed-in email) and their own bookings. The two loginless
surfaces (invite links, the dock manifest) are authorized by unguessable
tokens and read through the server-side service role; the manifest shows a
friendly error — never data — for an invalid or expired token. Double-booking
is impossible at the database level via a partial unique index on active
bookings per slot.

## What changed from GameDay Dock

GameDay Dock scoped everything through a single-day "event" (one load-in
window, drafted then published, slots generated once for that window).
Warehouses need continuous, ongoing scheduling instead — so this fork
replaces the event model with a **recurring weekly availability template**
per dock (`dock_availability`), from which concrete `slots` rows are
materialized on a rolling ~21-day horizon (immediately when an admin saves
availability, and daily via cron to keep the window topped up). Invites
became a **standing carrier↔facility relationship** (`facility_invites`)
instead of a one-event invite, and the gate list became a **facility-scoped
dock manifest** that always shows "today" rather than a token tied to one
event's end. Everything else — the double-booking guarantee, the email
graceful-degradation pattern, the three Supabase clients, the server-action
pattern, the reminder cron — carried over unchanged. See
[PHASES.md](PHASES.md) for the full detail.

## Product decisions made during the build

- **Approval default: ON** (`require_approval = true`). Safer first
  impression for a facility; one tap to turn off in Settings.
- **Slot interval default: 30 min**, 60 also a one-tap choice per dock.
- **Slot horizon: 21 days rolling.** Generated synchronously when an admin
  saves availability, extended daily by cron. Long enough for carriers to
  plan ahead, short enough that a changed availability template doesn't
  leave months of stale slots to clean up.
- **Booking horizon shown to carriers: 14 days**, grouped by date then dock
  (continuous scheduling has far more open slots than one event's window
  did — a flat list alone would be overwhelming).
- **Dock manifest is facility-scoped, not per-day.** One link stays useful
  indefinitely (90-day rolling expiry, revocable) since it always filters to
  "today" at render time.
- **Reschedule order**: new slot is booked *first*, then the old booking is
  cancelled — losing a race never costs the carrier their original slot.
- **Stripe is stubbed** as `facilities.stripe_customer_id` + a "free during
  the pilot" billing card in Settings. No checkout in P0.
