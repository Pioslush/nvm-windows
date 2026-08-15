import { notFound } from "next/navigation";
import { requireAdminVenue } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  setEventStatus,
  toggleSlotBlocked,
  removeInvite,
  approveBooking,
  declineBooking,
  createGateToken,
  revokeGateToken,
} from "@/app/actions/admin";
import { formatDayLong, formatTimeRange, formatTimeBare, zoneAbbr } from "@/lib/time";
import InviteForm from "./invite-form";
import CopyButton from "@/app/components/copy-button";
import type { Booking, Dock, EventInvite, GateListToken, Slot, Vendor } from "@/lib/types";

type SlotWithBooking = Slot & {
  bookings: (Booking & { vendor: Vendor })[];
};

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { venue } = await requireAdminVenue();
  const supabase = await createClient();

  const { data: event } = await supabase.from("events").select("*").eq("id", id).maybeSingle();
  if (!event || event.venue_id !== venue.id) notFound();

  const [{ data: docks }, { data: slots }, { data: invites }, { data: gateTokens }] =
    await Promise.all([
      supabase.from("docks").select("*").eq("venue_id", venue.id).order("name"),
      supabase
        .from("slots")
        .select("*, bookings(*, vendor:vendors(*))")
        .eq("event_id", id)
        .order("start_time"),
      supabase.from("event_invites").select("*").eq("event_id", id).order("created_at"),
      supabase.from("gate_list_tokens").select("*").eq("event_id", id).order("created_at"),
    ]);

  const tz = venue.timezone;
  const slotsByDock = new Map<string, SlotWithBooking[]>();
  for (const slot of (slots ?? []) as SlotWithBooking[]) {
    const list = slotsByDock.get(slot.dock_id) ?? [];
    list.push(slot);
    slotsByDock.set(slot.dock_id, list);
  }
  const activeBooking = (slot: SlotWithBooking) =>
    slot.bookings.find((b) => b.status !== "cancelled");
  const pendingBookings = ((slots ?? []) as SlotWithBooking[])
    .flatMap((s) => s.bookings.filter((b) => b.status === "pending").map((b) => ({ slot: s, booking: b })));

  const appBase = process.env.NEXT_PUBLIC_APP_URL ?? "";

  return (
    <div className="flex flex-col gap-8">
      {/* Header + publish controls */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{event.name}</h1>
            <p className="mt-1 text-slate-600">
              {formatDayLong(event.load_in_start, tz)} · Load-in{" "}
              {formatTimeRange(event.load_in_start, event.load_in_end, tz)}
            </p>
          </div>
          <form action={setEventStatus}>
            <input type="hidden" name="event_id" value={event.id} />
            {event.status === "draft" && (
              <>
                <input type="hidden" name="status" value="published" />
                <button type="submit" className="btn btn-primary">Publish event</button>
              </>
            )}
            {event.status === "published" && (
              <>
                <input type="hidden" name="status" value="completed" />
                <button type="submit" className="btn btn-secondary">Mark completed</button>
              </>
            )}
            {event.status === "completed" && (
              <span className="chip bg-slate-200 text-slate-600">Completed</span>
            )}
          </form>
        </div>
        {event.status === "draft" && (
          <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 font-semibold text-amber-800">
            Draft — vendors can&apos;t see or book this event until you publish it.
          </p>
        )}
      </div>

      {/* Pending approvals */}
      {pendingBookings.length > 0 && (
        <section className="card border-amber-300 bg-amber-50">
          <h2 className="text-lg font-bold text-slate-900">
            Needs approval ({pendingBookings.length})
          </h2>
          <ul className="mt-3 flex flex-col gap-3">
            {pendingBookings.map(({ slot, booking }) => (
              <li key={booking.id} className="rounded-lg bg-white p-4">
                <p className="font-bold text-slate-900">{booking.vendor.company_name}</p>
                <p className="text-slate-600">
                  {docks?.find((d: Dock) => d.id === slot.dock_id)?.name} ·{" "}
                  {formatTimeRange(slot.start_time, slot.end_time, tz)}
                </p>
                <p className="mt-1 text-sm text-slate-500">“{booking.purpose}”</p>
                <div className="mt-3 flex gap-2">
                  <form action={approveBooking}>
                    <input type="hidden" name="booking_id" value={booking.id} />
                    <button type="submit" className="btn btn-primary">Approve</button>
                  </form>
                  <form action={declineBooking}>
                    <input type="hidden" name="booking_id" value={booking.id} />
                    <button type="submit" className="btn btn-danger">Decline</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Slot grid per dock */}
      <section>
        <h2 className="text-lg font-bold text-slate-900">
          Slots <span className="font-normal text-slate-500">(times in {zoneAbbr(tz)})</span>
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Tap an open slot to block it (maintenance, staff parking, …); tap a
          blocked slot to reopen it.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {[...slotsByDock.entries()].map(([dockId, dockSlots]) => {
            const dock = docks?.find((d: Dock) => d.id === dockId);
            return (
              <div key={dockId} className="card">
                <h3 className="font-bold text-slate-900">{dock?.name ?? "Dock"}</h3>
                {dock?.notes && <p className="text-sm text-slate-500">{dock.notes}</p>}
                <ul className="mt-3 flex flex-col gap-2">
                  {dockSlots.map((slot) => {
                    const booking = activeBooking(slot);
                    return (
                      <li key={slot.id}>
                        {booking ? (
                          <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-100 px-4 py-3">
                            <span className="font-semibold text-slate-900">
                              {formatTimeBare(slot.start_time, tz)} – {formatTimeBare(slot.end_time, tz)}
                            </span>
                            <span className="truncate text-sm font-semibold text-slate-600">
                              {booking.vendor.company_name}
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
                              <span className="text-sm">
                                {slot.status === "blocked" ? "blocked" : "open"}
                              </span>
                            </button>
                          </form>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      {/* Invites */}
      <section className="card">
        <h2 className="text-lg font-bold text-slate-900">Invite vendors</h2>
        <p className="mt-1 text-sm text-slate-600">
          Each vendor gets an email with a personal link to this event&apos;s open
          slots. Invite them any time — they only see the event once it&apos;s published.
        </p>
        <div className="mt-4">
          <InviteForm eventId={event.id} />
        </div>
        {invites && invites.length > 0 && (
          <ul className="mt-4 flex flex-col gap-2">
            {invites.map((invite: EventInvite) => (
              <li
                key={invite.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-4 py-2.5"
              >
                <span className="truncate font-semibold text-slate-700">{invite.vendor_email}</span>
                <form action={removeInvite}>
                  <input type="hidden" name="invite_id" value={invite.id} />
                  <input type="hidden" name="event_id" value={event.id} />
                  <button type="submit" className="text-sm font-semibold text-red-600 underline">
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Gate list */}
      <section className="card">
        <h2 className="text-lg font-bold text-slate-900">Security gate list</h2>
        <p className="mt-1 text-sm text-slate-600">
          A read-only, phone-friendly list of every confirmed delivery — company,
          contact, vehicle, plate, dock, and time window. Share the link with the
          gate; no login needed. It expires 24 hours after load-in ends.
        </p>
        {gateTokens && gateTokens.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-2">
            {gateTokens.map((t: GateListToken) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-4 py-2.5">
                <code className="min-w-0 flex-1 truncate text-sm text-slate-700">
                  {appBase ? `${appBase}/gate/${t.token}` : `/gate/${t.token}`}
                </code>
                <CopyButton text={appBase ? `${appBase}/gate/${t.token}` : `/gate/${t.token}`} />
                <a href={`/gate/${t.token}`} target="_blank" className="btn btn-secondary !min-h-0 !px-3 !py-1.5 text-sm">
                  Open
                </a>
                <form action={revokeGateToken}>
                  <input type="hidden" name="token_id" value={t.id} />
                  <input type="hidden" name="event_id" value={event.id} />
                  <button type="submit" className="text-sm font-semibold text-red-600 underline">
                    Revoke
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <form action={createGateToken} className="mt-4">
            <input type="hidden" name="event_id" value={event.id} />
            <button type="submit" className="btn btn-primary">Generate gate list link</button>
          </form>
        )}
      </section>
    </div>
  );
}
