import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysInFacility, facilityLocalToUtc } from "@/lib/time";
import type { DockAvailability } from "@/lib/types";

/** How many days ahead slots are kept materialized for a dock. */
export const SLOT_HORIZON_DAYS = 21;

/**
 * Materializes concrete `slots` rows from a dock's recurring weekly
 * `dock_availability` template, for every occurrence of each configured
 * weekday within the next `horizonDays`. Idempotent — relies on the
 * `slots(dock_id, start_time)` unique constraint and inserts with
 * `ignoreDuplicates` so re-running (e.g. from the daily cron) never
 * creates duplicates or touches existing bookings.
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

  const rows: { dock_id: string; start_time: string; end_time: string }[] = [];

  for (let offset = 0; offset < horizonDays; offset++) {
    const dateStr = addDaysInFacility(timezone, offset);
    const dayOfWeek = facilityLocalToUtc(dateStr, "12:00", timezone).getUTCDay();
    // getUTCDay on a noon-local instant reliably reflects the local weekday.
    const templates = (availability as DockAvailability[]).filter((a) => a.day_of_week === dayOfWeek);

    for (const template of templates) {
      const dayStart = facilityLocalToUtc(dateStr, template.start_time.slice(0, 5), timezone);
      const dayEnd = facilityLocalToUtc(dateStr, template.end_time.slice(0, 5), timezone);
      const intervalMs = template.slot_interval_minutes * 60_000;

      for (let t = dayStart.getTime(); t + intervalMs <= dayEnd.getTime(); t += intervalMs) {
        rows.push({
          dock_id: dockId,
          start_time: new Date(t).toISOString(),
          end_time: new Date(t + intervalMs).toISOString(),
        });
      }
    }
  }

  if (rows.length === 0) return { generated: 0 };

  const { error } = await supabase
    .from("slots")
    .upsert(rows, { onConflict: "dock_id,start_time", ignoreDuplicates: true });
  if (error) throw new Error(`Could not generate slots: ${error.message}`);

  return { generated: rows.length };
}
