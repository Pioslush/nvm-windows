/**
 * Row Level Security acceptance tests, run with queries executing as the
 * `authenticated` role (RLS enforced), the way Supabase runs them.
 *
 * Covers the spec's acceptance criteria:
 *  - draft events are invisible (and unbookable) to invited vendors
 *  - vendors only see events they're invited to, and only their own bookings
 *  - admins only see their own venue's data
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool, type PoolClient } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

describe.runIf(!!DATABASE_URL)("row level security", () => {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 5 });

  let adminId: string;
  let otherAdminId: string;
  let vendorUserId: string;
  let strangerUserId: string;
  let venueId: string;
  let otherVenueId: string;
  let publishedEventId: string;
  let draftEventId: string;
  let publishedSlotId: string;
  let draftSlotId: string;
  let vendorId: string;
  let strangerVendorId: string;

  const VENDOR_EMAIL = "rls-vendor@test.local";
  const STRANGER_EMAIL = "rls-stranger@test.local";

  /** Runs fn inside a transaction as `authenticated` with the given JWT claims. */
  async function asUser<T>(
    userId: string,
    email: string,
    fn: (c: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: userId, email }),
      ]);
      await client.query("set local role authenticated");
      return await fn(client);
    } finally {
      await client.query("rollback").catch(() => {});
      client.release();
    }
  }

  beforeAll(async () => {
    const user = async (email: string) =>
      (await pool.query(`insert into auth.users (email) values ($1) returning id`, [email])).rows[0].id;

    adminId = await user("rls-admin@test.local");
    otherAdminId = await user("rls-other-admin@test.local");
    vendorUserId = await user(VENDOR_EMAIL);
    strangerUserId = await user(STRANGER_EMAIL);

    const mkVenue = async (name: string, owner: string) =>
      (
        await pool.query(
          `insert into venues (name, city, timezone, created_by) values ($1,'Testville','America/Denver',$2) returning id`,
          [name, owner]
        )
      ).rows[0].id;
    venueId = await mkVenue("RLS Stadium", adminId);
    otherVenueId = await mkVenue("Other Arena", otherAdminId);

    const dockId = (
      await pool.query(`insert into docks (venue_id, name) values ($1,'Dock R') returning id`, [venueId])
    ).rows[0].id;

    const mkEvent = async (status: string) =>
      (
        await pool.query(
          `insert into events (venue_id, name, event_date, load_in_start, load_in_end, status)
           values ($1, 'RLS Event ' || $2, current_date + 2, now() + interval '40 hours', now() + interval '44 hours', $2) returning id`,
          [venueId, status]
        )
      ).rows[0].id;
    publishedEventId = await mkEvent("published");
    draftEventId = await mkEvent("draft");

    const mkSlot = async (eventId: string) =>
      (
        await pool.query(
          `insert into slots (event_id, dock_id, start_time, end_time)
           values ($1, $2, now() + interval '40 hours', now() + interval '40.5 hours') returning id`,
          [eventId, dockId]
        )
      ).rows[0].id;
    publishedSlotId = await mkSlot(publishedEventId);
    draftSlotId = await mkSlot(draftEventId);

    // Vendor is invited to BOTH events; stranger to neither.
    for (const eventId of [publishedEventId, draftEventId]) {
      await pool.query(`insert into event_invites (event_id, vendor_email) values ($1, $2)`, [
        eventId,
        VENDOR_EMAIL,
      ]);
    }

    const mkVendor = async (uid: string, email: string, company: string) =>
      (
        await pool.query(
          `insert into vendors (company_name, contact_name, phone, email, vehicle_type, user_id)
           values ($1, 'P', '555-0100', $2, 'van', $3) returning id`,
          [company, email, uid]
        )
      ).rows[0].id;
    vendorId = await mkVendor(vendorUserId, VENDOR_EMAIL, "RLS Vending");
    strangerVendorId = await mkVendor(strangerUserId, STRANGER_EMAIL, "Stranger Co");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("invited vendor sees the published event but NOT the draft", async () => {
    const rows = await asUser(vendorUserId, VENDOR_EMAIL, async (c) => {
      const { rows } = await c.query(`select id, status from events`);
      return rows;
    });
    expect(rows.map((r) => r.id)).toContain(publishedEventId);
    expect(rows.map((r) => r.id)).not.toContain(draftEventId);
  });

  it("uninvited vendor sees no events at all", async () => {
    const rows = await asUser(strangerUserId, STRANGER_EMAIL, async (c) => {
      const { rows } = await c.query(`select id from events`);
      return rows;
    });
    expect(rows).toHaveLength(0);
  });

  it("invited vendor can read the venue's details (address, settings)", async () => {
    const rows = await asUser(vendorUserId, VENDOR_EMAIL, async (c) => {
      const { rows } = await c.query(`select id, name, cancellation_cutoff_hours from venues`);
      return rows;
    });
    expect(rows.map((r) => r.id)).toContain(venueId);
    expect(rows.map((r) => r.id)).not.toContain(otherVenueId);
  });

  it("invited vendor cannot book a slot on the draft event", async () => {
    await expect(
      asUser(vendorUserId, VENDOR_EMAIL, async (c) => {
        await c.query(
          `insert into bookings (slot_id, vendor_id, purpose) values ($1, $2, 'sneaky draft booking')`,
          [draftSlotId, vendorId]
        );
      })
    ).rejects.toThrow(); // blocked by RLS with-check and/or the published-only trigger
  });

  it("invited vendor CAN book the published event's slot, as themselves only", async () => {
    await asUser(vendorUserId, VENDOR_EMAIL, async (c) => {
      const { rowCount } = await c.query(
        `insert into bookings (slot_id, vendor_id, purpose) values ($1, $2, 'legit booking') returning id`,
        [publishedSlotId, vendorId]
      );
      expect(rowCount).toBe(1);
    });

    // ...but cannot create a booking on behalf of another vendor.
    await expect(
      asUser(vendorUserId, VENDOR_EMAIL, async (c) => {
        await c.query(
          `insert into bookings (slot_id, vendor_id, purpose) values ($1, $2, 'impersonation')`,
          [publishedSlotId, strangerVendorId]
        );
      })
    ).rejects.toThrow();
  });

  it("vendors cannot see each other's bookings", async () => {
    // Commit a real booking (asUser rolls back) via superuser, then read as stranger.
    await pool.query(`insert into bookings (slot_id, vendor_id, purpose) values ($1, $2, 'visible to owner only')`, [
      publishedSlotId,
      vendorId,
    ]);
    const strangerSees = await asUser(strangerUserId, STRANGER_EMAIL, async (c) => {
      const { rows } = await c.query(`select id from bookings`);
      return rows;
    });
    expect(strangerSees).toHaveLength(0);

    const ownerSees = await asUser(vendorUserId, VENDOR_EMAIL, async (c) => {
      const { rows } = await c.query(`select id, purpose from bookings`);
      return rows;
    });
    expect(ownerSees.length).toBeGreaterThan(0);
  });

  it("admins see their own venue's data and no one else's", async () => {
    const mine = await asUser(adminId, "rls-admin@test.local", async (c) => {
      const { rows } = await c.query(`select id from venues`);
      return rows;
    });
    expect(mine.map((r) => r.id)).toEqual([venueId]);

    const theirs = await asUser(otherAdminId, "rls-other-admin@test.local", async (c) => {
      const { rows: venues } = await c.query(`select id from venues`);
      const { rows: events } = await c.query(`select id from events`);
      const { rows: bookings } = await c.query(`select id from bookings`);
      return { venues, events, bookings };
    });
    expect(theirs.venues.map((r) => r.id)).toEqual([otherVenueId]);
    expect(theirs.events).toHaveLength(0);
    expect(theirs.bookings).toHaveLength(0);
  });

  it("admin of the venue sees vendor bookings and vendor contact details", async () => {
    const seen = await asUser(adminId, "rls-admin@test.local", async (c) => {
      const { rows: bookings } = await c.query(`select id, status from bookings`);
      const { rows: vendors } = await c.query(`select company_name from vendors`);
      return { bookings, vendors };
    });
    expect(seen.bookings.length).toBeGreaterThan(0);
    expect(seen.vendors.map((v) => v.company_name)).toContain("RLS Vending");
    // ...but not vendors with no booking at this venue.
    expect(seen.vendors.map((v) => v.company_name)).not.toContain("Stranger Co");
  });
});
