import Link from "next/link";
import { requireAdminVenue } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createEvent } from "@/app/actions/admin";
import { zoneAbbr } from "@/lib/time";
import type { Dock } from "@/lib/types";

export default async function NewEventPage() {
  const { venue } = await requireAdminVenue();
  const supabase = await createClient();
  const { data: docks } = await supabase
    .from("docks")
    .select("*")
    .eq("venue_id", venue.id)
    .order("name");

  if (!docks || docks.length === 0) {
    return (
      <div className="card mx-auto max-w-md text-center">
        <p className="text-3xl">🚚</p>
        <h1 className="mt-2 text-lg font-bold text-slate-900">Add a dock first</h1>
        <p className="mt-1 text-slate-600">
          Events generate delivery slots per dock, so you need at least one dock
          before creating an event.
        </p>
        <Link href="/docks" className="btn btn-primary mt-4">Set up docks</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-bold text-slate-900">New event</h1>
      <p className="mt-1 text-slate-600">
        All times are in the venue&apos;s timezone ({zoneAbbr(venue.timezone)}). Slots are
        auto-generated across the load-in window; you can block individual ones
        after.
      </p>

      <form action={createEvent} className="mt-6 flex flex-col gap-5">
        <div>
          <label htmlFor="name" className="label">Event name</label>
          <input id="name" name="name" required className="field" placeholder="Switchbacks vs. Sacramento" />
        </div>
        <div>
          <label htmlFor="event_date" className="label">Event date</label>
          <input id="event_date" name="event_date" type="date" required className="field" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="load_in_start" className="label">
              Load-in starts ({zoneAbbr(venue.timezone)})
            </label>
            <input id="load_in_start" name="load_in_start" type="time" required className="field" defaultValue="08:00" />
          </div>
          <div>
            <label htmlFor="load_in_end" className="label">
              Load-in ends ({zoneAbbr(venue.timezone)})
            </label>
            <input id="load_in_end" name="load_in_end" type="time" required className="field" defaultValue="12:00" />
          </div>
        </div>
        <div>
          <span className="label">Slot length</span>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-slate-300 px-4 py-3 font-semibold has-checked:border-slate-900 has-checked:bg-slate-900 has-checked:text-white">
              <input type="radio" name="interval" value="30" defaultChecked className="sr-only" />
              30 minutes
            </label>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-slate-300 px-4 py-3 font-semibold has-checked:border-slate-900 has-checked:bg-slate-900 has-checked:text-white">
              <input type="radio" name="interval" value="60" className="sr-only" />
              60 minutes
            </label>
          </div>
        </div>
        <div>
          <span className="label">Docks taking deliveries</span>
          <div className="flex flex-col gap-2">
            {docks.map((dock: Dock) => (
              <label
                key={dock.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg border-2 border-slate-300 px-4 py-3 font-semibold has-checked:border-slate-900"
              >
                <input
                  type="checkbox"
                  name="dock_ids"
                  value={dock.id}
                  defaultChecked
                  className="h-5 w-5 accent-slate-900"
                />
                {dock.name}
              </label>
            ))}
          </div>
        </div>
        <button type="submit" className="btn btn-primary">
          Create event &amp; generate slots
        </button>
        <p className="text-sm text-slate-500">
          Events start as drafts — vendors can&apos;t see them until you publish.
        </p>
      </form>
    </div>
  );
}
