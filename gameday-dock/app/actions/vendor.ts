"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser, getVendorProfile } from "@/lib/auth";
import { hoursUntil } from "@/lib/time";
import {
  getBookingContext,
  sendBookingConfirmed,
  sendBookingReceived,
  sendNewRequestAlert,
  sendRunningLateAlert,
} from "@/lib/notify";
import type { ActionState } from "@/app/actions/admin";

// ---------------------------------------------------------------------------
// Vendor profile
// ---------------------------------------------------------------------------

export async function saveVendorProfile(formData: FormData) {
  const user = await requireUser();
  const supabase = await createClient();
  const row = {
    user_id: user.id,
    company_name: String(formData.get("company_name") ?? "").trim(),
    contact_name: String(formData.get("contact_name") ?? "").trim(),
    phone: String(formData.get("phone") ?? "").trim(),
    email: user.email ?? String(formData.get("email") ?? "").trim(),
    vehicle_type: String(formData.get("vehicle_type") ?? "").trim(),
    license_plate: String(formData.get("license_plate") ?? "").trim() || null,
  };
  if (!row.company_name || !row.contact_name || !row.phone || !row.vehicle_type) {
    throw new Error("Please fill in all required fields");
  }
  const { error } = await supabase.from("vendors").upsert(row, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
  const next = String(formData.get("next") ?? "/vendor");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/vendor");
}

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

export async function bookSlot(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await getVendorProfile();
  if (!profile?.vendor) return { error: "Complete your vendor profile first." };
  const supabase = await createClient();

  const slotId = String(formData.get("slot_id"));
  const eventId = String(formData.get("event_id"));
  const purpose = String(formData.get("purpose") ?? "").trim();
  if (!purpose) return { error: "Tell the venue what you're delivering (e.g. “beer delivery, 1 box truck”)." };

  // Venue setting decides whether the booking starts pending or confirmed.
  const { data: eventRow } = await supabase
    .from("events")
    .select("id, venue:venues(require_approval)")
    .eq("id", eventId)
    .maybeSingle();
  const requireApproval =
    (eventRow?.venue as unknown as { require_approval: boolean } | null)?.require_approval ?? true;

  const { data: booking, error } = await supabase
    .from("bookings")
    .insert({
      slot_id: slotId,
      vendor_id: profile.vendor.id,
      purpose,
      status: requireApproval ? "pending" : "confirmed",
    })
    .select()
    .single();

  if (error) {
    revalidatePath(`/vendor/events/${eventId}`);
    // 23505 = someone else won the race for this slot (unique index).
    if (error.code === "23505") {
      return { error: "That slot is no longer available — it was just booked. The list has been refreshed." };
    }
    if (/blocked|not open/.test(error.message)) {
      return { error: "That slot is no longer available. The list has been refreshed." };
    }
    return { error: `Booking failed: ${error.message}` };
  }

  const ctx = await getBookingContext(booking.id);
  if (ctx) {
    if (requireApproval) {
      await sendBookingReceived(ctx);
      await sendNewRequestAlert(ctx);
    } else {
      await sendBookingConfirmed(ctx);
    }
  }
  revalidatePath(`/vendor/events/${eventId}`);
  redirect(`/vendor?booked=1`);
}

async function loadOwnBooking(bookingId: string) {
  const profile = await getVendorProfile();
  if (!profile?.vendor) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("bookings")
    .select("*, slot:slots(*, event:events(*, venue:venues(cancellation_cutoff_hours)))")
    .eq("id", bookingId)
    .eq("vendor_id", profile.vendor.id)
    .maybeSingle();
  return data;
}

export async function cancelBooking(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const bookingId = String(formData.get("booking_id"));
  const booking = await loadOwnBooking(bookingId);
  if (!booking) return { error: "Booking not found." };
  if (booking.status === "cancelled") return { error: "Already cancelled." };

  const cutoff =
    (booking.slot?.event?.venue as { cancellation_cutoff_hours?: number } | null)
      ?.cancellation_cutoff_hours ?? 12;
  if (hoursUntil(booking.slot.start_time) < cutoff) {
    return {
      error: `Changes are locked within ${cutoff} hours of your slot. Call the venue, or tap “I'm running late” on game day.`,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("id", bookingId);
  if (error) return { error: error.message };
  revalidatePath("/vendor");
  return { ok: "Booking cancelled." };
}

/**
 * Reschedule = book the new slot, then cancel the old one. Ordered this way so
 * a lost race on the new slot leaves the original booking untouched.
 */
export async function rescheduleBooking(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await getVendorProfile();
  if (!profile?.vendor) return { error: "Vendor profile missing." };
  const bookingId = String(formData.get("booking_id"));
  const newSlotId = String(formData.get("new_slot_id"));
  if (!newSlotId) return { error: "Pick a new slot first." };

  const booking = await loadOwnBooking(bookingId);
  if (!booking || booking.status === "cancelled") return { error: "Booking not found." };

  const cutoff =
    (booking.slot?.event?.venue as { cancellation_cutoff_hours?: number } | null)
      ?.cancellation_cutoff_hours ?? 12;
  if (hoursUntil(booking.slot.start_time) < cutoff) {
    return { error: `Changes are locked within ${cutoff} hours of your slot. Call the venue instead.` };
  }

  const supabase = await createClient();
  const { data: newBooking, error } = await supabase
    .from("bookings")
    .insert({
      slot_id: newSlotId,
      vendor_id: profile.vendor.id,
      purpose: booking.purpose,
      status: booking.status === "confirmed" ? "confirmed" : "pending",
    })
    .select()
    .single();
  if (error) {
    revalidatePath("/vendor");
    if (error.code === "23505") {
      return { error: "That slot was just taken by someone else — pick another." };
    }
    return { error: `Could not rebook: ${error.message}` };
  }

  await supabase.from("bookings").update({ status: "cancelled" }).eq("id", bookingId);

  const ctx = await getBookingContext(newBooking.id);
  if (ctx && newBooking.status === "confirmed") await sendBookingConfirmed(ctx);
  else if (ctx) await sendBookingReceived(ctx);

  revalidatePath("/vendor");
  return { ok: "Rescheduled. Confirmation email on its way." };
}

export async function markRunningLate(formData: FormData) {
  await requireUser();
  const bookingId = String(formData.get("booking_id"));
  const booking = await loadOwnBooking(bookingId);
  if (!booking || !["confirmed", "pending", "checked_in"].includes(booking.status)) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("bookings")
    .update({ status: "late" })
    .eq("id", bookingId);
  if (error) throw new Error(error.message);

  const ctx = await getBookingContext(bookingId);
  if (ctx) await sendRunningLateAlert(ctx);
  revalidatePath("/vendor");
}
