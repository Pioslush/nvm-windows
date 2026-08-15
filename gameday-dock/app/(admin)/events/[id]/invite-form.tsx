"use client";

import { useActionState } from "react";
import { inviteVendor } from "@/app/actions/admin";

export default function InviteForm({ eventId }: { eventId: string }) {
  const [state, formAction, pending] = useActionState(inviteVendor, null);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="event_id" value={eventId} />
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="email"
          name="email"
          required
          className="field flex-1"
          placeholder="vendor@company.com"
          aria-label="Vendor email"
        />
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Sending…" : "Send invite"}
        </button>
      </div>
      {state?.error && <p className="text-sm font-semibold text-red-700">{state.error}</p>}
      {state?.ok && <p className="text-sm font-semibold text-green-700">{state.ok}</p>}
    </form>
  );
}
