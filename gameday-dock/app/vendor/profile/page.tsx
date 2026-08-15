import { requireUser, getVendorProfile } from "@/lib/auth";
import { saveVendorProfile } from "@/app/actions/vendor";

export default async function VendorProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await requireUser();
  const profile = await getVendorProfile();
  const vendor = profile?.vendor;
  const { next } = await searchParams;

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-bold text-slate-900">
        {vendor ? "Your company details" : "Tell the venue who's coming"}
      </h1>
      <p className="mt-1 text-slate-600">
        This is what security sees on the gate list, so use the driver&apos;s
        real vehicle details where you can.
      </p>
      <form action={saveVendorProfile} className="mt-6 flex flex-col gap-5">
        {next && <input type="hidden" name="next" value={next} />}
        <div>
          <label htmlFor="company_name" className="label">Company name</label>
          <input id="company_name" name="company_name" required className="field" defaultValue={vendor?.company_name ?? ""} placeholder="Peak Beverage Co." />
        </div>
        <div>
          <label htmlFor="contact_name" className="label">Contact name</label>
          <input id="contact_name" name="contact_name" required className="field" defaultValue={vendor?.contact_name ?? ""} placeholder="Sam Rivera" />
        </div>
        <div>
          <label htmlFor="phone" className="label">Phone (day-of contact)</label>
          <input id="phone" name="phone" type="tel" required className="field" defaultValue={vendor?.phone ?? ""} placeholder="719-555-0142" />
        </div>
        <div>
          <label htmlFor="vehicle_type" className="label">Vehicle type</label>
          <input id="vehicle_type" name="vehicle_type" required className="field" defaultValue={vendor?.vehicle_type ?? ""} placeholder="26' box truck" />
        </div>
        <div>
          <label htmlFor="license_plate" className="label">License plate (optional)</label>
          <input id="license_plate" name="license_plate" className="field" defaultValue={vendor?.license_plate ?? ""} placeholder="COL-4821" />
        </div>
        <p className="text-sm text-slate-500">Booking emails go to {user.email}.</p>
        <button type="submit" className="btn btn-primary">
          {vendor ? "Save changes" : "Save & continue"}
        </button>
      </form>
    </div>
  );
}
