"use client";

import Link from "next/link";
import { useActionState } from "react";
import { cancelBooking, markRunningLate } from "@/app/actions/vendor";
import { formatDayLong, formatTimeRange, hoursUntil } from "@/lib/time";
import type { VendorBooking } from "./page";
import type { BookingStatus } from "@/lib/types";

const STATUS_CHIP: Record<BookingStatus, { label: string; className: string }> = {
  pending: { label: "Awaiting approval", className: "bg-amber-100 text-amber-800" },
  confirmed: { label: "Confirmed", className: "bg-green-100 text-green-800" },
  checked_in: { label: "Checked in", className: "bg-blue-100 text-blue-800" },
  late: { label: "Running late", className: "bg-orange-100 text-orange-800" },
  no_show: { label: "No-show", className: "bg-red-100 text-red-800" },
  cancelled: { label: "Cancelled", className: "bg-slate-100 text-slate-500" },
};

export default function BookingCard({ booking }: { booking: VendorBooking }) {
  const [cancelState, cancelAction, cancelPending] = useActionState(cancelBooking, null);
  const venue = booking.slot.event.venue;
  const chip = STATUS_CHIP[booking.status];
  const withinCutoff = hoursUntil(booking.slot.start_time) < venue.cancellation_cutoff_hours;
  const isGameDay = hoursUntil(booking.slot.start_time) < 24;

  return (
    <div className="card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-bold text-slate-900">{booking.slot.event.name}</h3>
          <p className="text-slate-600">
            {venue.name}, {venue.city}
          </p>
        </div>
        <span className={`chip ${chip.className}`}>{chip.label}</span>
      </div>

      <div className="mt-3 rounded-lg bg-slate-50 p-4">
        <p className="text-xl font-extrabold text-slate-900">
          {formatTimeRange(booking.slot.start_time, booking.slot.end_time, venue.timezone)}
        </p>
        <p className="mt-0.5 font-semibold text-slate-700">
          {formatDayLong(booking.slot.start_time, venue.timezone)} · {booking.slot.dock.name}
        </p>
        {venue.address && <p className="mt-1 text-sm text-slate-500">{venue.address}</p>}
        {booking.slot.dock.notes && (
          <p className="mt-1 text-sm text-slate-500">⚠️ {booking.slot.dock.notes}</p>
        )}
        <p className="mt-2 text-sm text-slate-500">“{booking.purpose}”</p>
      </div>

      {booking.status !== "cancelled" && booking.status !== "no_show" && (
        <div className="mt-4 flex flex-wrap gap-2">
          {isGameDay && booking.status !== "late" && booking.status !== "checked_in" && (
            <form action={markRunningLate}>
              <input type="hidden" name="booking_id" value={booking.id} />
              <button type="submit" className="btn bg-orange-600 text-white hover:bg-orange-500">
                🕐 I&apos;m running late
              </button>
            </form>
          )}
          {booking.status === "late" && (
            <p className="w-full rounded-lg bg-orange-50 px-4 py-3 text-sm font-semibold text-orange-800">
              The venue has been notified you&apos;re running late. Head to {booking.slot.dock.name} when you arrive.
            </p>
          )}
          {!withinCutoff && (
            <>
              <Link
                href={`/vendor/events/${booking.slot.event.id}?reschedule=${booking.id}`}
                className="btn btn-secondary"
              >
                Reschedule
              </Link>
              <form action={cancelAction}>
                <input type="hidden" name="booking_id" value={booking.id} />
                <button type="submit" className="btn btn-danger" disabled={cancelPending}>
                  {cancelPending ? "Cancelling…" : "Cancel booking"}
                </button>
              </form>
            </>
          )}
          {withinCutoff && !isGameDay && (
            <p className="w-full text-sm text-slate-500">
              Changes are locked within {venue.cancellation_cutoff_hours} hours of your slot — call the venue if plans change.
            </p>
          )}
        </div>
      )}
      {cancelState?.error && (
        <p className="mt-2 text-sm font-semibold text-red-700">{cancelState.error}</p>
      )}
      {cancelState?.ok && (
        <p className="mt-2 text-sm font-semibold text-green-700">{cancelState.ok}</p>
      )}
    </div>
  );
}
