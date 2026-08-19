"use client";

import { useActionState } from "react";
import { inviteCarrier } from "@/app/actions/admin";

export default function InviteForm() {
  const [state, formAction, pending] = useActionState(inviteCarrier, null);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="email"
          name="email"
          required
          className="field flex-1"
          placeholder="carrier@trucking.com"
          aria-label="Carrier email"
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
