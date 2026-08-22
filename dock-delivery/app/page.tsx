import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser, getAdminFacility, getCarrierProfile } from "@/lib/auth";

export default async function Home() {
  const user = await getUser();
  if (user) {
    const admin = await getAdminFacility();
    if (admin) redirect("/schedule");
    const carrier = await getCarrierProfile();
    if (carrier?.carrier) redirect("/carrier");
    redirect("/welcome");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-8 px-6 text-center">
      <div>
        <p className="text-sm font-bold uppercase tracking-widest text-slate-500">
          Dock Delivery
        </p>
        <h1 className="mt-3 text-4xl font-extrabold leading-tight text-slate-900">
          Stop double-booking your dock.
        </h1>
        <p className="mt-4 text-lg text-slate-600">
          Set your weekly dock availability, let carriers book open slots
          instantly, and hand security a live dock manifest. No more
          spreadsheets and morning phone calls.
        </p>
      </div>
      <div className="flex w-full flex-col gap-3">
        <Link href="/login" className="btn btn-primary w-full">
          Sign in / Sign up
        </Link>
        <p className="text-sm text-slate-500">
          Carriers: use the invite link from your facility to get started.
        </p>
      </div>
    </main>
  );
}
