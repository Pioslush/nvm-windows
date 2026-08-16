import { redirect } from "next/navigation";
import { requireUser, getAdminVenue } from "@/lib/auth";
import { createVenue } from "@/app/actions/admin";
import { COMMON_TIMEZONES } from "@/lib/timezones";

export default async function OnboardingPage() {
  await requireUser();
  if (await getAdminVenue()) redirect("/dashboard");

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-10">
      <h1 className="text-2xl font-bold text-slate-900">Set up your venue</h1>
      <p className="mt-2 text-slate-600">
        You can change all of this later in Settings.
      </p>
      <form action={createVenue} className="mt-8 flex flex-col gap-5">
        <div>
          <label htmlFor="name" className="label">Venue name</label>
          <input id="name" name="name" required className="field" placeholder="Weidner Field" />
        </div>
        <div>
          <label htmlFor="city" className="label">City</label>
          <input id="city" name="city" required className="field" placeholder="Colorado Springs, CO" />
        </div>
        <div>
          <label htmlFor="address" className="label">Delivery address (shown to vendors)</label>
          <input id="address" name="address" className="field" placeholder="111 W Cimarron St, Colorado Springs, CO 80903" />
        </div>
        <div>
          <label htmlFor="timezone" className="label">Timezone</label>
          <select id="timezone" name="timezone" className="field" defaultValue="America/Denver">
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>{tz.label}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn-primary">Create venue</button>
      </form>
    </main>
  );
}
