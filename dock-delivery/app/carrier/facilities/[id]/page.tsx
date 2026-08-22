import Link from "next/link";
import { requireUser, getCarrierProfile } from "@/lib/auth";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDay, formatTimeRange, zoneAbbr } from "@/lib/time";
import SlotPicker from "./slot-picker";
import type { Dock, Slot } from "@/lib/types";

const BOOKING_HORIZON_DAYS = 14;

export default async function CarrierFacilityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ reschedule?: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const { reschedule } = await searchParams;
  const profile = await getCarrierProfile();
  if (!profile?.carrier) {
    redirect(`/carrier/profile?next=${encodeURIComponent(`/carrier/facilities/${id}`)}`);
  }

  const supabase = await createClient();
  // RLS hides facilities this carrier wasn't invited to.
  const { data: facility } = await supabase
    .from("facilities")
    .select("id, name, city, address, timezone")
    .eq("id", id)
    .maybeSingle();

  if (!facility) {
    return (
      <div className="card text-center">
        <p className="text-3xl">🔒</p>
        <h1 className="mt-2 text-xl font-bold text-slate-900">This facility isn&apos;t available</h1>
        <p className="mt-1 text-slate-600">
          The invite may have been sent to a different email address. Check with the facility.
        </p>
        <Link href="/carrier" className="btn btn-secondary mt-4">Back to my deliveries</Link>
      </div>
    );
  }

  // Server component rendered per-request — "now" is request time.
  // eslint-disable-next-line react-hooks/purity
  const horizonEnd = new Date(Date.now() + BOOKING_HORIZON_DAYS * 24 * 36e5).toISOString();
  const [{ data: docks }, { data: slots }, { data: ownBookings }] = await Promise.all([
    supabase.from("docks").select("*").eq("facility_id", id),
    supabase
      .from("slots")
      .select("*, dock:docks!inner(facility_id)")
      .eq("dock.facility_id", id)
      .eq("status", "open")
      .gte("start_time", new Date().toISOString())
      .lte("start_time", horizonEnd)
      .order("start_time"),
    supabase
      .from("bookings")
      .select("*, slot:slots(dock:docks(facility_id))")
      .eq("carrier_id", profile!.carrier!.id)
      .neq("status", "cancelled"),
  ]);

  const existingBooking = (ownBookings ?? []).find(
    (b) =>
      (b.slot as unknown as { dock: { facility_id: string } } | null)?.dock?.facility_id === id &&
      b.id !== reschedule
  );

  const dockById = new Map(((docks ?? []) as Dock[]).map((d) => [d.id, d]));
  const openSlots = (slots ?? []) as Slot[];

  // Group by date (facility timezone), then by dock within each date.
  const byDate = new Map<string, Slot[]>();
  for (const slot of openSlots) {
    const dateKey = formatDay(slot.start_time, facility.timezone);
    const list = byDate.get(dateKey) ?? [];
    list.push(slot);
    byDate.set(dateKey, list);
  }
  const dateGroups = [...byDate.entries()].map(([date, dateSlots]) => ({
    date,
    dockGroups: [...new Set(dateSlots.map((s) => s.dock_id))].map((dockId) => ({
      dockName: dockById.get(dockId)?.name ?? "Dock",
      dockNotes: dockById.get(dockId)?.notes ?? null,
      slots: dateSlots
        .filter((s) => s.dock_id === dockId)
        .map((s) => ({ id: s.id, label: formatTimeRange(s.start_time, s.end_time, facility.timezone) })),
    })),
  }));

  return (
    <div>
      <p className="text-sm font-bold uppercase tracking-widest text-slate-500">
        {facility.name} · {facility.city}
      </p>
      {facility.address && <p className="mt-1 text-sm text-slate-500">📍 {facility.address}</p>}

      {existingBooking && !reschedule ? (
        <div className="card mt-6 text-center">
          <p className="text-3xl">✅</p>
          <h2 className="mt-2 text-lg font-bold text-slate-900">
            You already have a slot at this facility
          </h2>
          <p className="mt-1 text-slate-600">
            Manage it — reschedule, cancel, or flag you&apos;re running late — from
            your deliveries page.
          </p>
          <Link href="/carrier" className="btn btn-primary mt-4">My deliveries</Link>
        </div>
      ) : (
        <SlotPicker
          facilityId={id}
          dateGroups={dateGroups}
          timezoneLabel={zoneAbbr(facility.timezone)}
          rescheduleBookingId={reschedule ?? null}
        />
      )}
    </div>
  );
}
