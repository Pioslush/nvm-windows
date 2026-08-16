import Link from "next/link";
import { requireUser, getVendorProfile } from "@/lib/auth";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDayLong, formatTimeRange, zoneAbbr } from "@/lib/time";
import SlotPicker from "./slot-picker";
import type { Dock, Slot, Venue } from "@/lib/types";

export default async function VendorEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ reschedule?: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const { reschedule } = await searchParams;
  const profile = await getVendorProfile();
  if (!profile?.vendor) {
    redirect(`/vendor/profile?next=${encodeURIComponent(`/vendor/events/${id}`)}`);
  }

  const supabase = await createClient();
  // RLS hides draft events and events this vendor wasn't invited to.
  const { data: event } = await supabase
    .from("events")
    .select("*, venue:venues(name, city, address, timezone)")
    .eq("id", id)
    .maybeSingle();

  if (!event) {
    return (
      <div className="card text-center">
        <p className="text-3xl">🔒</p>
        <h1 className="mt-2 text-xl font-bold text-slate-900">This event isn&apos;t available</h1>
        <p className="mt-1 text-slate-600">
          It may not be published yet, or the invite may have been sent to a
          different email address. Check with the venue.
        </p>
        <Link href="/vendor" className="btn btn-secondary mt-4">Back to my deliveries</Link>
      </div>
    );
  }

  const venue = event.venue as unknown as Pick<Venue, "name" | "city" | "address" | "timezone">;

  const [{ data: slots }, { data: docks }, { data: ownBookings }] = await Promise.all([
    supabase.from("slots").select("*").eq("event_id", id).order("start_time"),
    supabase.from("docks").select("*"),
    supabase
      .from("bookings")
      .select("*, slot:slots(event_id)")
      .eq("vendor_id", profile!.vendor!.id)
      .neq("status", "cancelled"),
  ]);

  const existingBooking = (ownBookings ?? []).find(
    (b) => (b.slot as { event_id: string } | null)?.event_id === id && b.id !== reschedule
  );

  const openSlots = ((slots ?? []) as Slot[]).filter((s) => s.status === "open");
  const dockById = new Map(((docks ?? []) as Dock[]).map((d) => [d.id, d]));
  const grouped = [...new Set(openSlots.map((s) => s.dock_id))].map((dockId) => ({
    dock: dockById.get(dockId) ?? null,
    dockId,
    slots: openSlots.filter((s) => s.dock_id === dockId),
  }));

  return (
    <div>
      <p className="text-sm font-bold uppercase tracking-widest text-slate-500">
        {venue.name} · {venue.city}
      </p>
      <h1 className="mt-1 text-2xl font-bold text-slate-900">{event.name}</h1>
      <p className="mt-1 text-slate-600">
        {formatDayLong(event.load_in_start, venue.timezone)} · Load-in{" "}
        {formatTimeRange(event.load_in_start, event.load_in_end, venue.timezone)}
      </p>
      {venue.address && <p className="mt-1 text-sm text-slate-500">📍 {venue.address}</p>}

      {existingBooking && !reschedule ? (
        <div className="card mt-6 text-center">
          <p className="text-3xl">✅</p>
          <h2 className="mt-2 text-lg font-bold text-slate-900">
            You already have a slot for this event
          </h2>
          <p className="mt-1 text-slate-600">
            Manage it — reschedule, cancel, or flag you&apos;re running late — from
            your deliveries page.
          </p>
          <Link href="/vendor" className="btn btn-primary mt-4">My deliveries</Link>
        </div>
      ) : (
        <SlotPicker
          eventId={id}
          groups={grouped.map((g) => ({
            dockName: g.dock?.name ?? "Dock",
            dockNotes: g.dock?.notes ?? null,
            slots: g.slots.map((s) => ({
              id: s.id,
              label: formatTimeRange(s.start_time, s.end_time, venue.timezone),
            })),
          }))}
          timezoneLabel={zoneAbbr(venue.timezone)}
          rescheduleBookingId={reschedule ?? null}
        />
      )}
    </div>
  );
}
