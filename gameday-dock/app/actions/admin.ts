"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAdminVenue, requireUser } from "@/lib/auth";
import { venueLocalToUtc } from "@/lib/time";
import {
  getBookingContext,
  sendBookingConfirmed,
  sendBookingCancelledByVenue,
  sendInviteEmail,
} from "@/lib/notify";
import type { BookingStatus } from "@/lib/types";

export type ActionState = { error?: string; ok?: string } | null;

// ---------------------------------------------------------------------------
// Venue
// ---------------------------------------------------------------------------

export async function createVenue(formData: FormData) {
  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.from("venues").insert({
    name: String(formData.get("name") ?? "").trim(),
    city: String(formData.get("city") ?? "").trim(),
    address: String(formData.get("address") ?? "").trim() || null,
    timezone: String(formData.get("timezone") ?? "America/Denver"),
    created_by: user.id,
  });
  if (error) throw new Error(`Could not create venue: ${error.message}`);
  redirect("/dashboard");
}

export async function updateVenueSettings(formData: FormData) {
  const { venue } = await requireAdminVenue();
  const supabase = await createClient();
  const cutoff = Number(formData.get("cutoff") ?? venue.cancellation_cutoff_hours);
  const { error } = await supabase
    .from("venues")
    .update({
      name: String(formData.get("name") ?? venue.name).trim(),
      city: String(formData.get("city") ?? venue.city).trim(),
      address: String(formData.get("address") ?? "").trim() || null,
      timezone: String(formData.get("timezone") ?? venue.timezone),
      require_approval: formData.get("require_approval") === "on",
      cancellation_cutoff_hours: Number.isFinite(cutoff) && cutoff >= 0 ? cutoff : 12,
    })
    .eq("id", venue.id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

// ---------------------------------------------------------------------------
// Docks
// ---------------------------------------------------------------------------

export async function createDock(formData: FormData) {
  const { venue } = await requireAdminVenue();
  const supabase = await createClient();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const { error } = await supabase.from("docks").insert({
    venue_id: venue.id,
    name,
    notes: String(formData.get("notes") ?? "").trim() || null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/docks");
}

export async function deleteDock(formData: FormData) {
  await requireAdminVenue();
  const supabase = await createClient();
  const { error } = await supabase.from("docks").delete().eq("id", String(formData.get("dock_id")));
  if (error) throw new Error(error.message);
  revalidatePath("/docks");
}

// ---------------------------------------------------------------------------
// Events & slots
// ---------------------------------------------------------------------------

export async function createEvent(formData: FormData) {
  const { venue } = await requireAdminVenue();
  const supabase = await createClient();

  const name = String(formData.get("name") ?? "").trim();
  const date = String(formData.get("event_date") ?? "");
  const startTime = String(formData.get("load_in_start") ?? "");
  const endTime = String(formData.get("load_in_end") ?? "");
  const interval = Number(formData.get("interval")) === 60 ? 60 : 30;
  const dockIds = formData.getAll("dock_ids").map(String);

  if (!name || !date || !startTime || !endTime || dockIds.length === 0) {
    throw new Error("Missing event details");
  }

  const start = venueLocalToUtc(date, startTime, venue.timezone);
  let end = venueLocalToUtc(date, endTime, venue.timezone);
  // A load-in window that "ends" past midnight (e.g. 22:00 – 01:00) rolls to the next day.
  if (end <= start) end = new Date(end.getTime() + 24 * 36e5);

  const { data: event, error } = await supabase
    .from("events")
    .insert({
      venue_id: venue.id,
      name,
      event_date: date,
      load_in_start: start.toISOString(),
      load_in_end: end.toISOString(),
      status: "draft",
    })
    .select()
    .single();
  if (error || !event) throw new Error(error?.message ?? "Could not create event");

  // Auto-generate slots for each selected dock at the chosen interval.
  const slots: { event_id: string; dock_id: string; start_time: string; end_time: string }[] = [];
  for (const dockId of dockIds) {
    for (let t = start.getTime(); t + interval * 6e4 <= end.getTime(); t += interval * 6e4) {
      slots.push({
        event_id: event.id,
        dock_id: dockId,
        start_time: new Date(t).toISOString(),
        end_time: new Date(t + interval * 6e4).toISOString(),
      });
    }
  }
  if (slots.length > 0) {
    const { error: slotError } = await supabase.from("slots").insert(slots);
    if (slotError) throw new Error(slotError.message);
  }

  redirect(`/events/${event.id}`);
}

export async function setEventStatus(formData: FormData) {
  await requireAdminVenue();
  const supabase = await createClient();
  const eventId = String(formData.get("event_id"));
  const status = String(formData.get("status"));
  if (!["draft", "published", "completed"].includes(status)) return;
  const { error } = await supabase.from("events").update({ status }).eq("id", eventId);
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/dashboard");
}

export async function toggleSlotBlocked(formData: FormData) {
  await requireAdminVenue();
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
  revalidatePath(`/events/${slot.event_id}`);
}

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

export async function inviteVendor(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { venue } = await requireAdminVenue();
  const supabase = await createClient();
  const eventId = String(formData.get("event_id"));
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid email address." };

  const { data: event } = await supabase.from("events").select("*").eq("id", eventId).single();
  if (!event) return { error: "Event not found." };

  const { data: invite, error } = await supabase
    .from("event_invites")
    .upsert({ event_id: eventId, vendor_email: email }, { onConflict: "event_id,vendor_email" })
    .select()
    .single();
  if (error || !invite) return { error: error?.message ?? "Could not create invite." };

  await sendInviteEmail({ to: email, token: invite.token, event, venue });
  revalidatePath(`/events/${eventId}`);
  return { ok: `Invite sent to ${email}.` };
}

export async function removeInvite(formData: FormData) {
  await requireAdminVenue();
  const supabase = await createClient();
  const inviteId = String(formData.get("invite_id"));
  const eventId = String(formData.get("event_id"));
  await supabase.from("event_invites").delete().eq("id", inviteId);
  revalidatePath(`/events/${eventId}`);
}

// ---------------------------------------------------------------------------
// Bookings (admin side)
// ---------------------------------------------------------------------------

export async function approveBooking(formData: FormData) {
  await requireAdminVenue();
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
  await requireAdminVenue();
  const supabase = await createClient();
  const bookingId = String(formData.get("booking_id"));
  const ctx = await getBookingContext(bookingId);
  const { error } = await supabase
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("id", bookingId);
  if (error) throw new Error(error.message);
  if (ctx) await sendBookingCancelledByVenue(ctx);
  revalidatePath("/", "layout");
}

/** One-tap status updates from the day-of dashboard. */
export async function setBookingStatus(formData: FormData) {
  await requireAdminVenue();
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
// Gate list
// ---------------------------------------------------------------------------

export async function createGateToken(formData: FormData) {
  await requireAdminVenue();
  const supabase = await createClient();
  const eventId = String(formData.get("event_id"));
  const { data: event } = await supabase.from("events").select("*").eq("id", eventId).single();
  if (!event) return;
  // Valid through 24h after the load-in window ends.
  const expires = new Date(new Date(event.load_in_end).getTime() + 24 * 36e5);
  const { error } = await supabase
    .from("gate_list_tokens")
    .insert({ event_id: eventId, expires_at: expires.toISOString() });
  if (error) throw new Error(error.message);
  revalidatePath(`/events/${eventId}`);
}

export async function revokeGateToken(formData: FormData) {
  await requireAdminVenue();
  const supabase = await createClient();
  const tokenId = String(formData.get("token_id"));
  const eventId = String(formData.get("event_id"));
  await supabase.from("gate_list_tokens").delete().eq("id", tokenId);
  revalidatePath(`/events/${eventId}`);
}
