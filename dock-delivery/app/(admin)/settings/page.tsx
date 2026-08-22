import { requireAdminFacility } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { updateFacilitySettings, createManifestToken, revokeManifestToken } from "@/app/actions/admin";
import { COMMON_TIMEZONES } from "@/lib/timezones";
import CopyButton from "@/app/components/copy-button";
import type { DockManifestToken } from "@/lib/types";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const { facility } = await requireAdminFacility();
  const { saved } = await searchParams;
  const supabase = await createClient();
  const { data: manifestTokens } = await supabase
    .from("dock_manifest_tokens")
    .select("*")
    .eq("facility_id", facility.id)
    .order("created_at");

  const appBase = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const manifestUrl = (token: string) => (appBase ? `${appBase}/manifest/${token}` : `/manifest/${token}`);

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-bold text-slate-900">Facility settings</h1>
      {saved && (
        <p className="mt-3 rounded-lg bg-green-50 px-4 py-3 font-semibold text-green-800">
          Settings saved.
        </p>
      )}
      <form action={updateFacilitySettings} className="mt-6 flex flex-col gap-5">
        <div>
          <label htmlFor="name" className="label">Facility name</label>
          <input id="name" name="name" required className="field" defaultValue={facility.name} />
        </div>
        <div>
          <label htmlFor="city" className="label">City</label>
          <input id="city" name="city" required className="field" defaultValue={facility.city} />
        </div>
        <div>
          <label htmlFor="address" className="label">Delivery address (shown to carriers)</label>
          <input id="address" name="address" className="field" defaultValue={facility.address ?? ""} />
        </div>
        <div>
          <label htmlFor="timezone" className="label">Timezone</label>
          <select id="timezone" name="timezone" className="field" defaultValue={facility.timezone}>
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>{tz.label}</option>
            ))}
            {!COMMON_TIMEZONES.some((tz) => tz.value === facility.timezone) && (
              <option value={facility.timezone}>{facility.timezone}</option>
            )}
          </select>
        </div>

        <label className="card flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            name="require_approval"
            defaultChecked={facility.require_approval}
            className="mt-1 h-5 w-5 accent-slate-900"
          />
          <span>
            <span className="font-bold text-slate-900">Require booking approval</span>
            <span className="mt-0.5 block text-sm text-slate-600">
              On: new bookings wait for your approval before they&apos;re confirmed.
              Off: carriers get instant confirmation, first come, first served.
            </span>
          </span>
        </label>

        <div>
          <label htmlFor="cutoff" className="label">
            Cancellation / reschedule cutoff (hours before slot)
          </label>
          <input
            id="cutoff"
            name="cutoff"
            type="number"
            min={0}
            max={168}
            className="field"
            defaultValue={facility.cancellation_cutoff_hours}
          />
          <p className="mt-1 text-sm text-slate-500">
            Inside this window carriers can&apos;t cancel or reschedule online — they
            have to call you. Default is 12 hours.
          </p>
        </div>

        <button type="submit" className="btn btn-primary self-start">Save settings</button>
      </form>

      <div className="card mt-8">
        <h2 className="text-lg font-bold text-slate-900">Dock manifest link</h2>
        <p className="mt-1 text-slate-600">
          A read-only, phone-friendly list of today&apos;s confirmed deliveries —
          company, contact, vehicle, plate, dock, and time. Share the link with
          gate security; no login needed. It always shows today&apos;s deliveries,
          whenever it&apos;s opened.
        </p>
        {manifestTokens && manifestTokens.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-2">
            {manifestTokens.map((t: DockManifestToken) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-4 py-2.5">
                <code className="min-w-0 flex-1 truncate text-sm text-slate-700">{manifestUrl(t.token)}</code>
                <CopyButton text={manifestUrl(t.token)} />
                <a href={`/manifest/${t.token}`} target="_blank" className="btn btn-secondary !min-h-0 !px-3 !py-1.5 text-sm">
                  Open
                </a>
                <form action={revokeManifestToken}>
                  <input type="hidden" name="token_id" value={t.id} />
                  <button type="submit" className="text-sm font-semibold text-red-600 underline">
                    Revoke
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <form action={createManifestToken} className="mt-4">
            <button type="submit" className="btn btn-primary">Generate manifest link</button>
          </form>
        )}
      </div>

      <div className="card mt-8">
        <h2 className="text-lg font-bold text-slate-900">Billing</h2>
        <p className="mt-1 text-slate-600">
          Dock Delivery is free during the pilot. Subscriptions (via Stripe) are
          coming — you&apos;ll get plenty of notice before anything is charged.
        </p>
      </div>
    </div>
  );
}
