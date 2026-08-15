import Link from "next/link";
import { requireUser, getVendorProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDay, formatTimeRange } from "@/lib/time";
import BookingCard from "./booking-card";
import type { Booking, Dock, Event, Slot, Venue } from "@/lib/types";

export type VendorBooking = Booking & {
  slot: Slot & {
    dock: Pick<Dock, "name" | "notes">;
    event: Event & { venue: Pick<Venue, "name" | "city" | "address" | "timezone" | "cancellation_cutoff_hours"> };
  };
};

export default async function VendorHomePage({
  searchParams,
}: {
  searchParams: Promise<{ booked?: string }>;
}) {
  await requireUser();
  const profile = await getVendorProfile();
  const { booked } = await searchParams;
  const supabase = await createClient();

  if (!profile?.vendor) {
    return (
      <div className="card text-center">
        <p className="text-3xl">👋</p>
        <h1 className="mt-2 text-xl font-bold text-slate-900">Set up your vendor profile</h1>
        <p className="mt-1 text-slate-600">
          Two minutes: company, contact, and vehicle. Then your bookings live here.
        </p>
        <Link href="/vendor/profile" className="btn btn-primary mt-4">Create profile</Link>
      </div>
    );
  }

  const [{ data: bookings }, { data: invitedEvents }] = await Promise.all([
    supabase
      .from("bookings")
      .select(
        "*, slot:slots(*, dock:docks(name, notes), event:events(*, venue:venues(name, city, address, timezone, cancellation_cutoff_hours)))"
      )
      .eq("vendor_id", profile.vendor.id)
      .neq("status", "cancelled")
      .order("created_at", { ascending: false }),
    supabase.from("events").select("*, venue:venues(name, city, timezone)").eq("status", "published"),
  ]);

  // Server component rendered per-request — "now" is request time.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const typedBookings = (bookings ?? []) as unknown as VendorBooking[];
  const upcoming = typedBookings
    .filter((b) => new Date(b.slot.end_time).getTime() > now - 12 * 36e5)
    .sort((a, b) => a.slot.start_time.localeCompare(b.slot.start_time));
  const bookedEventIds = new Set(upcoming.map((b) => b.slot.event.id));
  const openInvites = (invitedEvents ?? []).filter(
    (e: Event) => !bookedEventIds.has(e.id) && new Date((e as Event).load_in_end).getTime() > now
  );

  return (
    <div className="flex flex-col gap-8">
      {booked && (
        <p className="rounded-lg bg-green-50 px-4 py-3 font-semibold text-green-800">
          ✅ Slot booked — confirmation email on its way.
        </p>
      )}

      <section>
        <h1 className="text-2xl font-bold text-slate-900">Upcoming deliveries</h1>
        {upcoming.length === 0 && (
          <div className="card mt-4 text-center">
            <p className="text-3xl">🚚</p>
            <p className="mt-2 font-bold text-slate-900">Nothing booked yet</p>
            <p className="mt-1 text-slate-600">
              When a venue invites you to an event, it shows up below — pick a
              slot and you&apos;re on the gate list.
            </p>
          </div>
        )}
        <div className="mt-4 flex flex-col gap-4">
          {upcoming.map((booking) => (
            <BookingCard key={booking.id} booking={booking} />
          ))}
        </div>
      </section>

      {openInvites.length > 0 && (
        <section>
          <h2 className="text-xl font-bold text-slate-900">Events you can book</h2>
          <ul className="mt-4 flex flex-col gap-3">
            {openInvites.map((event) => {
              const venue = event.venue as unknown as Pick<Venue, "name" | "city" | "timezone">;
              return (
                <li key={event.id}>
                  <Link href={`/vendor/events/${event.id}`} className="card block hover:border-slate-400">
                    <h3 className="text-lg font-bold text-slate-900">{event.name}</h3>
                    <p className="mt-0.5 text-slate-600">
                      {venue.name}, {venue.city} · {formatDay(event.load_in_start, venue.timezone)} ·{" "}
                      {formatTimeRange(event.load_in_start, event.load_in_end, venue.timezone)}
                    </p>
                    <p className="mt-2 font-semibold text-slate-900 underline">Choose a slot →</p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
