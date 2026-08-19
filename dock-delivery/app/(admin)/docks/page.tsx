import Link from "next/link";
import { requireAdminFacility } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createDock, deleteDock } from "@/app/actions/admin";
import type { Dock } from "@/lib/types";

export default async function DocksPage() {
  const { facility } = await requireAdminFacility();
  const supabase = await createClient();
  const { data: docks } = await supabase
    .from("docks")
    .select("*")
    .eq("facility_id", facility.id)
    .order("name");

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Docks</h1>
      <p className="mt-1 text-slate-600">
        Set each dock&apos;s weekly availability to auto-generate bookable slots.
        Notes show up in carrier confirmation emails — put height limits and
        truck size limits here.
      </p>

      {(!docks || docks.length === 0) && (
        <div className="card mt-6 text-center">
          <p className="text-3xl">🚚</p>
          <h2 className="mt-2 text-lg font-bold text-slate-900">No docks yet</h2>
          <p className="mt-1 text-slate-600">Add your first dock below — most facilities have 1 to 8.</p>
        </div>
      )}

      <ul className="mt-6 flex flex-col gap-3">
        {docks?.map((dock: Dock) => (
          <li key={dock.id} className="card flex items-start justify-between gap-3">
            <Link href={`/docks/${dock.id}`} className="min-w-0 flex-1">
              <h2 className="text-lg font-bold text-slate-900 hover:underline">{dock.name}</h2>
              {dock.notes && <p className="mt-0.5 text-slate-600">{dock.notes}</p>}
            </Link>
            <form action={deleteDock}>
              <input type="hidden" name="dock_id" value={dock.id} />
              <button type="submit" className="text-sm font-semibold text-red-600 underline">
                Remove
              </button>
            </form>
          </li>
        ))}
      </ul>

      <form action={createDock} className="card mt-6 flex flex-col gap-4">
        <h2 className="text-lg font-bold text-slate-900">Add a dock</h2>
        <div>
          <label htmlFor="dock-name" className="label">Dock name</label>
          <input id="dock-name" name="name" required className="field" placeholder="Dock A — North" />
        </div>
        <div>
          <label htmlFor="dock-notes" className="label">Notes (optional)</label>
          <input
            id="dock-notes"
            name="notes"
            className="field"
            placeholder={"Max 53' trailer. Clearance 13'6\"."}
          />
        </div>
        <button type="submit" className="btn btn-primary self-start">Add dock</button>
      </form>
    </div>
  );
}
