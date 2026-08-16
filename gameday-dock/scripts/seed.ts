/**
 * Seeds a Supabase project with demo data:
 *   1 venue · 2 docks · 1 published event (tomorrow) · 6 slots · 3 vendors
 *   + invites for all vendors and 2 bookings so every screen has content.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed
 * (or put those in .env.local — this script loads it automatically)
 *
 * Demo logins (magic link still required — use these emails):
 *   admin@demo.gamedaydock.test   → venue admin
 *   beer@demo.gamedaydock.test    → vendor with a confirmed booking
 *   merch@demo.gamedaydock.test   → vendor with a pending booking
 *   tv@demo.gamedaydock.test      → invited vendor, no booking yet
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.example)");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

async function ensureUser(email: string): Promise<string> {
  const { data: created, error } = await db.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (created?.user) return created.user.id;
  if (error && /already/i.test(error.message)) {
    const { data } = await db.auth.admin.listUsers();
    const existing = data.users.find((u) => u.email === email);
    if (existing) return existing.id;
  }
  throw error ?? new Error(`could not create user ${email}`);
}

async function main() {
  console.log("Seeding demo data…");

  const adminId = await ensureUser("admin@demo.gamedaydock.test");

  const { data: venue, error: venueError } = await db
    .from("venues")
    .insert({
      name: "Demo Field",
      city: "Colorado Springs, CO",
      address: "111 W Cimarron St, Colorado Springs, CO 80903",
      timezone: "America/Denver",
      require_approval: true,
      created_by: adminId,
    })
    .select()
    .single();
  if (venueError) throw venueError;

  const { data: docks, error: dockError } = await db
    .from("docks")
    .insert([
      { venue_id: venue.id, name: "Dock A — North", notes: "Max 26' box truck. Clearance 12'6\"." },
      { venue_id: venue.id, name: "Dock B — South", notes: "Semis OK. Check in with gate 3 first." },
    ])
    .select();
  if (dockError) throw dockError;

  // Event tomorrow with a 9:00–10:30 AM load-in window (venue local time).
  const tomorrow = new Date(Date.now() + 24 * 36e5);
  const dateStr = tomorrow.toISOString().slice(0, 10);
  const { fromZonedTime } = await import("date-fns-tz");
  const start = fromZonedTime(`${dateStr}T09:00:00`, venue.timezone);
  const end = fromZonedTime(`${dateStr}T10:30:00`, venue.timezone);

  const { data: event, error: eventError } = await db
    .from("events")
    .insert({
      venue_id: venue.id,
      name: "Demo FC vs. Rival City",
      event_date: dateStr,
      load_in_start: start.toISOString(),
      load_in_end: end.toISOString(),
      status: "published",
    })
    .select()
    .single();
  if (eventError) throw eventError;

  // 6 slots: 3 half-hour slots per dock.
  const slotRows = docks!.flatMap((dock) =>
    [0, 30, 60].map((offset) => ({
      event_id: event.id,
      dock_id: dock.id,
      start_time: new Date(start.getTime() + offset * 6e4).toISOString(),
      end_time: new Date(start.getTime() + (offset + 30) * 6e4).toISOString(),
    }))
  );
  const { data: slots, error: slotError } = await db.from("slots").insert(slotRows).select();
  if (slotError) throw slotError;

  const vendorSpecs = [
    { email: "beer@demo.gamedaydock.test", company: "Peak Beverage Co.", contact: "Sam Rivera", vehicle: "Box truck", plate: "COL-4821" },
    { email: "merch@demo.gamedaydock.test", company: "Sideline Merch LLC", contact: "Jordan Lee", vehicle: "Sprinter van", plate: "COL-1177" },
    { email: "tv@demo.gamedaydock.test", company: "Rocky Mtn Broadcast", contact: "Casey Fox", vehicle: "Production truck", plate: null },
  ];

  const vendorIds: string[] = [];
  for (const v of vendorSpecs) {
    const uid = await ensureUser(v.email);
    const { data: vendor, error: vendorError } = await db
      .from("vendors")
      .upsert(
        {
          user_id: uid,
          company_name: v.company,
          contact_name: v.contact,
          phone: "719-555-0142",
          email: v.email,
          vehicle_type: v.vehicle,
          license_plate: v.plate,
        },
        { onConflict: "user_id" }
      )
      .select()
      .single();
    if (vendorError) throw vendorError;
    vendorIds.push(vendor.id);

    const { error: inviteError } = await db
      .from("event_invites")
      .upsert({ event_id: event.id, vendor_email: v.email }, { onConflict: "event_id,vendor_email" });
    if (inviteError) throw inviteError;
  }

  // Two bookings: one confirmed (dock A, first slot), one pending (dock B, first slot).
  const dockASlot = slots!.find((s) => s.dock_id === docks![0].id)!;
  const dockBSlot = slots!.find((s) => s.dock_id === docks![1].id)!;
  const { error: b1 } = await db.from("bookings").insert({
    slot_id: dockASlot.id,
    vendor_id: vendorIds[0],
    status: "confirmed",
    purpose: "Beer delivery — 40 kegs, 1 box truck",
  });
  if (b1) throw b1;
  const { error: b2 } = await db.from("bookings").insert({
    slot_id: dockBSlot.id,
    vendor_id: vendorIds[1],
    status: "pending",
    purpose: "T-shirt + scarf restock, sprinter van",
  });
  if (b2) throw b2;

  // Gate list token for the event.
  const { data: gate, error: gateError } = await db
    .from("gate_list_tokens")
    .insert({
      event_id: event.id,
      expires_at: new Date(end.getTime() + 24 * 36e5).toISOString(),
    })
    .select()
    .single();
  if (gateError) throw gateError;

  console.log(`
✅ Seeded.
   Venue:  ${venue.name} (${venue.city})
   Event:  ${event.name} on ${dateStr} — PUBLISHED
   Docks:  ${docks!.map((d) => d.name).join(" · ")}
   Slots:  ${slots!.length}
   Vendors: ${vendorSpecs.map((v) => v.email).join(", ")}
   Admin:  admin@demo.gamedaydock.test
   Gate list: /gate/${gate.token}
`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
