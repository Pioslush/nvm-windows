import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { Venue, Vendor } from "@/lib/types";
import type { User } from "@supabase/supabase-js";

export async function getUser(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** The signed-in user's venue (first membership), or null. */
export async function getAdminVenue(): Promise<{ user: User; venue: Venue } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: membership } = await supabase
    .from("venue_members")
    .select("venue_id")
    .limit(1)
    .maybeSingle();
  if (!membership) return null;
  const { data: venue } = await supabase
    .from("venues")
    .select("*")
    .eq("id", membership.venue_id)
    .single();
  return venue ? { user, venue } : null;
}

export async function getVendorProfile(): Promise<{ user: User; vendor: Vendor | null } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: vendor } = await supabase
    .from("vendors")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  return { user, vendor: vendor ?? null };
}

/** For admin pages: redirect to login / onboarding when not an admin. */
export async function requireAdminVenue(): Promise<{ user: User; venue: Venue }> {
  const user = await getUser();
  if (!user) redirect("/login");
  const admin = await getAdminVenue();
  if (!admin) redirect("/welcome");
  return admin;
}

/** For vendor pages: redirect to login when signed out. */
export async function requireUser(): Promise<User> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}
