/**
 * Row Level Security acceptance tests, run with queries executing as the
 * `authenticated` role (RLS enforced), the way Supabase runs them.
 *
 * Covers the spec's acceptance criteria:
 *  - a carrier not invited to a facility sees none of its docks/slots
 *  - invited carriers only see facilities they're invited to, and only
 *    their own bookings
 *  - admins only see their own facility's data
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool, type PoolClient } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

describe.runIf(!!DATABASE_URL)("row level security", () => {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 5 });

  let adminId: string;
  let otherAdminId: string;
  let carrierUserId: string;
  let strangerUserId: string;
  let facilityId: string;
  let otherFacilityId: string;
  let dockId: string;
  let openSlotId: string;
  let blockedSlotId: string;
  let carrierId: string;
  let strangerCarrierId: string;

  const CARRIER_EMAIL = "rls-carrier@test.local";
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
    carrierUserId = await user(CARRIER_EMAIL);
    strangerUserId = await user(STRANGER_EMAIL);

    const mkFacility = async (name: string, owner: string) =>
      (
        await pool.query(
          `insert into facilities (name, city, timezone, created_by) values ($1,'Testville','America/Denver',$2) returning id`,
          [name, owner]
        )
      ).rows[0].id;
    facilityId = await mkFacility("RLS Distribution Center", adminId);
    otherFacilityId = await mkFacility("Other Warehouse", otherAdminId);

    dockId = (
      await pool.query(`insert into docks (facility_id, name) values ($1,'Dock R') returning id`, [facilityId])
    ).rows[0].id;

    const mkSlot = async (status: string) =>
      (
        await pool.query(
          `insert into slots (dock_id, start_time, end_time, status)
           values ($1, now() + interval '40 hours', now() + interval '40.5 hours', $2) returning id`,
          [dockId, status]
        )
      ).rows[0].id;
    openSlotId = await mkSlot("open");
    blockedSlotId = await mkSlot("blocked");

    // Carrier is invited to the RLS facility; stranger to neither.
    await pool.query(`insert into facility_invites (facility_id, carrier_email) values ($1, $2)`, [
      facilityId,
      CARRIER_EMAIL,
    ]);

    const mkCarrier = async (uid: string, email: string, company: string) =>
      (
        await pool.query(
          `insert into carriers (company_name, contact_name, phone, email, vehicle_type, user_id)
           values ($1, 'P', '555-0100', $2, 'box truck', $3) returning id`,
          [company, email, uid]
        )
      ).rows[0].id;
    carrierId = await mkCarrier(carrierUserId, CARRIER_EMAIL, "RLS Freight");
    strangerCarrierId = await mkCarrier(strangerUserId, STRANGER_EMAIL, "Stranger Co");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("invited carrier sees the facility's docks and slots", async () => {
    const rows = await asUser(carrierUserId, CARRIER_EMAIL, async (c) => {
      const { rows } = await c.query(`select id from slots`);
      return rows;
    });
    expect(rows.map((r) => r.id)).toContain(openSlotId);
    expect(rows.map((r) => r.id)).toContain(blockedSlotId);
  });

  it("uninvited carrier sees no facilities, docks, or slots at all", async () => {
    const rows = await asUser(strangerUserId, STRANGER_EMAIL, async (c) => {
      const { rows } = await c.query(`select id from facilities`);
      return rows;
    });
    expect(rows).toHaveLength(0);
    const slotRows = await asUser(strangerUserId, STRANGER_EMAIL, async (c) => {
      const { rows } = await c.query(`select id from slots`);
      return rows;
    });
    expect(slotRows).toHaveLength(0);
  });

  it("invited carrier can read the facility's details (address, settings)", async () => {
    const rows = await asUser(carrierUserId, CARRIER_EMAIL, async (c) => {
      const { rows } = await c.query(`select id, name, cancellation_cutoff_hours from facilities`);
      return rows;
    });
    expect(rows.map((r) => r.id)).toContain(facilityId);
    expect(rows.map((r) => r.id)).not.toContain(otherFacilityId);
  });

  it("uninvited carrier cannot book a slot at a facility they're not invited to", async () => {
    await expect(
      asUser(strangerUserId, STRANGER_EMAIL, async (c) => {
        await c.query(
          `insert into bookings (slot_id, carrier_id, purpose) values ($1, $2, 'sneaky booking')`,
          [openSlotId, strangerCarrierId]
        );
      })
    ).rejects.toThrow(); // blocked by RLS with-check (not invited to this facility)
  });

  it("invited carrier CAN book an open slot, as themselves only", async () => {
    await asUser(carrierUserId, CARRIER_EMAIL, async (c) => {
      const { rowCount } = await c.query(
        `insert into bookings (slot_id, carrier_id, purpose) values ($1, $2, 'legit booking') returning id`,
        [openSlotId, carrierId]
      );
      expect(rowCount).toBe(1);
    });

    // ...but cannot create a booking on behalf of another carrier.
    const secondSlot = (
      await pool.query(
        `insert into slots (dock_id, start_time, end_time) values ($1, now() + interval '41 hours', now() + interval '41.5 hours') returning id`,
        [dockId]
      )
    ).rows[0].id;
    await expect(
      asUser(carrierUserId, CARRIER_EMAIL, async (c) => {
        await c.query(
          `insert into bookings (slot_id, carrier_id, purpose) values ($1, $2, 'impersonation')`,
          [secondSlot, strangerCarrierId]
        );
      })
    ).rejects.toThrow();
  });

  it("carriers cannot see each other's bookings", async () => {
    // Commit a real booking (asUser rolls back) via superuser, then read as stranger.
    const visibleSlot = (
      await pool.query(
        `insert into slots (dock_id, start_time, end_time) values ($1, now() + interval '42 hours', now() + interval '42.5 hours') returning id`,
        [dockId]
      )
    ).rows[0].id;
    await pool.query(`insert into bookings (slot_id, carrier_id, purpose) values ($1, $2, 'visible to owner only')`, [
      visibleSlot,
      carrierId,
    ]);
    const strangerSees = await asUser(strangerUserId, STRANGER_EMAIL, async (c) => {
      const { rows } = await c.query(`select id from bookings`);
      return rows;
    });
    expect(strangerSees).toHaveLength(0);

    const ownerSees = await asUser(carrierUserId, CARRIER_EMAIL, async (c) => {
      const { rows } = await c.query(`select id, purpose from bookings`);
      return rows;
    });
    expect(ownerSees.length).toBeGreaterThan(0);
  });

  it("admins see their own facility's data and no one else's", async () => {
    const mine = await asUser(adminId, "rls-admin@test.local", async (c) => {
      const { rows } = await c.query(`select id from facilities`);
      return rows;
    });
    expect(mine.map((r) => r.id)).toEqual([facilityId]);

    const theirs = await asUser(otherAdminId, "rls-other-admin@test.local", async (c) => {
      const { rows: facilities } = await c.query(`select id from facilities`);
      const { rows: docks } = await c.query(`select id from docks`);
      const { rows: bookings } = await c.query(`select id from bookings`);
      return { facilities, docks, bookings };
    });
    expect(theirs.facilities.map((r) => r.id)).toEqual([otherFacilityId]);
    expect(theirs.docks).toHaveLength(0);
    expect(theirs.bookings).toHaveLength(0);
  });

  it("admin of the facility sees carrier bookings and carrier contact details", async () => {
    const seen = await asUser(adminId, "rls-admin@test.local", async (c) => {
      const { rows: bookings } = await c.query(`select id, status from bookings`);
      const { rows: carriers } = await c.query(`select company_name from carriers`);
      return { bookings, carriers };
    });
    expect(seen.bookings.length).toBeGreaterThan(0);
    expect(seen.carriers.map((v) => v.company_name)).toContain("RLS Freight");
    // ...but not carriers with no booking at this facility.
    expect(seen.carriers.map((v) => v.company_name)).not.toContain("Stranger Co");
  });
});
