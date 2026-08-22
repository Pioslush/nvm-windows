import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Magic-link landing: exchanges the code for a session, then continues. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";
  // Only allow same-site relative redirects.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  // Prefer the configured canonical URL over the request's own origin.
  // Behind a host's proxy, request.url can carry a per-deploy hostname
  // (e.g. Netlify's 6a88fd86--dock-delivery.netlify.app permalink) rather
  // than the primary domain. Redirecting there drops the user on a URL
  // that isn't the one they were sent to and, more importantly, may not be
  // in Supabase's redirect allow-list — which breaks sign-in entirely.
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? origin).replace(/\/$/, "");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${base}${safeNext}`);
  }
  return NextResponse.redirect(`${base}/login?error=link`);
}
