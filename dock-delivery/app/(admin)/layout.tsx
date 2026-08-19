import Link from "next/link";
import { requireAdminFacility } from "@/lib/auth";

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { facility } = await requireAdminFacility();

  const nav = [
    { href: "/schedule", label: "Schedule" },
    { href: "/today", label: "Today" },
    { href: "/docks", label: "Docks" },
    { href: "/carriers", label: "Carriers" },
    { href: "/settings", label: "Settings" },
  ];

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <Link href="/schedule" className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
              Dock Delivery
            </p>
            <p className="truncate text-lg font-bold text-slate-900">{facility.name}</p>
          </Link>
          <form action="/auth/signout" method="post">
            <button type="submit" className="text-sm font-semibold text-slate-500 underline">
              Sign out
            </button>
          </form>
        </div>
        <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-2 pb-2">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg px-4 py-2.5 text-base font-semibold text-slate-700 hover:bg-slate-100"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
