import { notFound } from "next/navigation";
import { requireAdminFacility } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { setDockAvailability, toggleSlotBlocked } from "@/app/actions/admin";
import { formatDay, formatTimeBare, zoneAbbr } from "@/lib/time";
import type { Booking, Carrier, DockAvailability, Slot } from "@/lib/types";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type SlotWithBooking = Slot & {
  bookings: (Booking & { carrier: Carrier })[];
};

export default async function DockDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { facility } = await requireAdminFacility();
  const supabase = await createClient();
  const tz = facility.timezone;

  const { data: dock } = await supabase.from("docks").select("*").eq("id", id).maybeSingle();
  if (!dock || dock.facility_id !== facility.id) notFound();

  // Server component rendered per-request — "now" is request time.
  // eslint-disable-next-line react-hooks/purity
  const horizonEnd = new Date(Date.now() + 7 * 24 * 36e5).toISOString();
  const [{ data: availability }, { data: slots }] = await Promise.all([
    supabase.from("dock_availability").select("*").eq("dock_id", id).order("day_of_week"),
    supabase
      .from("slots")
      .select("*, bookings(*, carrier:carriers(*))")
      .eq("dock_id", id)
      .gte("start_time", new Date().toISOString())
      .lte("start_time", horizonEnd)
      .order("start_time"),
  ]);

  const availByDay = new Map<number, DockAvailability>((availability ?? []).map((a: DockAvailability) => [a.day_of_week, a]));
  const activeBooking = (slot: SlotWithBooking) => slot.bookings.find((b) => b.status !== "cancelled");

  const slotsByDate = new Map<string, SlotWithBooking[]>();
  for (const slot of (slots ?? []) as SlotWithBooking[]) {
    const dateKey = formatDay(slot.start_time, tz);
    const list = slotsByDate.get(dateKey) ?? [];
    list.push(slot);
    slotsByDate.set(dateKey, list);
  }

  const anyAvailability = (availability ?? []).length > 0;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{dock.name}</h1>
        {dock.notes && <p className="mt-1 text-slate-600">{dock.notes}</p>}
      </div>

      {/* Weekly availability template */}
      <section className="card">
        <h2 className="text-lg font-bold text-slate-900">Weekly availability</h2>
        <p className="mt-1 text-sm text-slate-600">
          Pick the days and hours this dock takes deliveries. Slots regenerate
          automatically for the next 21 days whenever you save, and a daily job
          keeps that window rolling forward.
        </p>
        <form action={setDockAvailability} className="mt-4 flex flex-col gap-4">
          <input type="hidden" name="dock_id" value={dock.id} />
          <div>
            <span className="label">Days</span>
            <div className="flex flex-wrap gap-2">
              {DAY_LABELS.map((label, day) => (
                <label
                  key={day}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border-2 border-slate-300 px-3 py-2 font-semibold has-checked:border-slate-900 has-checked:bg-slate-900 has-checked:text-white"
                >
                  <input
                    type="checkbox"
                    name="day_of_week"
                    value={day}
                    defaultChecked={availByDay.has(day)}
                    className="sr-only"
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="start_time" className="label">
                Opens ({zoneAbbr(tz)})
              </label>
              <input
                id="start_time"
                name="start_time"
                type="time"
                required
                className="field"
                defaultValue={availability?.[0]?.start_time?.slice(0, 5) ?? "08:00"}
              />
            </div>
            <div>
              <label htmlFor="end_time" className="label">
                Closes ({zoneAbbr(tz)})
              </label>
              <input
                id="end_time"
                name="end_time"
                type="time"
                required
                className="field"
                defaultValue={availability?.[0]?.end_time?.slice(0, 5) ?? "18:00"}
              />
            </div>
          </div>
          <div>
            <span className="label">Slot length</span>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-slate-300 px-4 py-3 font-semibold has-checked:border-slate-900 has-checked:bg-slate-900 has-checked:text-white">
                <input
                  type="radio"
                  name="interval"
                  value="30"
                  defaultChecked={availability?.[0]?.slot_interval_minutes !== 60}
                  className="sr-only"
                />
                30 minutes
              </label>
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-slate-300 px-4 py-3 font-semibold has-checked:border-slate-900 has-checked:bg-slate-900 has-checked:text-white">
                <input
                  type="radio"
                  name="interval"
                  value="60"
                  defaultChecked={availability?.[0]?.slot_interval_minutes === 60}
                  className="sr-only"
                />
                60 minutes
              </label>
            </div>
          </div>
          <button type="submit" className="btn btn-primary self-start">
            Save availability
          </button>
        </form>
      </section>

      {/* Upcoming slots */}
      <section>
        <h2 className="text-lg font-bold text-slate-900">
          Next 7 days <span className="font-normal text-slate-500">(times in {zoneAbbr(tz)})</span>
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Tap an open slot to block it (maintenance, staff parking, …); tap a blocked slot to reopen it.
        </p>

        {!anyAvailability && (
          <div className="card mt-4 text-center">
            <p className="text-3xl">🗓️</p>
            <h3 className="mt-2 font-bold text-slate-900">No availability set yet</h3>
            <p className="mt-1 text-slate-600">Set this dock&apos;s weekly hours above to generate slots.</p>
          </div>
        )}

        {anyAvailability && slotsByDate.size === 0 && (
          <div className="card mt-4 text-center">
            <p className="text-slate-600">No slots in the next 7 days yet — they&apos;ll appear shortly.</p>
          </div>
        )}

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {[...slotsByDate.entries()].map(([date, dateSlots]) => (
            <div key={date} className="card">
              <h3 className="font-bold text-slate-900">{date}</h3>
              <ul className="mt-3 flex flex-col gap-2">
                {dateSlots.map((slot) => {
                  const booking = activeBooking(slot);
                  return (
                    <li key={slot.id}>
                      {booking ? (
                        <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-100 px-4 py-3">
                          <span className="font-semibold text-slate-900">
                            {formatTimeBare(slot.start_time, tz)} – {formatTimeBare(slot.end_time, tz)}
                          </span>
                          <span className="truncate text-sm font-semibold text-slate-600">
                            {booking.carrier.company_name}
                            {booking.status === "pending" && " (pending)"}
                          </span>
                        </div>
                      ) : (
                        <form action={toggleSlotBlocked}>
                          <input type="hidden" name="slot_id" value={slot.id} />
                          <button
                            type="submit"
                            className={`flex w-full items-center justify-between gap-2 rounded-lg border-2 px-4 py-3 font-semibold ${
                              slot.status === "blocked"
                                ? "border-slate-200 bg-slate-50 text-slate-400 line-through"
                                : "border-green-200 bg-green-50 text-green-900 hover:border-green-400"
                            }`}
                          >
                            <span>
                              {formatTimeBare(slot.start_time, tz)} – {formatTimeBare(slot.end_time, tz)}
                            </span>
                            <span className="text-sm">{slot.status === "blocked" ? "blocked" : "open"}</span>
                          </button>
                        </form>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
