/**
 * Proves the database itself prevents double-booking: two simultaneous
 * booking inserts for the same slot can never both succeed, regardless of
 * timing, because of the partial unique index
 * `bookings_one_active_per_slot` on bookings(slot_id) where status <> 'cancelled'.
 *
 * Run via `npm run test:db` (spins up a throwaway Postgres and applies the
 * real migration first).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  describe.skip("double-booking protection (set DATABASE_URL — use npm run test:db)", () => {
    it.skip("skipped", () => {});
  });
}

describe.runIf(!!DATABASE_URL)("double-booking protection", () => {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 10 });
  let slotId: string;
  let vendorA: string;
  let vendorB: string;
  let eventId: string;
  let dockId: string;

  beforeAll(async () => {
    const user = async (email: string) =>
      (await pool.query(`insert into auth.users (email) values ($1) returning id`, [email])).rows[0].id;

    const adminId = await user("admin@test.local");
    const venue = await pool.query(
      `insert into venues (name, city, timezone, created_by) values ('Test FC Stadium','Testville','America/Denver',$1) returning id`,
      [adminId]
    );
    const dock = await pool.query(
      `insert into docks (venue_id, name) values ($1, 'Dock A — North') returning id`,
      [venue.rows[0].id]
    );
    dockId = dock.rows[0].id;
    const event = await pool.query(
      `insert into events (venue_id, name, event_date, load_in_start, load_in_end, status)
       values ($1, 'Test Match', current_date + 1, now() + interval '20 hours', now() + interval '26 hours', 'published') returning id`,
      [venue.rows[0].id]
    );
    eventId = event.rows[0].id;
    const slot = await pool.query(
      `insert into slots (event_id, dock_id, start_time, end_time)
       values ($1, $2, now() + interval '20 hours', now() + interval '20.5 hours') returning id`,
      [eventId, dockId]
    );
    slotId = slot.rows[0].id;

    const mkVendor = async (email: string, company: string) => {
      const uid = await user(email);
      const v = await pool.query(
        `insert into vendors (company_name, contact_name, phone, email, vehicle_type, user_id)
         values ($1, 'Test Person', '555-0100', $2, 'box truck', $3) returning id`,
        [company, email, uid]
      );
      return v.rows[0].id as string;
    };
    vendorA = await mkVendor("a@test.local", "Alpha Beverages");
    vendorB = await mkVendor("b@test.local", "Bravo Merch");
  });

  afterAll(async () => {
    await pool.end();
  });

  const book = (vendorId: string, slot: string) =>
    pool.query(
      `insert into bookings (slot_id, vendor_id, purpose) values ($1, $2, 'test delivery') returning id`,
      [slot, vendorId]
    );

  it("two simultaneous bookings for the same slot: exactly one succeeds", async () => {
    const results = await Promise.allSettled([book(vendorA, slotId), book(vendorB, slotId)]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    const err = (failed[0] as PromiseRejectedResult).reason;
    // 23505 = unique_violation from bookings_one_active_per_slot
    expect(err.code).toBe("23505");
    // Slot flipped to booked by trigger
    const slot = await pool.query(`select status from slots where id = $1`, [slotId]);
    expect(slot.rows[0].status).toBe("booked");
  });

  it("a third attempt on the booked slot also fails", async () => {
    await expect(book(vendorB, slotId)).rejects.toMatchObject({ code: "23505" });
  });

  it("cancelling reopens the slot and lets another vendor book it", async () => {
    await pool.query(`update bookings set status = 'cancelled' where slot_id = $1 and status <> 'cancelled'`, [slotId]);
    const slot = await pool.query(`select status from slots where id = $1`, [slotId]);
    expect(slot.rows[0].status).toBe("open");
    const rebook = await book(vendorB, slotId);
    expect(rebook.rowCount).toBe(1);
  });

  it("cannot book a blocked slot", async () => {
    const blocked = await pool.query(
      `insert into slots (event_id, dock_id, start_time, end_time, status)
       values ($1, $2, now() + interval '21 hours', now() + interval '21.5 hours', 'blocked') returning id`,
      [eventId, dockId]
    );
    await expect(book(vendorA, blocked.rows[0].id)).rejects.toThrow(/blocked/);
  });

  it("cannot book a slot on a draft event", async () => {
    await pool.query(`update events set status = 'draft' where id = $1`, [eventId]);
    const draftSlot = await pool.query(
      `insert into slots (event_id, dock_id, start_time, end_time)
       values ($1, $2, now() + interval '22 hours', now() + interval '22.5 hours') returning id`,
      [eventId, dockId]
    );
    await expect(book(vendorA, draftSlot.rows[0].id)).rejects.toThrow(/not open for booking/);
    await pool.query(`update events set status = 'published' where id = $1`, [eventId]);
  });

  it("50 concurrent bookings for one slot: exactly one wins", async () => {
    const slot = await pool.query(
      `insert into slots (event_id, dock_id, start_time, end_time)
       values ($1, $2, now() + interval '23 hours', now() + interval '23.5 hours') returning id`,
      [eventId, dockId]
    );
    const stampede = await Promise.allSettled(
      Array.from({ length: 50 }, (_, i) => book(i % 2 === 0 ? vendorA : vendorB, slot.rows[0].id))
    );
    expect(stampede.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});
