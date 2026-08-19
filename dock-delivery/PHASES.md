# Build report — GameDay Dock → Dock Delivery fork

Per the pivot brief: outsourced dock/delivery scheduling for warehouses,
distribution centers, and event venues, flat monthly fee per site/dock. This
document covers the MVP build (Phase 1 of the 12-week business plan) — the
custom scheduling app itself, forked and redesigned from GameDay Dock rather
than built from scratch, since the two products share almost everything
except the event concept.

---

## What carried over unchanged

Explored the full GameDay Dock codebase (schema, RLS, every page, server
actions, lib helpers, tests) before touching anything. Verdict: **`events`
was the only concept that didn't transfer.** Everything else needed at most
a rename:

- The double-booking guard (`bookings_one_active_per_slot`, a partial unique
  index on `slot_id`) — already slot-scoped only, zero event dependency.
- `sync_slot_status()` — already slot/booking-scoped only.
- All three Supabase clients (`lib/supabase/{admin,client,server}.ts`).
- The `"use server" → requireAdminX() → createClient() → mutate →
  revalidatePath()` server-action pattern, used ~19 times.
- The email graceful-degradation pattern (`lib/email.ts` — no
  `RESEND_API_KEY` means console-log, never throws).
- The reminder cron's query — already `bookings → slots.start_time` only,
  no event join.
- `lib/time.ts`'s timezone toolkit — exactly what recurring-slot generation
  needs.

## What changed

`events` was a hard FK pivot: 3 tables referenced it directly
(`slots`, `event_invites`, `gate_list_tokens`), 2 RLS helper functions
existed only to route through it (`is_event_admin`, `can_vendor_see_event`),
7 RLS policies across 6 tables depended on it, and the booking-eligibility
trigger hard-checked `event.status = 'published'`.

Replaced with a **recurring weekly availability template** per dock:

- **New `dock_availability` table** — day-of-week + time range + slot
  interval, one row per (dock, day). Admins set this once per dock instead
  of creating an event for every delivery window.
- **`slots` drops `event_id`**, scoped directly to `dock_id` with a new
  `unique(dock_id, start_time)` constraint.
- **New `lib/slots.ts`** (`generateSlotsForDock`) — materializes concrete
  slot rows from the availability template on a rolling 21-day horizon,
  idempotent via the new unique constraint (`upsert ... ignoreDuplicates`).
  Runs synchronously when an admin saves availability, and daily via a new
  `/api/cron/generate-slots` route to keep the window topped up.
- **`check_booking_slot()` trigger** drops the event-status check, adds a
  new "slot is in the past" rejection (there's no draft/publish gate
  anymore to prevent booking stale slots).
- **`event_invites` → `facility_invites`** — a standing carrier↔facility
  relationship instead of a one-event invite. Once invited, a carrier can
  always come back and book any open slot at that facility.
- **`gate_list_tokens` → `dock_manifest_tokens`** — facility-scoped instead
  of event-scoped. The manifest page filters to "today" (facility timezone)
  at render time, so one link stays useful indefinitely instead of expiring
  24h after one event's load-in window.
- **RLS got simpler**, not more complex: `facility_id` is now a direct or
  one-hop FK everywhere it used to require routing through an event row
  (e.g. the carrier-read policy on `facilities` went from a 3-line
  `exists(...events...)` subquery to `is_invited_to_facility(id)` directly).

### Domain rename

| GameDay Dock | Dock Delivery |
|---|---|
| `venues` / `venue_members` | `facilities` / `facility_members` |
| `vendors` | `carriers` |
| `events` | *(removed — see above)* |
| `event_invites` | `facility_invites` |
| `gate_list_tokens` | `dock_manifest_tokens` |

### UI restructuring

- `dashboard` (event list) → **`schedule`** (date-picker view of bookings
  across all docks, global pending-approval queue) — the new admin landing
  page.
- `events/new` → **`docks/[id]` availability form** (weekly day/hour/interval
  picker, replacing one-off event creation).
- `events/[id]` → **`docks/[id]`** (availability template + 7-day slot grid,
  block/unblock reused almost as-is) + a new **`carriers`** page (invite
  management, now facility-scoped rather than embedded per-event).
- `today` got *simpler* — drops the "find today's event" indirection,
  queries bookings by `slot.start_time` directly.
- `vendor/events/[id]` → **`carrier/facilities/[id]`** — now shows a
  14-day booking horizon, so the slot picker gained **date grouping**
  (date tabs, then dock groups within a date) since a flat list of a
  facility's open slots across two weeks would be overwhelming otherwise.
  GameDay's single-event window never needed this.

---

## Grant-hardening gotcha (worth recording)

Applying the RLS-helper function grant migration, the Supabase security
advisor still flagged every function as `anon`-executable after the revoke.
Queried `pg_proc.proacl` directly (same diagnostic GameDay Dock's own
postmortem used) and found the real permissive grant wasn't a named
`anon`/`authenticated` grant like GameDay had — it was Postgres' **implicit
`PUBLIC` execute grant** that every `CREATE FUNCTION` gets by default
(the bare `=X/postgres` ACL entry). `revoke ... from anon, authenticated`
did nothing because neither role held an explicit grant to revoke; the fix
was `revoke ... from public`, then `grant ... to authenticated` explicitly
for the 4 functions RLS policies actually call. Verified via
`has_function_privilege('anon'/'authenticated', oid, 'EXECUTE')` against the
live project: `anon` has zero execute access on any of the 7 functions,
`authenticated` has it only on the 4 RLS helpers, not the 3 trigger
functions (which only Postgres' trigger machinery ever needs to invoke).

---

## Verified

- `npm run lint` — clean.
- `npm run build` — clean production build, all 19 expected routes present.
- `npx tsc --noEmit` — clean across app/lib/scripts/tests.
- `npm run test:db` — 14/14 tests passing against a throwaway Postgres with
  the real migration applied: 7 double-booking/concurrency tests (including
  a 50-way stampede, plus new past-slot and blocked-slot rejection cases)
  and 7 RLS acceptance tests (facility isolation, carrier invite gating,
  own-booking-only visibility, admin-sees-own-facility-only).
- Both migrations applied to the live Supabase project
  (`hxcfoheddkpwaikiuonx`), confirmed via `pg_proc.proacl` that grants
  landed correctly (see gotcha above).

## What's deliberately NOT here (per the 12-week plan)

- **Phase 1 remainder**: a friendly first-tester deployment/walkthrough,
  the ops SOP, and the pricing sheet are separate deliverables (not code) —
  see the docs handed over alongside this app.
- **Phase 2–4**: target list, outbound sequence, CRM tracker, pilot metrics
  dashboard, case study, referral outreach, pricing refinement — all
  business/sales-motion deliverables, not part of this codebase.
- **Stripe checkout** (stubbed: `stripe_customer_id` column + billing card).
  No checkout in P0.
- **Multi-facility orgs** (schema ready via `facility_members`, one facility
  per admin account in the UI, same as GameDay Dock's P2 deferral).
