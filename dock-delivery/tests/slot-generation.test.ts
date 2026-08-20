/**
 * Slot generation is the centerpiece of the product: an admin sets weekly
 * hours once and bookable slots appear. These tests cover the date/DST
 * arithmetic directly (no database needed) — the part that's easy to get
 * subtly wrong and effectively impossible to verify by eye.
 *
 * Runs in the normal `npm test`; no DATABASE_URL required.
 */
import { describe, it, expect } from "vitest";
import { formatInTimeZone } from "date-fns-tz";
import { computeSlotRows } from "../lib/slots";
import { addDaysInFacility } from "../lib/time";
import type { DockAvailability } from "../lib/types";

const TZ = "America/Denver";
const DOCK = "dock-1";

/** Availability template covering the given weekdays, 08:00–18:00. */
function weekdays(days: number[], interval = 30, start = "08:00:00", end = "18:00:00"): DockAvailability[] {
  return days.map((day_of_week, i) => ({
    id: `avail-${i}`,
    dock_id: DOCK,
    day_of_week,
    start_time: start,
    end_time: end,
    slot_interval_minutes: interval,
    created_at: "2026-01-01T00:00:00Z",
  }));
}

const localTime = (iso: string) => formatInTimeZone(new Date(iso), TZ, "HH:mm");
const localDate = (iso: string) => formatInTimeZone(new Date(iso), TZ, "yyyy-MM-dd");

describe("computeSlotRows", () => {
  it("fills one open day with back-to-back slots at the configured interval", () => {
    // 2026-06-01 is a Monday.
    const rows = computeSlotRows(DOCK, weekdays([1]), TZ, 1, "2026-06-01");
    expect(rows).toHaveLength(20); // 08:00–18:00 at 30 min
    expect(localTime(rows[0].start_time)).toBe("08:00");
    expect(localTime(rows[0].end_time)).toBe("08:30");
    expect(localTime(rows[19].start_time)).toBe("17:30");
  });

  it("never generates a slot that runs past closing time", () => {
    // 45-minute slots don't divide a 10-hour day evenly: 13 fit, 14 would overrun.
    const rows = computeSlotRows(DOCK, weekdays([1], 45), TZ, 1, "2026-06-01");
    expect(rows).toHaveLength(13);
    expect(localTime(rows[12].end_time)).toBe("17:45");
    for (const row of rows) {
      expect(new Date(row.end_time).getTime()).toBeLessThanOrEqual(
        new Date(`${localDate(row.start_time)}T18:00:00-06:00`).getTime()
      );
    }
  });

  it("only generates on configured weekdays", () => {
    // Mondays and Wednesdays only, over two full weeks.
    const rows = computeSlotRows(DOCK, weekdays([1, 3]), TZ, 14, "2026-06-01");
    const dates = [...new Set(rows.map((r) => localDate(r.start_time)))].sort();
    expect(dates).toEqual([
      "2026-06-01", "2026-06-03", // Mon, Wed
      "2026-06-08", "2026-06-10",
    ]);
  });

  it("returns nothing when no availability is configured", () => {
    expect(computeSlotRows(DOCK, [], TZ, 21, "2026-06-01")).toEqual([]);
  });

  it("respects a 60-minute interval", () => {
    const rows = computeSlotRows(DOCK, weekdays([1], 60), TZ, 1, "2026-06-01");
    expect(rows).toHaveLength(10);
    expect(localTime(rows[9].start_time)).toBe("17:00");
  });

  it("never emits the same start_time twice", () => {
    // A duplicate would be silently absorbed by the unique index, hiding a
    // real logic bug — so assert on it here where it's visible.
    const rows = computeSlotRows(DOCK, weekdays([0, 1, 2, 3, 4, 5, 6]), TZ, 21, "2026-10-20");
    const starts = rows.map((r) => r.start_time);
    expect(new Set(starts).size).toBe(starts.length);
  });

  describe("across DST transitions", () => {
    // US DST 2026: spring forward Sun Mar 8, fall back Sun Nov 1.

    it("keeps opening time at 08:00 local on both sides of spring-forward", () => {
      const rows = computeSlotRows(DOCK, weekdays([0, 1, 2, 3, 4, 5, 6]), TZ, 6, "2026-03-05");
      const opens = new Map<string, string>();
      for (const row of rows) {
        const d = localDate(row.start_time);
        if (!opens.has(d)) opens.set(d, localTime(row.start_time));
      }
      expect([...opens.keys()]).toContain("2026-03-07"); // before
      expect([...opens.keys()]).toContain("2026-03-09"); // after
      for (const [, open] of opens) expect(open).toBe("08:00");
    });

    it("keeps opening time at 08:00 local on both sides of fall-back", () => {
      const rows = computeSlotRows(DOCK, weekdays([0, 1, 2, 3, 4, 5, 6]), TZ, 6, "2026-10-29");
      const opens = new Map<string, string>();
      for (const row of rows) {
        const d = localDate(row.start_time);
        if (!opens.has(d)) opens.set(d, localTime(row.start_time));
      }
      expect([...opens.keys()]).toContain("2026-10-31"); // before
      expect([...opens.keys()]).toContain("2026-11-02"); // after
      for (const [, open] of opens) expect(open).toBe("08:00");
    });

    it("covers every calendar day in the horizon exactly once through fall-back", () => {
      // Regression: adding UTC days to a zoned midnight duplicated Nov 1 and
      // dropped the horizon's final day every autumn.
      const rows = computeSlotRows(DOCK, weekdays([0, 1, 2, 3, 4, 5, 6]), TZ, 8, "2026-10-29");
      const dates = [...new Set(rows.map((r) => localDate(r.start_time)))].sort();
      expect(dates).toEqual([
        "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01",
        "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05",
      ]);
    });
  });
});

describe("addDaysInFacility", () => {
  it("walks consecutive dates without duplicating or skipping across fall-back", () => {
    const walked = Array.from({ length: 8 }, (_, i) => addDaysInFacility(TZ, i, "2026-10-29"));
    expect(walked).toEqual([
      "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01",
      "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05",
    ]);
  });

  it("walks consecutive dates without duplicating or skipping across spring-forward", () => {
    const walked = Array.from({ length: 8 }, (_, i) => addDaysInFacility(TZ, i, "2026-03-05"));
    expect(walked).toEqual([
      "2026-03-05", "2026-03-06", "2026-03-07", "2026-03-08",
      "2026-03-09", "2026-03-10", "2026-03-11", "2026-03-12",
    ]);
  });

  it("crosses month and year boundaries", () => {
    expect(addDaysInFacility(TZ, 1, "2026-01-31")).toBe("2026-02-01");
    expect(addDaysInFacility(TZ, 1, "2026-12-31")).toBe("2027-01-01");
    expect(addDaysInFacility(TZ, 1, "2028-02-28")).toBe("2028-02-29"); // leap year
  });
});
