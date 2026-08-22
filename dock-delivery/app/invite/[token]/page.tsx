import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser, getCarrierProfile } from "@/lib/auth";

/**
 * Invite link landing. Token-authorized (service role) so it works before
 * the carrier has an account. Routes the carrier to the right next step.
 * Unlike a one-event invite, this is a standing facility relationship — the
 * carrier can always come back and browse open slots after accepting.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const admin = createAdminClient();
  const { data: invite } = await admin
    .from("facility_invites")
    .select("*, facility:facilities(name, city)")
    .eq("token", token)
    .maybeSingle();

  if (!invite) {
    return (
      <Shell>
        <p className="text-3xl">🤔</p>
        <h1 className="mt-2 text-xl font-bold text-slate-900">This invite link isn&apos;t valid</h1>
        <p className="mt-2 text-slate-600">
          It may have been removed by the facility. Ask them to send a fresh invite.
        </p>
      </Shell>
    );
  }

  const user = await getUser();
  const nextUrl = `/invite/${token}`;

  if (!user) {
    return (
      <Shell>
        <p className="text-sm font-bold uppercase tracking-widest text-slate-500">
          {invite.facility.name}
        </p>
        <h1 className="mt-2 text-xl font-bold text-slate-900">
          You&apos;re invited to book dock deliveries
        </h1>
        <p className="mt-2 text-slate-600">
          Sign in with <span className="font-semibold">{invite.carrier_email}</span> to
          browse open dock slots any time. New here? The same link creates your free account.
        </p>
        <Link
          href={`/login?next=${encodeURIComponent(nextUrl)}`}
          className="btn btn-primary mt-6 w-full"
        >
          Continue with email
        </Link>
      </Shell>
    );
  }

  if ((user.email ?? "").toLowerCase() !== invite.carrier_email) {
    return (
      <Shell>
        <p className="text-3xl">✋</p>
        <h1 className="mt-2 text-xl font-bold text-slate-900">Wrong account for this invite</h1>
        <p className="mt-2 text-slate-600">
          This invite was sent to <span className="font-semibold">{invite.carrier_email}</span>,
          but you&apos;re signed in as <span className="font-semibold">{user.email}</span>.
          Sign out and use the invited address, or ask the facility to invite{" "}
          {user.email} instead.
        </p>
        <form action="/auth/signout" method="post" className="mt-6">
          <button type="submit" className="btn btn-secondary w-full">Sign out</button>
        </form>
      </Shell>
    );
  }

  const profile = await getCarrierProfile();
  if (!profile?.carrier) {
    redirect(`/carrier/profile?next=${encodeURIComponent(`/carrier/facilities/${invite.facility_id}`)}`);
  }
  redirect(`/carrier/facilities/${invite.facility_id}`);
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <div className="card text-center">{children}</div>
    </main>
  );
}
