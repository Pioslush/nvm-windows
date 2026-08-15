# Build report — phase by phase

Per the build spec: what was built, how to test it manually in 5 minutes, and
decisions made. All five phases are complete.

---

## Phase 1 — Skeleton

**Built:** Next.js (App Router, TS, Tailwind) app in `gameday-dock/`; full
Supabase schema with triggers and RLS (`supabase/migrations/0001_schema.sql`);
magic-link auth (login page, `/auth/callback`, session-refresh proxy); venue
creation onboarding; seed script (1 venue, 2 docks, 1 published event, 6
slots, 3 vendors + invites, 2 bookings, gate link).

**Test in 5 minutes:** Apply the migration in the Supabase SQL editor → `npm
run seed` → `npm run dev` → open `/login`, sign in with your real email → you
land on `/welcome` → "I run a venue" → create a venue → you're on the admin
dashboard. Check Supabase's Table Editor: `venue_members` has your row
(created by trigger).

**Decisions:**
- Added `venues.address` (emails need it), `venues.require_approval`,
  `venues.cancellation_cutoff_hours` (both are spec'd venue-level settings and
  needed a home), and `bookings.reminded_at` (reminder idempotency).
- Vendor↔event visibility is matched on the **signed-in email = invited
  email** (lowercased), enforced in RLS via the JWT — invites work before the
  account exists, with no state hand-off needed at signup.
- One venue per admin account in the UI (P2 explicitly defers multi-venue
  orgs; the schema — `venue_members` join table — already supports more).

## Phase 2 — Admin core

**Built:** Admin shell + nav; Events dashboard; Docks page (create/remove,
notes); New event form (date, load-in window, 30/60-min interval,
dock picker) with slot auto-generation; event detail page with per-dock slot
grid (tap to block/unblock), publish/complete controls, invite-by-email flow
(sends tokenized invite email), pending-approval queue, and gate-link
management; Settings (venue info, timezone, **require approval** toggle,
cancellation cutoff).

**Test in 5 minutes:** Docks → add "Dock A — North" with a truck-size note →
Events → New event tomorrow, 8:00–12:00, 30-min slots → see the slot grid (8
per dock) → tap one slot to block it → Publish event → invite yourself at a
second email address → check the invite email (terminal, if no Resend key).

**Decisions:**
- Slots are generated at event creation for the chosen docks; a load-in window
  that ends past midnight (e.g. 22:00–01:00) rolls to the next day.
- Blocking is a toggle on open slots only; a booked slot must have its booking
  declined first (prevents silently stranding a vendor).
- The gate token expires 24h after load-in ends and can be revoked/regenerated.

## Phase 3 — Vendor core

**Built:** Invite landing `/invite/[token]` (friendly invalid-token page;
sign-in hand-off preserving destination; wrong-account guard; profile-first
redirect); vendor profile (company, contact, phone, vehicle, plate); slot
picker grouped by dock with purpose field; instant confirmation email (dock
name, time in venue TZ, venue address, dock notes); cancel + reschedule with
venue-configured cutoff (default 12h); double-booking protection.

**Test in 5 minutes:** Open the invite link from Phase 2 in a private window →
sign in as the invited email → fill the vendor profile → pick a slot → book →
confirmation email arrives (or prints to terminal) → open the same event in
the admin tab: the slot shows the company name. Try booking the same slot from
a second vendor account: "no longer available" and the list refreshes.

**The proof:** `npm run test:db` spins up a throwaway Postgres, applies the
real migration, and runs 6 tests, including two simultaneous inserts and a
50-way stampede — exactly one booking ever wins. The guard is the partial
unique index `bookings_one_active_per_slot` (`slot_id` where status ≠
'cancelled'), so the guarantee is the database's, not the app's.

**Decisions:**
- Booking status honors the venue's approval setting: `pending` (approval
  required, default) or instantly `confirmed`.
- Reschedule books the new slot **before** cancelling the old one — a lost
  race never costs the vendor their original slot.
- Within the cutoff window the UI removes cancel/reschedule and tells the
  vendor to call the venue; the server action enforces it too.

## Phase 4 — Game day

**Built:** `/today` day-of dashboard — today's bookings (venue-timezone
"today"), chronological per dock, big status chips, one-tap transitions
(Check in / Late / No-show / Undo), 30s auto-refresh; vendor "🕐 I'm running
late" button (appears within 24h of the slot) that flags the booking and
emails the admin; `/gate/[token]` — public, mobile-first, high-contrast gate
list (company, contact, phone, vehicle, plate, dock, window), live statuses,
60s auto-refresh, and a friendly error — never data — for invalid/expired
tokens.

**Test in 5 minutes:** Seed data has an event *tomorrow* — either create one
for today or nudge the seeded event's date. Admin → Today: bookings appear per
dock → tap "✓ Check in" on one → chip flips blue. Vendor tab → "I'm running
late" → admin email arrives + Today shows the orange Late chip within 30s.
Open the gate link from the event page in a private window: no login, readable
at arm's length. Change the token's last character: friendly error.

**Decisions:**
- Gate list shows only confirmed / checked-in / late bookings (security cares
  about who's coming, not pending requests or no-shows).
- "Running late" is offered within 24h of the slot start; after check-in it
  disappears.
- Polling refresh (30/60s) instead of websockets — plenty for P0, zero infra.

## Phase 5 — Polish

**Built:** Reminder emails ~24h before each slot via `/api/cron/reminders`
(Vercel Cron hourly, `CRON_SECRET`-protected, idempotent via `reminded_at`);
empty states on every list page; mobile pass (44px+ touch targets, sticky
readable layouts, gate list tuned for sunlight — dark-on-white, extra-bold
type); `.env.example`, deploy docs in README; lint + prod build clean.

**Test in 5 minutes:** `curl -H "Authorization: Bearer $CRON_SECRET"
localhost:3000/api/cron/reminders` → `{"checked":N,"sent":N}`, reminder email
per upcoming booking; run again → `sent: 0` (idempotent). Resize any page to
375px width: no horizontal scroll, everything tappable.

**Decisions:**
- Reminders also go to `pending` bookings (vendor still plans to show up;
  the email nudges the venue decision too).
- Emails without `RESEND_API_KEY` print to the console rather than failing —
  local dev stays fully walkable.

---

## What's deliberately NOT here (per spec)

- **P1:** Stripe checkout (stubbed: `stripe_customer_id` column + billing
  card), Twilio SMS, recurring event templates, analytics, CSV export.
- **P2 (not architected against):** multi-venue orgs (schema ready via
  `venue_members`), credential uploads, public API, QR check-in.
- **Non-goals:** native apps, vendor payments, ticketing/staffing/parking,
  calendar sync.

## Known limits worth knowing (founder honesty section)

- One venue per admin account in the UI; a second "create venue" is hidden
  once you have one.
- Admin notification emails go to the venue **creator's** email.
- The seed script's `.test` emails can't receive real mail — use the Supabase
  dashboard to trigger magic links for them, or test with real addresses.
- Invite emails are personal: forwarding one lets the recipient *view* the
  landing page, but booking requires signing in with the invited email.
