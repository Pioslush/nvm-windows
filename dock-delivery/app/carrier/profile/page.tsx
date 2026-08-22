import { requireUser, getCarrierProfile } from "@/lib/auth";
import { saveCarrierProfile } from "@/app/actions/carrier";

export default async function CarrierProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await requireUser();
  const profile = await getCarrierProfile();
  const carrier = profile?.carrier;
  const { next } = await searchParams;

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-bold text-slate-900">
        {carrier ? "Your company details" : "Tell the facility who's coming"}
      </h1>
      <p className="mt-1 text-slate-600">
        This is what shows on the dock manifest, so use the driver&apos;s
        real vehicle details where you can.
      </p>
      <form action={saveCarrierProfile} className="mt-6 flex flex-col gap-5">
        {next && <input type="hidden" name="next" value={next} />}
        <div>
          <label htmlFor="company_name" className="label">Company name</label>
          <input id="company_name" name="company_name" required className="field" defaultValue={carrier?.company_name ?? ""} placeholder="Summit Freight Co." />
        </div>
        <div>
          <label htmlFor="contact_name" className="label">Contact name</label>
          <input id="contact_name" name="contact_name" required className="field" defaultValue={carrier?.contact_name ?? ""} placeholder="Sam Rivera" />
        </div>
        <div>
          <label htmlFor="phone" className="label">Phone (day-of contact)</label>
          <input id="phone" name="phone" type="tel" required className="field" defaultValue={carrier?.phone ?? ""} placeholder="719-555-0142" />
        </div>
        <div>
          <label htmlFor="vehicle_type" className="label">Vehicle type</label>
          <input id="vehicle_type" name="vehicle_type" required className="field" defaultValue={carrier?.vehicle_type ?? ""} placeholder="53' trailer" />
        </div>
        <div>
          <label htmlFor="license_plate" className="label">License plate (optional)</label>
          <input id="license_plate" name="license_plate" className="field" defaultValue={carrier?.license_plate ?? ""} placeholder="COL-4821" />
        </div>
        <p className="text-sm text-slate-500">Booking emails go to {user.email}.</p>
        <button type="submit" className="btn btn-primary">
          {carrier ? "Save changes" : "Save & continue"}
        </button>
      </form>
    </div>
  );
}
