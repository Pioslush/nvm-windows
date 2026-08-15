import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser, getAdminVenue, getVendorProfile } from "@/lib/auth";

export default async function Home() {
  const user = await getUser();
  if (user) {
    const admin = await getAdminVenue();
    if (admin) redirect("/dashboard");
    const vendor = await getVendorProfile();
    if (vendor?.vendor) redirect("/vendor");
    redirect("/welcome");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-8 px-6 text-center">
      <div>
        <p className="text-sm font-bold uppercase tracking-widest text-slate-500">
          GameDay Dock
        </p>
        <h1 className="mt-3 text-4xl font-extrabold leading-tight text-slate-900">
          Every truck. The right dock. On time.
        </h1>
        <p className="mt-4 text-lg text-slate-600">
          Publish dock slots for each event, let vendors book them, and hand
          security a live gate list. No more spreadsheets and 6 a.m. phone calls.
        </p>
      </div>
      <div className="flex w-full flex-col gap-3">
        <Link href="/login" className="btn btn-primary w-full">
          Sign in / Sign up
        </Link>
        <p className="text-sm text-slate-500">
          Vendors: use the invite link from your venue to get started.
        </p>
      </div>
    </main>
  );
}
