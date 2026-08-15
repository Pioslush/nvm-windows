import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, emailLayout, detailRows, ctaButton, appUrl } from "@/lib/email";
import { formatTimeRange, formatDayLong } from "@/lib/time";
import type { Booking, Dock, Event, Slot, Vendor, Venue } from "@/lib/types";

export interface BookingContext {
  booking: Booking;
  slot: Slot;
  dock: Dock;
  event: Event;
  venue: Venue;
  vendor: Vendor;
}

/** Loads everything an email about a booking needs (service role — RLS-free). */
export async function getBookingContext(bookingId: string): Promise<BookingContext | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("bookings")
    .select("*, slot:slots(*, dock:docks(*), event:events(*, venue:venues(*))), vendor:vendors(*)")
    .eq("id", bookingId)
    .maybeSingle();
  if (!data) return null;
  const slot = data.slot as Slot & { dock: Dock; event: Event & { venue: Venue } };
  return {
    booking: data as unknown as Booking,
    slot,
    dock: slot.dock,
    event: slot.event,
    venue: slot.event.venue,
    vendor: data.vendor as unknown as Vendor,
  };
}

function bookingDetails(ctx: BookingContext): string {
  const { slot, dock, event, venue } = ctx;
  const rows: [string, string][] = [
    ["Event", event.name],
    ["Date", formatDayLong(slot.start_time, venue.timezone)],
    ["Time", formatTimeRange(slot.start_time, slot.end_time, venue.timezone)],
    ["Dock", dock.name],
    ["Venue", `${venue.name}${venue.address ? ` — ${venue.address}` : ""}, ${venue.city}`],
  ];
  if (dock.notes) rows.push(["Dock notes", dock.notes]);
  return detailRows(rows);
}

export async function sendBookingConfirmed(ctx: BookingContext) {
  await sendEmail({
    to: ctx.vendor.email,
    subject: `Confirmed: ${ctx.dock.name} · ${formatTimeRange(ctx.slot.start_time, ctx.slot.end_time, ctx.venue.timezone)} · ${ctx.event.name}`,
    html: emailLayout(
      "Your dock slot is confirmed ✅",
      `<p style="color:#334155;">${ctx.vendor.company_name}, you're on the gate list. Details:</p>
       ${bookingDetails(ctx)}
       <p style="color:#334155;">Running late or need to change it? Manage your booking below.</p>
       ${ctaButton(appUrl("/vendor"), "Manage my booking")}`
    ),
  });
}

export async function sendBookingReceived(ctx: BookingContext) {
  await sendEmail({
    to: ctx.vendor.email,
    subject: `Request received: ${ctx.event.name} — awaiting venue approval`,
    html: emailLayout(
      "Booking request received",
      `<p style="color:#334155;">${ctx.venue.name} requires approval for bookings. We'll email you the moment they confirm. Requested:</p>
       ${bookingDetails(ctx)}`
    ),
  });
}

export async function sendBookingCancelledByVenue(ctx: BookingContext) {
  await sendEmail({
    to: ctx.vendor.email,
    subject: `Booking not approved: ${ctx.event.name}`,
    html: emailLayout(
      "Booking declined",
      `<p style="color:#334155;">${ctx.venue.name} couldn't approve this slot. The remaining open slots are still available to book.</p>
       ${bookingDetails(ctx)}
       ${ctaButton(appUrl(`/vendor/events/${ctx.event.id}`), "Pick another slot")}`
    ),
  });
}

export async function sendReminder(ctx: BookingContext) {
  await sendEmail({
    to: ctx.vendor.email,
    subject: `Tomorrow: ${ctx.dock.name} · ${formatTimeRange(ctx.slot.start_time, ctx.slot.end_time, ctx.venue.timezone)} · ${ctx.event.name}`,
    html: emailLayout(
      "Delivery reminder — you're up tomorrow",
      `${bookingDetails(ctx)}
       <p style="color:#334155;">Give the driver the dock name and this time window. Running behind on game day? Use the “Running late” button so the venue knows.</p>
       ${ctaButton(appUrl("/vendor"), "View my booking")}`
    ),
  });
}

/** Notify the venue's admin (the venue creator) — used for "running late" and new requests. */
export async function notifyVenueAdmin(venue: Venue, subject: string, title: string, bodyHtml: string) {
  const admin = createAdminClient();
  const { data } = await admin.auth.admin.getUserById(venue.created_by);
  const to = data?.user?.email;
  if (!to) return;
  await sendEmail({ to, subject, html: emailLayout(title, bodyHtml) });
}

export async function sendRunningLateAlert(ctx: BookingContext) {
  await notifyVenueAdmin(
    ctx.venue,
    `🕐 Running late: ${ctx.vendor.company_name} — ${ctx.dock.name}`,
    "A vendor is running late",
    `<p style="color:#334155;"><strong>${ctx.vendor.company_name}</strong> (${ctx.vendor.contact_name}, ${ctx.vendor.phone}) flagged they're running late for:</p>
     ${bookingDetails(ctx)}
     ${ctaButton(appUrl("/today"), "Open day-of dashboard")}`
  );
}

export async function sendNewRequestAlert(ctx: BookingContext) {
  await notifyVenueAdmin(
    ctx.venue,
    `New booking request: ${ctx.vendor.company_name} — ${ctx.event.name}`,
    "New booking request",
    `<p style="color:#334155;"><strong>${ctx.vendor.company_name}</strong> requested a slot (“${ctx.booking.purpose}”):</p>
     ${bookingDetails(ctx)}
     ${ctaButton(appUrl(`/events/${ctx.event.id}`), "Review request")}`
  );
}

export async function sendInviteEmail(opts: {
  to: string;
  token: string;
  event: Event;
  venue: Venue;
}) {
  const { to, token, event, venue } = opts;
  await sendEmail({
    to,
    subject: `${venue.name} invited you to book a delivery slot — ${event.name}`,
    html: emailLayout(
      `Delivery slots open: ${event.name}`,
      `<p style="color:#334155;"><strong>${venue.name}</strong> (${venue.city}) is scheduling game-day deliveries through GameDay Dock. Pick the dock slot that works for you — first come, first served.</p>
       ${detailRows([
         ["Event", event.name],
         ["Load-in window", `${formatDayLong(event.load_in_start, venue.timezone)}, ${formatTimeRange(event.load_in_start, event.load_in_end, venue.timezone)}`],
       ])}
       ${ctaButton(appUrl(`/invite/${token}`), "Choose my slot")}
       <p style="color:#71717a;font-size:13px;">This link is personal to ${to}. New here? The link also creates your free vendor account.</p>`
    ),
  });
}
