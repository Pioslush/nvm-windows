import Link from "next/link";
import { requireUser } from "@/lib/auth";

export default async function CarrierLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireUser();
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-3">
          <Link href="/carrier">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
              Dock Delivery
            </p>
            <p className="text-lg font-bold text-slate-900">My deliveries</p>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/carrier/profile" className="text-sm font-semibold text-slate-600 underline">
              Profile
            </Link>
            <form action="/auth/signout" method="post">
              <button type="submit" className="text-sm font-semibold text-slate-500 underline">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  );
}
