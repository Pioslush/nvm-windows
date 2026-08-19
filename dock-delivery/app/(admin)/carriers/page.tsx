import { requireAdminFacility } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { removeInvite } from "@/app/actions/admin";
import InviteForm from "./invite-form";
import type { FacilityInvite } from "@/lib/types";

export default async function CarriersPage() {
  const { facility } = await requireAdminFacility();
  const supabase = await createClient();
  const { data: invites } = await supabase
    .from("facility_invites")
    .select("*")
    .eq("facility_id", facility.id)
    .order("created_at");

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Carriers</h1>
      <p className="mt-1 text-slate-600">
        Invite a carrier by email and they can always see and book this
        facility&apos;s open dock slots — no per-delivery re-invite needed.
      </p>

      <section className="card mt-6">
        <h2 className="text-lg font-bold text-slate-900">Invite a carrier</h2>
        <div className="mt-4">
          <InviteForm />
        </div>
      </section>

      {invites && invites.length > 0 ? (
        <ul className="mt-6 flex flex-col gap-2">
          {invites.map((invite: FacilityInvite) => (
            <li
              key={invite.id}
              className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-4 py-2.5"
            >
              <span className="truncate font-semibold text-slate-700">{invite.carrier_email}</span>
              <form action={removeInvite}>
                <input type="hidden" name="invite_id" value={invite.id} />
                <button type="submit" className="text-sm font-semibold text-red-600 underline">
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <div className="card mt-6 text-center">
          <p className="text-3xl">📇</p>
          <h2 className="mt-2 text-lg font-bold text-slate-900">No carriers invited yet</h2>
          <p className="mt-1 text-slate-600">Invite one above to get your first booking.</p>
        </div>
      )}
    </div>
  );
}
