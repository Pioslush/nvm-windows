import { requireAdminVenue } from "@/lib/auth";
import { updateVenueSettings } from "@/app/actions/admin";
import { COMMON_TIMEZONES } from "@/lib/timezones";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const { venue } = await requireAdminVenue();
  const { saved } = await searchParams;

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-bold text-slate-900">Venue settings</h1>
      {saved && (
        <p className="mt-3 rounded-lg bg-green-50 px-4 py-3 font-semibold text-green-800">
          Settings saved.
        </p>
      )}
      <form action={updateVenueSettings} className="mt-6 flex flex-col gap-5">
        <div>
          <label htmlFor="name" className="label">Venue name</label>
          <input id="name" name="name" required className="field" defaultValue={venue.name} />
        </div>
        <div>
          <label htmlFor="city" className="label">City</label>
          <input id="city" name="city" required className="field" defaultValue={venue.city} />
        </div>
        <div>
          <label htmlFor="address" className="label">Delivery address (shown to vendors)</label>
          <input id="address" name="address" className="field" defaultValue={venue.address ?? ""} />
        </div>
        <div>
          <label htmlFor="timezone" className="label">Timezone</label>
          <select id="timezone" name="timezone" className="field" defaultValue={venue.timezone}>
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>{tz.label}</option>
            ))}
            {!COMMON_TIMEZONES.some((tz) => tz.value === venue.timezone) && (
              <option value={venue.timezone}>{venue.timezone}</option>
            )}
          </select>
        </div>

        <label className="card flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            name="require_approval"
            defaultChecked={venue.require_approval}
            className="mt-1 h-5 w-5 accent-slate-900"
          />
          <span>
            <span className="font-bold text-slate-900">Require booking approval</span>
            <span className="mt-0.5 block text-sm text-slate-600">
              On: new bookings wait for your approval before they&apos;re confirmed.
              Off: vendors get instant confirmation, first come, first served.
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
            defaultValue={venue.cancellation_cutoff_hours}
          />
          <p className="mt-1 text-sm text-slate-500">
            Inside this window vendors can&apos;t cancel or reschedule online — they
            have to call you. Default is 12 hours.
          </p>
        </div>

        <button type="submit" className="btn btn-primary self-start">Save settings</button>
      </form>

      <div className="card mt-8">
        <h2 className="text-lg font-bold text-slate-900">Billing</h2>
        <p className="mt-1 text-slate-600">
          GameDay Dock is free during the pilot. Subscriptions (via Stripe) are
          coming — you&apos;ll get plenty of notice before anything is charged.
        </p>
      </div>
    </div>
  );
}
