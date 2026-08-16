import Link from "next/link";
import { requireAdminVenue } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDay, formatTimeRange } from "@/lib/time";
import type { Event } from "@/lib/types";

const STATUS_STYLE: Record<Event["status"], string> = {
  draft: "bg-slate-100 text-slate-600",
  published: "bg-green-100 text-green-800",
  completed: "bg-slate-200 text-slate-500",
};

export default async function DashboardPage() {
  const { venue } = await requireAdminVenue();
  const supabase = await createClient();
  const { data: events } = await supabase
    .from("events")
    .select("*")
    .eq("venue_id", venue.id)
    .order("event_date", { ascending: false });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Events</h1>
        <Link href="/events/new" className="btn btn-primary">
          + New event
        </Link>
      </div>

      {(!events || events.length === 0) && (
        <div className="card mt-6 text-center">
          <p className="text-3xl">🏟️</p>
          <h2 className="mt-2 text-lg font-bold text-slate-900">No events yet</h2>
          <p className="mx-auto mt-1 max-w-sm text-slate-600">
            Create your first event, and GameDay Dock will generate bookable
            dock slots for the load-in window.
          </p>
          <Link href="/events/new" className="btn btn-primary mt-4">
            Create your first event
          </Link>
        </div>
      )}

      <ul className="mt-6 flex flex-col gap-3">
        {events?.map((event: Event) => (
          <li key={event.id}>
            <Link href={`/events/${event.id}`} className="card block hover:border-slate-400">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">{event.name}</h2>
                  <p className="mt-0.5 text-slate-600">
                    {formatDay(event.load_in_start, venue.timezone)} · Load-in{" "}
                    {formatTimeRange(event.load_in_start, event.load_in_end, venue.timezone)}
                  </p>
                </div>
                <span className={`chip ${STATUS_STYLE[event.status]}`}>{event.status}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
