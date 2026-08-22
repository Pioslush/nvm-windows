"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAdminFacility, requireUser } from "@/lib/auth";
import { generateSlotsForDock } from "@/lib/slots";
import {
  getBookingContext,
  sendBookingConfirmed,
  sendBookingCancelledByFacility,
  sendInviteEmail,
} from "@/lib/notify";
import type { BookingStatus } from "@/lib/types";

export type ActionState = { error?: string; ok?: string } | null;

// ---------------------------------------------------------------------------
// Facility
// ---------------------------------------------------------------------------

export async function createFacility(formData: FormData) {
  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.from("facilities").insert({
    name: String(formData.get("name") ?? "").trim(),
    city: String(formData.get("city") ?? "").trim(),
    address: String(formData.get("address") ?? "").trim() || null,
    timezone: String(formData.get("timezone") ?? "America/Denver"),
    created_by: user.id,
  });
  if (error) throw new Error(`Could not create facility: ${error.message}`);
  redirect("/schedule");
}

export async function updateFacilitySettings(formData: FormData) {
  const { facility } = await requireAdminFacility();
  const supabase = await createClient();
  const cutoff = Number(formData.get("cutoff") ?? facility.cancellation_cutoff_hours);
  const { error } = await supabase
    .from("facilities")
    .update({
      name: String(formData.get("name") ?? facility.name).trim(),
      city: String(formData.get("city") ?? facility.city).trim(),
      address: String(formData.get("address") ?? "").trim() || null,
      timezone: String(formData.get("timezone") ?? facility.timezone),
      require_approval: formData.get("require_approval") === "on",
      cancellation_cutoff_hours: Number.isFinite(cutoff) && cutoff >= 0 ? cutoff : 12,
    })
    .eq("id", facility.id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

// ---------------------------------------------------------------------------
// Docks
// ---------------------------------------------------------------------------

export async function createDock(formData: FormData) {
  const { facility } = await requireAdminFacility();
  const supabase = await createClient();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const { error } = await supabase.from("docks").insert({
    facility_id: facility.id,
    name,
    notes: String(formData.get("notes") ?? "").trim() || null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/docks");
}

export async function deleteDock(formData: FormData) {
  await requireAdminFacility();
  const supabase = await createClient();
  const { error } = await supabase.from("docks").delete().eq("id", String(formData.get("dock_id")));
  if (error) throw new Error(error.message);
  revalidatePath("/docks");
}

// ---------------------------------------------------------------------------
// Dock availability & slot generation
// ---------------------------------------------------------------------------

/**
 * Replaces all of a dock's recurring weekly availability in one transaction-
 * like sweep (delete existing rows, insert the new set), then immediately
 * materializes slots for the new template so admins see bookable slots
 * right away instead of waiting for the next cron run.
 */
export async function setDockAvailability(formData: FormData) {
  const { facility } = await requireAdminFacility();
  const supabase = await createClient();
  const dockId = String(formData.get("dock_id"));

  const { data: dock } = await supabase
    .from("docks")
    .select("id, facility_id")
    .eq("id", dockId)
    .single();
  if (!dock) throw new Error("Dock not found");

  const days = formData.getAll("day_of_week").map(Number);
  const startTime = String(formData.get("start_time") ?? "08:00");
  const endTime = String(formData.get("end_time") ?? "18:00");
  const interval = Number(formData.get("interval")) === 60 ? 60 : 30;

  await supabase.from("dock_availability").delete().eq("dock_id", dockId);

  if (days.length > 0) {
    const rows = days.map((day_of_week) => ({
      dock_id: dockId,
      day_of_week,
      start_time: `${startTime}:00`,
      end_time: `${endTime}:00`,
      slot_interval_minutes: interval,
    }));
    const { error } = await supabase.from("dock_availability").insert(rows);
    if (error) throw new Error(error.message);
    await generateSlotsForDock(supabase, dockId, facility.timezone);
  }

  revalidatePath(`/docks/${dockId}`);
}

export async function toggleSlotBlocked(formData: FormData) {
  await requireAdminFacility();
  const supabase = await createClient();
  const slotId = String(formData.get("slot_id"));
  const { data: slot } = await supabase.from("slots").select("*").eq("id", slotId).single();
  if (!slot) return;
  if (slot.status === "booked") return; // can't block a booked slot — cancel the booking first
  const { error } = await supabase
    .from("slots")
    .update({ status: slot.status === "blocked" ? "open" : "blocked" })
    .eq("id", slotId);
  if (error) throw new Error(error.message);
  revalidatePath(`/docks/${slot.dock_id}`);
}

// ---------------------------------------------------------------------------
// Carrier invites
// ---------------------------------------------------------------------------

export async function inviteCarrier(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { facility } = await requireAdminFacility();
  const supabase = await createClient();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid email address." };

  const { data: invite, error } = await supabase
    .from("facility_invites")
    .upsert({ facility_id: facility.id, carrier_email: email }, { onConflict: "facility_id,carrier_email" })
    .select()
    .single();
  if (error || !invite) return { error: error?.message ?? "Could not create invite." };

  await sendInviteEmail({ to: email, token: invite.token, facility });
  revalidatePath("/carriers");
  return { ok: `Invite sent to ${email}.` };
}

export async function removeInvite(formData: FormData) {
  await requireAdminFacility();
  const supabase = await createClient();
  const inviteId = String(formData.get("invite_id"));
  await supabase.from("facility_invites").delete().eq("id", inviteId);
  revalidatePath("/carriers");
}

// ---------------------------------------------------------------------------
// Bookings (admin side)
// ---------------------------------------------------------------------------

export async function approveBooking(formData: FormData) {
  await requireAdminFacility();
  const supabase = await createClient();
  const bookingId = String(formData.get("booking_id"));
  const { error } = await supabase
    .from("bookings")
    .update({ status: "confirmed" })
    .eq("id", bookingId)
    .eq("status", "pending");
  if (error) throw new Error(error.message);
  const ctx = await getBookingContext(bookingId);
  if (ctx) await sendBookingConfirmed(ctx);
  revalidatePath("/", "layout");
}

export async function declineBooking(formData: FormData) {
  await requireAdminFacility();
  const supabase = await createClient();
  const bookingId = String(formData.get("booking_id"));
  const ctx = await getBookingContext(bookingId);
  const { error } = await supabase
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("id", bookingId);
  if (error) throw new Error(error.message);
  if (ctx) await sendBookingCancelledByFacility(ctx);
  revalidatePath("/", "layout");
}

/** One-tap status updates from the day-of dashboard. */
export async function setBookingStatus(formData: FormData) {
  await requireAdminFacility();
  const supabase = await createClient();
  const bookingId = String(formData.get("booking_id"));
  const status = String(formData.get("status")) as BookingStatus;
  if (!["confirmed", "checked_in", "late", "no_show"].includes(status)) return;
  const { error } = await supabase
    .from("bookings")
    .update({
      status,
      checked_in_at: status === "checked_in" ? new Date().toISOString() : null,
    })
    .eq("id", bookingId);
  if (error) throw new Error(error.message);
  revalidatePath("/today");
}

// ---------------------------------------------------------------------------
// Dock manifest (was gate list)
// ---------------------------------------------------------------------------

export async function createManifestToken() {
  const { facility } = await requireAdminFacility();
  const supabase = await createClient();
  // No per-day scope — the manifest page filters to "today" at render time,
  // so one token stays useful indefinitely (revocable). 90-day rolling expiry.
  const expires = new Date(Date.now() + 90 * 24 * 36e5);
  const { error } = await supabase
    .from("dock_manifest_tokens")
    .insert({ facility_id: facility.id, expires_at: expires.toISOString() });
  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}

export async function revokeManifestToken(formData: FormData) {
  await requireAdminFacility();
  const supabase = await createClient();
  const tokenId = String(formData.get("token_id"));
  await supabase.from("dock_manifest_tokens").delete().eq("id", tokenId);
  revalidatePath("/settings");
}
