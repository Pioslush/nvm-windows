import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { Facility, Carrier } from "@/lib/types";
import type { User } from "@supabase/supabase-js";

export async function getUser(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** The signed-in user's facility (first membership), or null. */
export async function getAdminFacility(): Promise<{ user: User; facility: Facility } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: membership } = await supabase
    .from("facility_members")
    .select("facility_id")
    .limit(1)
    .maybeSingle();
  if (!membership) return null;
  const { data: facility } = await supabase
    .from("facilities")
    .select("*")
    .eq("id", membership.facility_id)
    .single();
  return facility ? { user, facility } : null;
}

export async function getCarrierProfile(): Promise<{ user: User; carrier: Carrier | null } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: carrier } = await supabase
    .from("carriers")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  return { user, carrier: carrier ?? null };
}

/** For admin pages: redirect to login / onboarding when not an admin. */
export async function requireAdminFacility(): Promise<{ user: User; facility: Facility }> {
  const user = await getUser();
  if (!user) redirect("/login");
  const admin = await getAdminFacility();
  if (!admin) redirect("/welcome");
  return admin;
}

/** For carrier pages: redirect to login when signed out. */
export async function requireUser(): Promise<User> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}
