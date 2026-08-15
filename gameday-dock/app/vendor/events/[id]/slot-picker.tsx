"use client";

import { useState, useActionState } from "react";
import { bookSlot, rescheduleBooking } from "@/app/actions/vendor";

interface SlotOption {
  id: string;
  label: string;
}

export default function SlotPicker({
  eventId,
  groups,
  timezoneLabel,
  rescheduleBookingId,
}: {
  eventId: string;
  groups: { dockName: string; dockNotes: string | null; slots: SlotOption[] }[];
  timezoneLabel: string;
  rescheduleBookingId: string | null;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [bookState, bookAction, bookPending] = useActionState(bookSlot, null);
  const [reschedState, reschedAction, reschedPending] = useActionState(rescheduleBooking, null);

  const state = rescheduleBookingId ? reschedState : bookState;
  const pending = rescheduleBookingId ? reschedPending : bookPending;
  const totalOpen = groups.reduce((n, g) => n + g.slots.length, 0);

  if (totalOpen === 0) {
    return (
      <div className="card mt-6 text-center">
        <p className="text-3xl">😕</p>
        <h2 className="mt-2 text-lg font-bold text-slate-900">All slots are taken</h2>
        <p className="mt-1 text-slate-600">
          Check back later in case something opens up, or contact the venue directly.
        </p>
      </div>
    );
  }

  return (
    <form action={rescheduleBookingId ? reschedAction : bookAction} className="mt-6 flex flex-col gap-6">
      <input type="hidden" name="event_id" value={eventId} />
      {rescheduleBookingId && (
        <>
          <input type="hidden" name="booking_id" value={rescheduleBookingId} />
          <p className="rounded-lg bg-blue-50 px-4 py-3 font-semibold text-blue-800">
            Rescheduling: pick your new slot below. Your current slot is released
            only after the new one is secured.
          </p>
        </>
      )}

      <p className="text-sm font-semibold text-slate-500">
        All times {timezoneLabel}. Tap a slot to select it.
      </p>

      {groups.map((group) => (
        <div key={group.dockName} className="card">
          <h2 className="text-lg font-bold text-slate-900">{group.dockName}</h2>
          {group.dockNotes && <p className="text-sm text-slate-500">⚠️ {group.dockNotes}</p>}
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {group.slots.map((slot) => (
              <button
                key={slot.id}
                type="button"
                onClick={() => setSelected(slot.id)}
                className={`rounded-lg border-2 px-4 py-3 text-left font-semibold transition-colors ${
                  selected === slot.id
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-300 bg-white text-slate-900 hover:border-slate-500"
                }`}
              >
                {slot.label}
              </button>
            ))}
          </div>
        </div>
      ))}

      <input type="hidden" name={rescheduleBookingId ? "new_slot_id" : "slot_id"} value={selected ?? ""} />

      {!rescheduleBookingId && (
        <div>
          <label htmlFor="purpose" className="label">
            What are you delivering? (vehicle helps too)
          </label>
          <textarea
            id="purpose"
            name="purpose"
            required
            rows={2}
            className="field"
            placeholder="Beer delivery — 40 kegs, 1 box truck"
          />
        </div>
      )}

      {state?.error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 font-semibold text-red-800">{state.error}</p>
      )}
      {state?.ok && (
        <p className="rounded-lg bg-green-50 px-4 py-3 font-semibold text-green-800">{state.ok}</p>
      )}

      <button type="submit" className="btn btn-primary" disabled={!selected || pending}>
        {pending
          ? "Booking…"
          : rescheduleBookingId
            ? "Confirm new slot"
            : selected
              ? "Book this slot"
              : "Select a slot above"}
      </button>
    </form>
  );
}
