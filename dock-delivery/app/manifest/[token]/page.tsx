import { createAdminClient } from "@/lib/supabase/admin";
import { formatDayLong, formatTimeBare, todayInFacility, zoneAbbr } from "@/lib/time";
import { fromZonedTime } from "date-fns-tz";
import AutoRefresh from "@/app/components/auto-refresh";
import type { Booking, Carrier, Dock, Facility, Slot } from "@/lib/types";

export const dynamic = "force-dynamic";

type ManifestBooking = Booking & {
  carrier: Carrier;
  slot: Slot & { dock: Dock };
};

/**
 * Public, read-only dock manifest for security. Authorization is the token
 * itself (validated + expiry-checked here, reads via service role). Unlike
 * a one-event gate list, this always shows *today's* confirmed deliveries
 * across every dock at the facility — one link stays useful indefinitely.
 */
export default async function ManifestPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const admin = createAdminClient();

  const { data: manifestToken } = await admin
    .from("dock_manifest_tokens")
    .select("*, facility:facilities(*)")
    .eq("token", token)
    .maybeSingle();

  // Dynamic route (force-dynamic) — expiry is checked at request time.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  if (!manifestToken || new Date(manifestToken.expires_at).getTime() < now) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 text-center">
        <p className="text-4xl">🔒</p>
        <h1 className="mt-3 text-2xl font-bold text-slate-900">
          {manifestToken ? "This manifest link has expired" : "This link isn't valid"}
        </h1>
        <p className="mt-2 text-lg text-slate-600">
          Ask the facility ops manager for a fresh manifest link.
        </p>
      </main>
    );
  }

  const facility = manifestToken.facility as Facility;
  const tz = facility.timezone;
  const today = todayInFacility(tz);
  const dayStart = fromZonedTime(`${today}T00:00:00`, tz);
  const dayEnd = fromZonedTime(`${today}T23:59:59.999`, tz);

  const { data: docks } = await admin.from("docks").select("id").eq("facility_id", facility.id);
  const dockIds = (docks ?? []).map((d: { id: string }) => d.id);

  let bookings: ManifestBooking[] = [];
  if (dockIds.length > 0) {
    const { data } = await admin
      .from("bookings")
      .select("*, carrier:carriers(*), slot:slots!inner(*, dock:docks!inner(*))")
      .in("slot.dock_id", dockIds)
      .in("status", ["confirmed", "checked_in", "late"])
      .gte("slot.start_time", dayStart.toISOString())
      .lte("slot.start_time", dayEnd.toISOString())
      .order("start_time", { referencedTable: "slot" });
    bookings = (data ?? []) as unknown as ManifestBooking[];
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <AutoRefresh seconds={60} />
      <header className="border-b-4 border-slate-900 pb-4">
        <p className="text-sm font-bold uppercase tracking-widest text-slate-500">
          Dock manifest · {facility.name}
        </p>
        <h1 className="mt-1 text-3xl font-extrabold text-slate-900">
          {formatDayLong(dayStart, tz)}
        </h1>
        <p className="mt-1 text-lg font-semibold text-slate-700">All times {zoneAbbr(tz)}</p>
      </header>

      {bookings.length === 0 ? (
        <p className="mt-8 text-center text-xl text-slate-600">
          No confirmed deliveries today yet. This page updates automatically.
        </p>
      ) : (
        <ul className="mt-4 divide-y-2 divide-slate-200">
          {bookings.map((b) => (
            <li key={b.id} className="py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-2xl font-extrabold leading-tight text-slate-900">
                    {b.carrier.company_name}
                  </p>
                  <p className="mt-1 text-lg text-slate-700">
                    {b.carrier.contact_name} · {b.carrier.phone}
                  </p>
                  <p className="text-lg font-semibold text-slate-900">
                    {b.carrier.vehicle_type}
                    {b.carrier.license_plate && (
                      <span className="ml-2 rounded bg-slate-900 px-2 py-0.5 font-mono text-base text-white">
                        {b.carrier.license_plate}
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
        Read-only · refreshes every minute · Dock Delivery
      </footer>
    </main>
  );
}
