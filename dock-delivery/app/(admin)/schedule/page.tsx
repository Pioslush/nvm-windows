import Link from "next/link";
import { requireAdminFacility } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { approveBooking, declineBooking } from "@/app/actions/admin";
import { formatTimeBare, todayInFacility, zoneAbbr } from "@/lib/time";
import { fromZonedTime } from "date-fns-tz";
import type { Booking, Carrier, Dock, Slot } from "@/lib/types";

type ScheduleBooking = Booking & {
  carrier: Carrier;
  slot: Slot & { dock: Dock };
};

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { facility } = await requireAdminFacility();
  const supabase = await createClient();
  const tz = facility.timezone;
  const { date: dateParam } = await searchParams;
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayInFacility(tz);

  const dayStart = fromZonedTime(`${date}T00:00:00`, tz);
  const dayEnd = fromZonedTime(`${date}T23:59:59.999`, tz);

  const { data: docks } = await supabase.from("docks").select("*").eq("facility_id", facility.id);
  const dockIds = (docks ?? []).map((d: Dock) => d.id);

  let dayBookings: ScheduleBooking[] = [];
  let pendingBookings: ScheduleBooking[] = [];

  if (dockIds.length > 0) {
    const [{ data: dayData }, { data: pendingData }] = await Promise.all([
      supabase
        .from("bookings")
        .select("*, carrier:carriers(*), slot:slots!inner(*, dock:docks!inner(*))")
        .in("slot.dock_id", dockIds)
        .neq("status", "cancelled")
        .gte("slot.start_time", dayStart.toISOString())
        .lte("slot.start_time", dayEnd.toISOString())
        .order("start_time", { referencedTable: "slot" }),
      supabase
        .from("bookings")
        .select("*, carrier:carriers(*), slot:slots!inner(*, dock:docks!inner(*))")
        .in("slot.dock_id", dockIds)
        .eq("status", "pending")
        .order("start_time", { referencedTable: "slot" }),
    ]);
    dayBookings = (dayData ?? []) as unknown as ScheduleBooking[];
    pendingBookings = (pendingData ?? []) as unknown as ScheduleBooking[];
  }

  const byDock = new Map<string, ScheduleBooking[]>();
  for (const b of dayBookings) {
    const list = byDock.get(b.slot.dock.name) ?? [];
    list.push(b);
    byDock.set(b.slot.dock.name, list);
  }

  const prevDate = new Date(dayStart.getTime() - 24 * 36e5);
  const nextDate = new Date(dayStart.getTime() + 24 * 36e5);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Schedule</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Link href={`/schedule?date=${fmt(prevDate)}`} className="btn btn-secondary !px-3">
            ← Prev
          </Link>
          <span className="rounded-lg bg-slate-100 px-4 py-2 font-bold text-slate-900">{date}</span>
          <Link href={`/schedule?date=${fmt(nextDate)}`} className="btn btn-secondary !px-3">
            Next →
          </Link>
          {date !== todayInFacility(tz) && (
            <Link href="/schedule" className="text-sm font-semibold text-slate-500 underline">
              Jump to today
            </Link>
          )}
          <span className="ml-auto text-sm font-semibold text-slate-500">Times in {zoneAbbr(tz)}</span>
        </div>
      </div>

      {(!docks || docks.length === 0) && (
        <div className="card text-center">
          <p className="text-3xl">🚚</p>
          <h2 className="mt-2 text-lg font-bold text-slate-900">Add a dock to get started</h2>
          <p className="mt-1 text-slate-600">
            Set up a dock, then define its weekly availability — slots generate automatically.
          </p>
          <Link href="/docks" className="btn btn-primary mt-4">Set up docks</Link>
        </div>
      )}

      {pendingBookings.length > 0 && (
        <section className="card border-amber-300 bg-amber-50">
          <h2 className="text-lg font-bold text-slate-900">
            Needs approval ({pendingBookings.length})
          </h2>
          <ul className="mt-3 flex flex-col gap-3">
            {pendingBookings.map((b) => (
              <li key={b.id} className="rounded-lg bg-white p-4">
                <p className="font-bold text-slate-900">{b.carrier.company_name}</p>
                <p className="text-slate-600">
                  {b.slot.dock.name} · {formatTimeBare(b.slot.start_time, tz)}
                </p>
                <p className="mt-1 text-sm text-slate-500">&ldquo;{b.purpose}&rdquo;</p>
                <div className="mt-3 flex gap-2">
                  <form action={approveBooking}>
                    <input type="hidden" name="booking_id" value={b.id} />
                    <button type="submit" className="btn btn-primary">Approve</button>
                  </form>
                  <form action={declineBooking}>
                    <input type="hidden" name="booking_id" value={b.id} />
                    <button type="submit" className="btn btn-danger">Decline</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {docks && docks.length > 0 && dayBookings.length === 0 && (
        <div className="card text-center">
          <p className="text-3xl">📭</p>
          <h2 className="mt-2 text-lg font-bold text-slate-900">No bookings on {date}</h2>
        </div>
      )}

      <div className="flex flex-col gap-6">
        {[...byDock.entries()].map(([dockName, bookings]) => (
          <section key={dockName}>
            <h2 className="text-lg font-extrabold uppercase tracking-wide text-slate-700">{dockName}</h2>
            <ul className="mt-2 flex flex-col gap-3">
              {bookings.map((b) => (
                <li key={b.id} className="card flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-baseline gap-4">
                    <span className="text-xl font-extrabold tabular-nums text-slate-900">
                      {formatTimeBare(b.slot.start_time, tz)}
                    </span>
                    <div>
                      <p className="font-bold text-slate-900">{b.carrier.company_name}</p>
                      <p className="text-sm text-slate-500">&ldquo;{b.purpose}&rdquo;</p>
                    </div>
                  </div>
                  <span className="chip bg-slate-100 text-slate-700">{b.status}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
