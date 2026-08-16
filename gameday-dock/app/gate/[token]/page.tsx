import { createAdminClient } from "@/lib/supabase/admin";
import { formatDayLong, formatTimeBare, zoneAbbr } from "@/lib/time";
import AutoRefresh from "@/app/components/auto-refresh";
import type { Booking, Dock, Event, Slot, Vendor, Venue } from "@/lib/types";

export const dynamic = "force-dynamic";

type GateBooking = Booking & {
  vendor: Vendor;
  slot: Slot & { dock: Dock };
};

/**
 * Public, read-only gate list for security. Authorization is the token itself
 * (validated + expiry-checked here, reads via service role). Never shows data
 * on a bad or expired token.
 */
export default async function GatePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const admin = createAdminClient();

  const { data: gate } = await admin
    .from("gate_list_tokens")
    .select("*, event:events(*, venue:venues(*))")
    .eq("token", token)
    .maybeSingle();

  // Dynamic route (force-dynamic) — expiry is checked at request time.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  if (!gate || new Date(gate.expires_at).getTime() < now) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 text-center">
        <p className="text-4xl">🔒</p>
        <h1 className="mt-3 text-2xl font-bold text-slate-900">
          {gate ? "This gate list has expired" : "This link isn't valid"}
        </h1>
        <p className="mt-2 text-lg text-slate-600">
          Ask the venue ops manager for a fresh gate list link.
        </p>
      </main>
    );
  }

  const event = gate.event as Event & { venue: Venue };
  const venue = event.venue;
  const tz = venue.timezone;

  const { data } = await admin
    .from("bookings")
    .select("*, vendor:vendors(*), slot:slots!inner(*, dock:docks(*))")
    .eq("slot.event_id", event.id)
    .in("status", ["confirmed", "checked_in", "late"])
    .order("start_time", { ascending: true, referencedTable: "slot" });

  const bookings = ((data ?? []) as unknown as GateBooking[]).sort((a, b) =>
    a.slot.start_time.localeCompare(b.slot.start_time)
  );

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <AutoRefresh seconds={60} />
      <header className="border-b-4 border-slate-900 pb-4">
        <p className="text-sm font-bold uppercase tracking-widest text-slate-500">
          Gate list · {venue.name}
        </p>
        <h1 className="mt-1 text-3xl font-extrabold text-slate-900">{event.name}</h1>
        <p className="mt-1 text-lg font-semibold text-slate-700">
          {formatDayLong(event.load_in_start, tz)} · All times {zoneAbbr(tz)}
        </p>
      </header>

      {bookings.length === 0 ? (
        <p className="mt-8 text-center text-xl text-slate-600">
          No confirmed deliveries yet. This page updates automatically.
        </p>
      ) : (
        <ul className="mt-4 divide-y-2 divide-slate-200">
          {bookings.map((b) => (
            <li key={b.id} className="py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-2xl font-extrabold leading-tight text-slate-900">
                    {b.vendor.company_name}
                  </p>
                  <p className="mt-1 text-lg text-slate-700">
                    {b.vendor.contact_name} · {b.vendor.phone}
                  </p>
                  <p className="text-lg font-semibold text-slate-900">
                    {b.vendor.vehicle_type}
                    {b.vendor.license_plate && (
                      <span className="ml-2 rounded bg-slate-900 px-2 py-0.5 font-mono text-base text-white">
                        {b.vendor.license_plate}
                      </span>
                    )}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-2xl font-extrabold tabular-nums text-slate-900">
                    {formatTimeBare(b.slot.start_time, tz)}
                  </p>
                  <p className="text-slate-600">–{formatTimeBare(b.slot.end_time, tz)}</p>
                  <p className="mt-1 text-lg font-bold uppercase text-slate-800">{b.slot.dock.name}</p>
                  {b.status === "checked_in" && (
                    <span className="chip mt-1 bg-blue-100 text-blue-800">In</span>
                  )}
                  {b.status === "late" && (
                    <span className="chip mt-1 bg-orange-100 text-orange-800">Late</span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <footer className="mt-8 border-t border-slate-200 pt-4 text-center text-sm text-slate-500">
        Read-only · refreshes every minute · GameDay Dock
      </footer>
    </main>
  );
}
