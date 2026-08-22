import Link from "next/link";
import { requireAdminFacility } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { setBookingStatus } from "@/app/actions/admin";
import { formatTimeBare, todayInFacility, zoneAbbr } from "@/lib/time";
import { fromZonedTime } from "date-fns-tz";
import AutoRefresh from "@/app/components/auto-refresh";
import type { Booking, BookingStatus, Carrier, Dock, Slot } from "@/lib/types";

type TodayBooking = Booking & {
  carrier: Carrier;
  slot: Slot & { dock: Dock };
};

const CHIP: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  confirmed: "bg-green-100 text-green-800",
  checked_in: "bg-blue-100 text-blue-800",
  late: "bg-orange-100 text-orange-800",
  no_show: "bg-red-100 text-red-800",
};

const CHIP_LABEL: Record<string, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  checked_in: "Checked in",
  late: "Late",
  no_show: "No-show",
};

/** One-tap transitions per current status. */
const NEXT_ACTIONS: Record<string, { status: BookingStatus; label: string; cls: string }[]> = {
  confirmed: [
    { status: "checked_in", label: "✓ Check in", cls: "bg-blue-600 text-white hover:bg-blue-500" },
    { status: "late", label: "Late", cls: "bg-orange-100 text-orange-900 hover:bg-orange-200" },
    { status: "no_show", label: "No-show", cls: "bg-red-100 text-red-900 hover:bg-red-200" },
  ],
  late: [
    { status: "checked_in", label: "✓ Check in", cls: "bg-blue-600 text-white hover:bg-blue-500" },
    { status: "no_show", label: "No-show", cls: "bg-red-100 text-red-900 hover:bg-red-200" },
  ],
  checked_in: [
    { status: "confirmed", label: "Undo check-in", cls: "bg-slate-100 text-slate-700 hover:bg-slate-200" },
  ],
  no_show: [
    { status: "confirmed", label: "Undo", cls: "bg-slate-100 text-slate-700 hover:bg-slate-200" },
  ],
  pending: [],
};

export default async function TodayPage() {
  const { facility } = await requireAdminFacility();
  const supabase = await createClient();
  const tz = facility.timezone;
  const today = todayInFacility(tz);
  const dayStart = fromZonedTime(`${today}T00:00:00`, tz);
  const dayEnd = fromZonedTime(`${today}T23:59:59.999`, tz);

  const { data: docks } = await supabase.from("docks").select("id").eq("facility_id", facility.id);
  const dockIds = (docks ?? []).map((d: { id: string }) => d.id);

  let bookings: TodayBooking[] = [];
  if (dockIds.length > 0) {
    const { data } = await supabase
      .from("bookings")
      .select("*, carrier:carriers(*), slot:slots!inner(*, dock:docks!inner(*))")
      .in("slot.dock_id", dockIds)
      .neq("status", "cancelled")
      .gte("slot.start_time", dayStart.toISOString())
      .lte("slot.start_time", dayEnd.toISOString())
      .order("start_time", { referencedTable: "slot" });
    bookings = (data ?? []) as unknown as TodayBooking[];
  }

  const byDock = new Map<string, TodayBooking[]>();
  for (const b of bookings) {
    const list = byDock.get(b.slot.dock.name) ?? [];
    list.push(b);
    byDock.set(b.slot.dock.name, list);
  }

  return (
    <div>
      <AutoRefresh seconds={30} />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold text-slate-900">Today at the docks</h1>
        <p className="text-sm font-semibold text-slate-500">
          Times in {zoneAbbr(tz)} · auto-refreshes every 30s
        </p>
      </div>

      {bookings.length === 0 && (
        <div className="card mt-6 text-center">
          <p className="text-3xl">📭</p>
          <h2 className="mt-2 text-lg font-bold text-slate-900">No bookings today</h2>
          <p className="mx-auto mt-1 max-w-sm text-slate-600">
            Quiet day at the docks. As carriers book today&apos;s slots, they&apos;ll
            show up here with one-tap check-in.
          </p>
          <Link href="/schedule" className="btn btn-secondary mt-4">View full schedule</Link>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-6">
        {[...byDock.entries()].map(([dockName, dockBookings]) => (
          <section key={dockName}>
            <h2 className="text-lg font-extrabold uppercase tracking-wide text-slate-700">
              {dockName}
            </h2>
            <ul className="mt-2 flex flex-col gap-3">
              {dockBookings.map((b) => (
                <li key={b.id} className="card">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-baseline gap-4">
                      <span className="text-2xl font-extrabold tabular-nums text-slate-900">
                        {formatTimeBare(b.slot.start_time, tz)}
                      </span>
                      <div>
                        <p className="text-lg font-bold text-slate-900">{b.carrier.company_name}</p>
                        <p className="text-sm text-slate-600">
                          {b.carrier.contact_name} · {b.carrier.phone} · {b.carrier.vehicle_type}
                          {b.carrier.license_plate ? ` · ${b.carrier.license_plate}` : ""}
                        </p>
                        <p className="mt-0.5 text-sm text-slate-500">&ldquo;{b.purpose}&rdquo;</p>
                      </div>
                    </div>
                    <span className={`chip ${CHIP[b.status] ?? ""}`}>{CHIP_LABEL[b.status] ?? b.status}</span>
                  </div>
                  {(NEXT_ACTIONS[b.status] ?? []).length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {NEXT_ACTIONS[b.status].map((action) => (
                        <form key={action.status} action={setBookingStatus}>
                          <input type="hidden" name="booking_id" value={b.id} />
                          <input type="hidden" name="status" value={action.status} />
                          <button type="submit" className={`btn ${action.cls}`}>
                            {action.label}
                          </button>
                        </form>
                      ))}
                    </div>
                  )}
                  {b.status === "pending" && (
                    <p className="mt-3 text-sm font-semibold text-amber-700">
                      Awaiting approval —{" "}
                      <Link href="/schedule" className="underline">
                        review on the schedule page
                      </Link>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
