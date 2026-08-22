import Link from "next/link";
import { requireUser, getCarrierProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import BookingCard from "./booking-card";
import type { Booking, Dock, Facility, Slot } from "@/lib/types";

export type CarrierBooking = Booking & {
  slot: Slot & {
    dock: Pick<Dock, "name" | "notes"> & {
      facility: Pick<Facility, "id" | "name" | "city" | "address" | "timezone" | "cancellation_cutoff_hours">;
    };
  };
};

export default async function CarrierHomePage({
  searchParams,
}: {
  searchParams: Promise<{ booked?: string }>;
}) {
  await requireUser();
  const profile = await getCarrierProfile();
  const { booked } = await searchParams;
  const supabase = await createClient();

  if (!profile?.carrier) {
    return (
      <div className="card text-center">
        <p className="text-3xl">👋</p>
        <h1 className="mt-2 text-xl font-bold text-slate-900">Set up your carrier profile</h1>
        <p className="mt-1 text-slate-600">
          Two minutes: company, contact, and vehicle. Then your bookings live here.
        </p>
        <Link href="/carrier/profile" className="btn btn-primary mt-4">Create profile</Link>
      </div>
    );
  }

  const [{ data: bookings }, { data: invites }] = await Promise.all([
    supabase
      .from("bookings")
      .select(
        "*, slot:slots(*, dock:docks(name, notes, facility:facilities(id, name, city, address, timezone, cancellation_cutoff_hours)))"
      )
      .eq("carrier_id", profile.carrier.id)
      .neq("status", "cancelled")
      .order("created_at", { ascending: false }),
    supabase.from("facility_invites").select("facility_id, facility:facilities(id, name, city, timezone)"),
  ]);

  // Server component rendered per-request — "now" is request time.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const typedBookings = (bookings ?? []) as unknown as CarrierBooking[];
  const upcoming = typedBookings
    .filter((b) => new Date(b.slot.end_time).getTime() > now - 12 * 36e5)
    .sort((a, b) => a.slot.start_time.localeCompare(b.slot.start_time));

  const facilities = (invites ?? [])
    .map((i) => i.facility as unknown as Pick<Facility, "id" | "name" | "city" | "timezone"> | null)
    .filter((f): f is Pick<Facility, "id" | "name" | "city" | "timezone"> => f !== null);

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
              Pick a facility below and book any open dock slot — no waiting
              for an invite to a specific date.
            </p>
          </div>
        )}
        <div className="mt-4 flex flex-col gap-4">
          {upcoming.map((booking) => (
            <BookingCard key={booking.id} booking={booking} />
          ))}
        </div>
      </section>

      {facilities.length > 0 && (
        <section>
          <h2 className="text-xl font-bold text-slate-900">Facilities you can book at</h2>
          <ul className="mt-4 flex flex-col gap-3">
            {facilities.map((facility) => (
              <li key={facility.id}>
                <Link href={`/carrier/facilities/${facility.id}`} className="card block hover:border-slate-400">
                  <h3 className="text-lg font-bold text-slate-900">{facility.name}</h3>
                  <p className="mt-0.5 text-slate-600">{facility.city}</p>
                  <p className="mt-2 font-semibold text-slate-900 underline">Browse open slots →</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
