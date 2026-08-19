/**
 * Seeds a Supabase project with demo data:
 *   1 facility · 2 docks · weekly availability · ~7 days of generated slots
 *   · 3 carriers + invites · 2 bookings · a dock manifest token.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed
 * (or put those in .env.local — this script loads it automatically)
 *
 * Demo logins (magic link still required — use these emails):
 *   admin@demo.dockdelivery.test    → facility admin
 *   freight@demo.dockdelivery.test  → carrier with a confirmed booking
 *   pallet@demo.dockdelivery.test   → carrier with a pending booking
 *   produce@demo.dockdelivery.test  → invited carrier, no booking yet
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
  const { fromZonedTime, formatInTimeZone } = await import("date-fns-tz");

  const adminId = await ensureUser("admin@demo.dockdelivery.test");

  const { data: facility, error: facilityError } = await db
    .from("facilities")
    .insert({
      name: "Demo Distribution Center",
      city: "Colorado Springs, CO",
      address: "111 W Cimarron St, Colorado Springs, CO 80903",
      timezone: "America/Denver",
      require_approval: true,
      created_by: adminId,
    })
    .select()
    .single();
  if (facilityError) throw facilityError;
  const tz = facility.timezone as string;

  const { data: docks, error: dockError } = await db
    .from("docks")
    .insert([
      { facility_id: facility.id, name: "Dock A — North", notes: "Max 53' trailer. Clearance 13'6\"." },
      { facility_id: facility.id, name: "Dock B — South", notes: "Check in with gate 3 first." },
    ])
    .select();
  if (dockError) throw dockError;

  // Weekly availability: every day of the week, 8am-6pm, 30-minute slots.
  const availabilityRows = docks!.flatMap((dock) =>
    [0, 1, 2, 3, 4, 5, 6].map((day_of_week) => ({
      dock_id: dock.id,
      day_of_week,
      start_time: "08:00:00",
      end_time: "18:00:00",
      slot_interval_minutes: 30,
    }))
  );
  const { error: availError } = await db.from("dock_availability").insert(availabilityRows);
  if (availError) throw availError;

  // Generate 7 days of slots per dock (mirrors lib/slots.ts's generateSlotsForDock,
  // inlined here to keep this script dependency-free of the "@/" path alias).
  const slotRows: { dock_id: string; start_time: string; end_time: string }[] = [];
  for (const dock of docks!) {
    for (let offset = 0; offset < 7; offset++) {
      const dateStr = formatInTimeZone(new Date(Date.now() + offset * 24 * 36e5), tz, "yyyy-MM-dd");
      const dayStart = fromZonedTime(`${dateStr}T08:00:00`, tz);
      const dayEnd = fromZonedTime(`${dateStr}T18:00:00`, tz);
      for (let t = dayStart.getTime(); t + 30 * 6e4 <= dayEnd.getTime(); t += 30 * 6e4) {
        slotRows.push({
          dock_id: dock.id,
          start_time: new Date(t).toISOString(),
          end_time: new Date(t + 30 * 6e4).toISOString(),
        });
      }
    }
  }
  const { data: slots, error: slotError } = await db
    .from("slots")
    .upsert(slotRows, { onConflict: "dock_id,start_time", ignoreDuplicates: true })
    .select();
  if (slotError) throw slotError;

  const carrierSpecs = [
    { email: "freight@demo.dockdelivery.test", company: "Summit Freight Co.", contact: "Sam Rivera", vehicle: "53' trailer", plate: "COL-4821" },
    { email: "pallet@demo.dockdelivery.test", company: "Pallet Express LLC", contact: "Jordan Lee", vehicle: "Box truck", plate: "COL-1177" },
    { email: "produce@demo.dockdelivery.test", company: "Front Range Produce", contact: "Casey Fox", vehicle: "Reefer truck", plate: null },
  ];

  const carrierIds: string[] = [];
  for (const c of carrierSpecs) {
    const uid = await ensureUser(c.email);
    const { data: carrier, error: carrierError } = await db
      .from("carriers")
      .upsert(
        {
          user_id: uid,
          company_name: c.company,
          contact_name: c.contact,
          phone: "719-555-0142",
          email: c.email,
          vehicle_type: c.vehicle,
          license_plate: c.plate,
        },
        { onConflict: "user_id" }
      )
      .select()
      .single();
    if (carrierError) throw carrierError;
    carrierIds.push(carrier.id);

    const { error: inviteError } = await db
      .from("facility_invites")
      .upsert({ facility_id: facility.id, carrier_email: c.email }, { onConflict: "facility_id,carrier_email" });
    if (inviteError) throw inviteError;
  }

  // Two bookings on tomorrow's first slot per dock: one confirmed, one pending.
  const now = Date.now();
  const dockASlot = slots!
    .filter((s) => s.dock_id === docks![0].id && new Date(s.start_time).getTime() > now + 24 * 36e5)
    .sort((a, b) => a.start_time.localeCompare(b.start_time))[0];
  const dockBSlot = slots!
    .filter((s) => s.dock_id === docks![1].id && new Date(s.start_time).getTime() > now + 24 * 36e5)
    .sort((a, b) => a.start_time.localeCompare(b.start_time))[0];

  const { error: b1 } = await db.from("bookings").insert({
    slot_id: dockASlot.id,
    carrier_id: carrierIds[0],
    status: "confirmed",
    purpose: "Full trailer drop — general freight",
  });
  if (b1) throw b1;
  const { error: b2 } = await db.from("bookings").insert({
    slot_id: dockBSlot.id,
    carrier_id: carrierIds[1],
    status: "pending",
    purpose: "12 pallets, box truck",
  });
  if (b2) throw b2;

  // Dock manifest token — always shows today's confirmed deliveries.
  const { data: manifest, error: manifestError } = await db
    .from("dock_manifest_tokens")
    .insert({
      facility_id: facility.id,
      expires_at: new Date(now + 90 * 24 * 36e5).toISOString(),
    })
    .select()
    .single();
  if (manifestError) throw manifestError;

  console.log(`
✅ Seeded.
   Facility: ${facility.name} (${facility.city})
   Docks:    ${docks!.map((d) => d.name).join(" · ")}
   Slots:    ${slots!.length} generated over the next 7 days
   Carriers: ${carrierSpecs.map((c) => c.email).join(", ")}
   Admin:    admin@demo.dockdelivery.test
   Manifest: /manifest/${manifest.token}
`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
