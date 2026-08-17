# GameDay Dock

**"OpenTable for loading docks."** Sports venues publish dock slots for each
event, vendors book them, everyone gets confirmations, and security gets an
auto-generated gate list.

- **Venue admins** create events, generate dock slots, invite vendors, approve
  bookings, run the day-of dashboard, and share a gate list link.
- **Vendors** (free) open an invite link, pick a slot, get a confirmation
  email, and can reschedule, cancel, or tap "I'm running late."
- **Security** opens a tokenized, read-only, phone-friendly gate list — no login.

Built with Next.js (App Router) + TypeScript + Tailwind, Supabase (Postgres +
RLS + magic-link auth), and Resend for email. Deploys to Vercel.

---

## Quick start (local)

### 1. Create a Supabase project

A project named **GameDay Dock** (`zvquhcsltzvtpmvbperh`, region `us-east-2`)
already exists in the Pioslush org with all three migrations applied — skip
straight to step 2 and use its connection details below if that's the one
you're using. To set up a different project instead:

1. Go to [supabase.com](https://supabase.com) → New project (free tier is fine).
2. In the dashboard, open **SQL Editor** and run the migrations **in order**:
   [`0001_schema.sql`](supabase/migrations/0001_schema.sql) (every table,
   trigger, and RLS policy), then
   [`0002_tighten_function_grants.sql`](supabase/migrations/0002_tighten_function_grants.sql)
   and
   [`0003_tighten_function_grants_fix.sql`](supabase/migrations/0003_tighten_function_grants_fix.sql)
   (revoke direct RPC access to internal RLS-helper/trigger functions from
   `anon` — 0002 targets the `PUBLIC` pseudo-role, which Supabase's default
   privileges don't route through, so 0003 is the fix that actually takes
   effect; both are kept for an accurate migration history).
3. **Authentication → URL Configuration**: set *Site URL* to
   `http://localhost:3000` and add `http://localhost:3000/auth/callback` to
   *Redirect URLs*. (Add your production URL here too when you deploy.)

**Connection details for the existing GameDay Dock project:**
```
NEXT_PUBLIC_SUPABASE_URL=https://zvquhcsltzvtpmvbperh.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp2cXVoY3NsdHp2dHBtdmJwZXJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4MzM0MTUsImV4cCI6MjEwMjQwOTQxNX0.fdpBb6O8AbCN0i3VBZdMo2a6sxe9Mx6RNrBOrKnyFwo
```
The **service role key** is secret and not written here — grab it yourself
from the Supabase dashboard → Project Settings → API → `service_role` secret,
and put it only in `.env.local` (never commit it).

### 2. Configure the app

```bash
cd gameday-dock
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

Creates **Demo Field** (1 venue, 2 docks, 1 published event tomorrow, 6 slots,
3 vendors, 2 bookings, a gate list link). Demo accounts — sign in with a magic
link to any of:

| Email | Role |
|---|---|
| `admin@demo.gamedaydock.test` | Venue admin |
| `beer@demo.gamedaydock.test` | Vendor, confirmed booking |
| `merch@demo.gamedaydock.test` | Vendor, pending booking |
| `tv@demo.gamedaydock.test` | Invited vendor, hasn't booked |

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

Spins up a **throwaway local PostgreSQL cluster** (needs `postgresql` installed),
applies the real migration, and proves — among other things — that **two
simultaneous bookings for the same slot can never both succeed** (including a
50-way concurrent stampede test). The guarantee is a partial unique index in
the database, not application logic, so it holds no matter how requests race.

---

## Deploying to Vercel

1. Push this repo to GitHub and import it in Vercel. Set the project's
   **Root Directory** to `gameday-dock`.
2. Add the env vars from `.env.example` in Vercel → Project → Settings →
   Environment Variables. Set `NEXT_PUBLIC_APP_URL` to your production URL
   (e.g. `https://dock.yourdomain.com`) and set a random `CRON_SECRET`.
3. In Supabase **Authentication → URL Configuration**, add
   `https://YOUR-URL/auth/callback` to Redirect URLs and update the Site URL.
4. In [Resend](https://resend.com), verify your sending domain and set
   `RESEND_API_KEY` + `EMAIL_FROM`.
5. Deploy. `vercel.json` schedules the reminder email cron
   (`/api/cron/reminders`, hourly — sends each booking's reminder once, ~24h
   before its slot).

## How it fits together

```
app/
  (admin)/          Venue admin: dashboard (events), events/[id], docks,
                    today (day-of dashboard), settings
  vendor/           Vendor: my deliveries, profile, events/[id] slot booking
  invite/[token]/   Invite landing (works before the vendor has an account)
  gate/[token]/     Public read-only gate list for security
  api/cron/         Reminder emails (Vercel Cron)
  actions/          All server actions (admin.ts, vendor.ts)
lib/                Supabase clients, auth helpers, time/timezone, email
supabase/migrations/  Schema, triggers, and RLS policies — the source of truth
scripts/            seed.ts (demo data), test-db.sh (throwaway-Postgres tests)
tests/              Double-booking + booking-rules DB tests
```

Security model in one paragraph: admins and vendors use Supabase magic-link
auth, and **every** table is protected by Row Level Security — admins only see
their venue's data; vendors only see published events they were invited to
(matched on their signed-in email) and their own bookings. The two loginless
surfaces (invite links, gate lists) are authorized by unguessable tokens and
read through the server-side service role; the gate list shows a friendly
error — never data — for an invalid or expired token. Double-booking is
impossible at the database level via a partial unique index on active
bookings per slot.

## Product decisions made during the build

See [PHASES.md](PHASES.md) for the full phase-by-phase report. Highlights the
founder should know (all flagged in §11 of the spec as open questions, or
gaps the spec didn't cover):

- **Approval default: ON** (`require_approval = true`). Safer first
  impression for a venue; one tap to turn off in Settings.
- **Slot interval default: 30 min** preselected on the event form; 60 also a
  one-tap choice. Change the default after talking to the first ops manager.
- **Broadcast trucks**: not specially handled (per spec — flagged as a likely
  P1 "all-day dock assignment"). Workaround today: block a dock's slots and
  handle the truck manually, or invite them to book the first slot.
- **Venue address field added** (not in the spec's data model) because
  confirmation emails must include the venue address.
- **`reminded_at` column added** to bookings so the reminder cron is
  idempotent (no duplicate reminder emails).
- **Reschedule order**: new slot is booked *first*, then the old booking is
  cancelled — losing a race never costs the vendor their original slot.
- **Stripe is stubbed** as `venues.stripe_customer_id` + a "free during the
  pilot" billing card in Settings. No checkout in P0, per spec.
