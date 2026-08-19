import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, emailLayout, detailRows, ctaButton, appUrl } from "@/lib/email";
import { formatTimeRange, formatDayLong } from "@/lib/time";
import type { Booking, Dock, Slot, Carrier, Facility } from "@/lib/types";

export interface BookingContext {
  booking: Booking;
  slot: Slot;
  dock: Dock;
  facility: Facility;
  carrier: Carrier;
}

/** Loads everything an email about a booking needs (service role — RLS-free). */
export async function getBookingContext(bookingId: string): Promise<BookingContext | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("bookings")
    .select("*, slot:slots(*, dock:docks(*, facility:facilities(*))), carrier:carriers(*)")
    .eq("id", bookingId)
    .maybeSingle();
  if (!data) return null;
  const slot = data.slot as Slot & { dock: Dock & { facility: Facility } };
  return {
    booking: data as unknown as Booking,
    slot,
    dock: slot.dock,
    facility: slot.dock.facility,
    carrier: data.carrier as unknown as Carrier,
  };
}

function bookingDetails(ctx: BookingContext): string {
  const { slot, dock, facility } = ctx;
  const rows: [string, string][] = [
    ["Date", formatDayLong(slot.start_time, facility.timezone)],
    ["Time", formatTimeRange(slot.start_time, slot.end_time, facility.timezone)],
    ["Dock", dock.name],
    ["Facility", `${facility.name}${facility.address ? ` — ${facility.address}` : ""}, ${facility.city}`],
  ];
  if (dock.notes) rows.push(["Dock notes", dock.notes]);
  return detailRows(rows);
}

export async function sendBookingConfirmed(ctx: BookingContext) {
  await sendEmail({
    to: ctx.carrier.email,
    subject: `Confirmed: ${ctx.dock.name} · ${formatTimeRange(ctx.slot.start_time, ctx.slot.end_time, ctx.facility.timezone)} · ${ctx.facility.name}`,
    html: emailLayout(
      "Your dock slot is confirmed ✅",
      `<p style="color:#334155;">${ctx.carrier.company_name}, you're on the dock manifest. Details:</p>
       ${bookingDetails(ctx)}
       <p style="color:#334155;">Running late or need to change it? Manage your booking below.</p>
       ${ctaButton(appUrl("/carrier"), "Manage my booking")}`
    ),
  });
}

export async function sendBookingReceived(ctx: BookingContext) {
  await sendEmail({
    to: ctx.carrier.email,
    subject: `Request received: ${ctx.facility.name} — awaiting approval`,
    html: emailLayout(
      "Booking request received",
      `<p style="color:#334155;">${ctx.facility.name} requires approval for bookings. We'll email you the moment they confirm. Requested:</p>
       ${bookingDetails(ctx)}`
    ),
  });
}

export async function sendBookingCancelledByFacility(ctx: BookingContext) {
  await sendEmail({
    to: ctx.carrier.email,
    subject: `Booking not approved: ${ctx.facility.name}`,
    html: emailLayout(
      "Booking declined",
      `<p style="color:#334155;">${ctx.facility.name} couldn't approve this slot. Other open slots at this facility are still available to book.</p>
       ${bookingDetails(ctx)}
       ${ctaButton(appUrl(`/carrier/facilities/${ctx.facility.id}`), "Pick another slot")}`
    ),
  });
}

export async function sendReminder(ctx: BookingContext) {
  await sendEmail({
    to: ctx.carrier.email,
    subject: `Tomorrow: ${ctx.dock.name} · ${formatTimeRange(ctx.slot.start_time, ctx.slot.end_time, ctx.facility.timezone)} · ${ctx.facility.name}`,
    html: emailLayout(
      "Delivery reminder — you're up tomorrow",
      `${bookingDetails(ctx)}
       <p style="color:#334155;">Give the driver the dock name and this time window. Running behind? Use the "Running late" button so the facility knows.</p>
       ${ctaButton(appUrl("/carrier"), "View my booking")}`
    ),
  });
}

/** Notify the facility's admin (the facility creator) — used for "running late" and new requests. */
export async function notifyFacilityAdmin(facility: Facility, subject: string, title: string, bodyHtml: string) {
  const admin = createAdminClient();
  const { data } = await admin.auth.admin.getUserById(facility.created_by);
  const to = data?.user?.email;
  if (!to) return;
  await sendEmail({ to, subject, html: emailLayout(title, bodyHtml) });
}

export async function sendRunningLateAlert(ctx: BookingContext) {
  await notifyFacilityAdmin(
    ctx.facility,
    `🕐 Running late: ${ctx.carrier.company_name} — ${ctx.dock.name}`,
    "A carrier is running late",
    `<p style="color:#334155;"><strong>${ctx.carrier.company_name}</strong> (${ctx.carrier.contact_name}, ${ctx.carrier.phone}) flagged they're running late for:</p>
     ${bookingDetails(ctx)}
     ${ctaButton(appUrl("/today"), "Open today's dashboard")}`
  );
}

export async function sendNewRequestAlert(ctx: BookingContext) {
  await notifyFacilityAdmin(
    ctx.facility,
    `New booking request: ${ctx.carrier.company_name} — ${ctx.dock.name}`,
    "New booking request",
    `<p style="color:#334155;"><strong>${ctx.carrier.company_name}</strong> requested a slot ("${ctx.booking.purpose}"):</p>
     ${bookingDetails(ctx)}
     ${ctaButton(appUrl("/schedule"), "Review request")}`
  );
}

export async function sendInviteEmail(opts: {
  to: string;
  token: string;
  facility: Facility;
}) {
  const { to, token, facility } = opts;
  await sendEmail({
    to,
    subject: `${facility.name} invited you to book dock deliveries`,
    html: emailLayout(
      `Dock slots open: ${facility.name}`,
      `<p style="color:#334155;"><strong>${facility.name}</strong> (${facility.city}) is scheduling dock deliveries. Pick any open slot that works for you — first come, first served, any time.</p>
       ${ctaButton(appUrl(`/invite/${token}`), "Browse open slots")}
       <p style="color:#71717a;font-size:13px;">This link is personal to ${to}. New here? The link also creates your free carrier account.</p>`
    ),
  });
}
