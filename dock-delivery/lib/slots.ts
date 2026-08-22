import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysInFacility, facilityLocalToUtc } from "@/lib/time";
import type { DockAvailability } from "@/lib/types";

/** How many days ahead slots are kept materialized for a dock. */
export const SLOT_HORIZON_DAYS = 21;

export interface SlotRow {
  dock_id: string;
  start_time: string;
  end_time: string;
}

/**
 * Pure slot math: expands a dock's recurring weekly availability into
 * concrete slot rows across `horizonDays`, starting from `startDate`
 * (default: today in the facility's timezone).
 *
 * Split out from the database write so the date/DST arithmetic — the part
 * that's easy to get wrong and impossible to eyeball — can be tested
 * directly. Each day converts its own local open/close times, so a dock
 * that opens at 08:00 local still opens at 08:00 local on both sides of a
 * DST transition.
 */
export function computeSlotRows(
  dockId: string,
  availability: DockAvailability[],
  timezone: string,
  horizonDays: number = SLOT_HORIZON_DAYS,
  startDate?: string
): SlotRow[] {
  if (availability.length === 0) return [];

  const rows: SlotRow[] = [];

  for (let offset = 0; offset < horizonDays; offset++) {
    const dateStr = addDaysInFacility(timezone, offset, startDate);
    // getUTCDay on a noon-local instant reliably reflects the local weekday.
    const dayOfWeek = facilityLocalToUtc(dateStr, "12:00", timezone).getUTCDay();
    const templates = availability.filter((a) => a.day_of_week === dayOfWeek);

    for (const template of templates) {
      const dayStart = facilityLocalToUtc(dateStr, template.start_time.slice(0, 5), timezone);
      const dayEnd = facilityLocalToUtc(dateStr, template.end_time.slice(0, 5), timezone);
      const intervalMs = template.slot_interval_minutes * 60_000;

      // `t + intervalMs <= dayEnd` so a slot never runs past closing time.
      for (let t = dayStart.getTime(); t + intervalMs <= dayEnd.getTime(); t += intervalMs) {
        rows.push({
          dock_id: dockId,
          start_time: new Date(t).toISOString(),
          end_time: new Date(t + intervalMs).toISOString(),
        });
      }
    }
  }

  return rows;
}

/**
 * Materializes concrete `slots` rows from a dock's recurring weekly
 * `dock_availability` template. Idempotent — relies on the
 * `slots(dock_id, start_time)` unique constraint and inserts with
 * `ignoreDuplicates` so re-running (e.g. from the daily cron) never
 * creates duplicates or touches existing bookings.
 *
 * Returns the number of rows actually inserted, not the number attempted —
 * on a steady-state cron run that is usually a handful (one new day's
 * worth), even though thousands of candidate rows were considered.
 *
 * `supabase` must be a client with insert access to `slots` for this dock
 * (an RLS-respecting client when called from an admin action after the
 * admin edits availability, or the service-role client from the cron).
 */
export async function generateSlotsForDock(
  supabase: SupabaseClient,
  dockId: string,
  timezone: string,
  horizonDays: number = SLOT_HORIZON_DAYS
): Promise<{ generated: number }> {
  const { data: availability } = await supabase
    .from("dock_availability")
    .select("*")
    .eq("dock_id", dockId);
  if (!availability || availability.length === 0) return { generated: 0 };

  const rows = computeSlotRows(dockId, availability as DockAvailability[], timezone, horizonDays);
  if (rows.length === 0) return { generated: 0 };

  // `.select()` here is safe: the slots SELECT policy resolves through the
  // dock's facility, which already exists — unlike the venue-creation case
  // where the row only becomes visible via a same-transaction trigger.
  const { data: inserted, error } = await supabase
    .from("slots")
    .upsert(rows, { onConflict: "dock_id,start_time", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(`Could not generate slots: ${error.message}`);

  return { generated: inserted?.length ?? 0 };
}
