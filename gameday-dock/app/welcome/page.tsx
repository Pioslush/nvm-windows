import Link from "next/link";
import { requireUser } from "@/lib/auth";

export default async function WelcomePage() {
  const user = await requireUser();

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6">
      <div className="text-center">
        <p className="text-sm font-bold uppercase tracking-widest text-slate-500">
          GameDay Dock
        </p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">
          Welcome{user.email ? `, ${user.email}` : ""}
        </h1>
        <p className="mt-2 text-slate-600">How will you use GameDay Dock?</p>
      </div>

      <Link href="/onboarding" className="card block hover:border-slate-400">
        <h2 className="text-lg font-bold text-slate-900">I run a venue</h2>
        <p className="mt-1 text-slate-600">
          Set up your stadium or arena, add docks, and publish delivery slots
          for game day.
        </p>
      </Link>

      <div className="card">
        <h2 className="text-lg font-bold text-slate-900">I&apos;m a vendor</h2>
        <p className="mt-1 text-slate-600">
          Vendor accounts start from an invite. Open the invite link a venue
          emailed you — it brings you straight to their available slots.
        </p>
        <Link href="/vendor" className="btn btn-secondary mt-4 w-full">
          I already have bookings
        </Link>
      </div>

      <form action="/auth/signout" method="post" className="text-center">
        <button type="submit" className="text-sm font-semibold text-slate-500 underline">
          Sign out
        </button>
      </form>
    </main>
  );
}
