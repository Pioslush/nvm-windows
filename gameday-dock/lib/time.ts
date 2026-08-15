import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

/**
 * Every timestamp in the product is stored in UTC and displayed in the
 * venue's timezone, always with an explicit zone label (e.g. "2:30 PM MT").
 */

/** Short zone label like "MT", "PT", "ET" — falls back to the raw offset. */
export function zoneAbbr(timezone: string, at: Date = new Date()): string {
  const abbr = formatInTimeZone(at, timezone, "zzz"); // e.g. "MST", "MDT"
  // Collapse MST/MDT → MT etc. for the sign-on-the-dock look.
  const m = abbr.match(/^([A-Z])[SD]T$/);
  return m ? `${m[1]}T` : abbr;
}

/** "2:30 PM MT" */
export function formatTime(iso: string | Date, timezone: string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return `${formatInTimeZone(d, timezone, "h:mm a")} ${zoneAbbr(timezone, d)}`;
}

/** "2:30 PM" (no zone label — for the end of a range that already has one). */
export function formatTimeBare(iso: string | Date, timezone: string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return formatInTimeZone(d, timezone, "h:mm a");
}

/** "2:30 – 3:00 PM MT" */
export function formatTimeRange(startIso: string | Date, endIso: string | Date, timezone: string): string {
  const start = typeof startIso === "string" ? new Date(startIso) : startIso;
  return `${formatInTimeZone(start, timezone, "h:mm")} – ${formatTime(endIso, timezone)}`;
}

/** "Sat, Mar 14" */
export function formatDay(iso: string | Date, timezone: string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return formatInTimeZone(d, timezone, "EEE, MMM d");
}

/** "Saturday, March 14, 2026" */
export function formatDayLong(iso: string | Date, timezone: string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return formatInTimeZone(d, timezone, "EEEE, MMMM d, yyyy");
}

/** A local date ("2026-03-14") + local time ("14:30") in a venue timezone → UTC Date. */
export function venueLocalToUtc(dateStr: string, timeStr: string, timezone: string): Date {
  return fromZonedTime(`${dateStr}T${timeStr}:00`, timezone);
}

/** Today's date string (yyyy-MM-dd) in a venue's timezone. */
export function todayInVenue(timezone: string): string {
  return formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");
}

export function hoursUntil(iso: string | Date): number {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return (d.getTime() - Date.now()) / 36e5;
}
