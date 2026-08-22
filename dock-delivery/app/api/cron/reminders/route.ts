import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBookingContext, sendReminder } from "@/lib/notify";

export const dynamic = "force-dynamic";

/**
 * Sends the 24-hours-before reminder for confirmed bookings.
 * Wired to Vercel Cron (see vercel.json — runs hourly). Idempotent:
 * `reminded_at` is stamped so a booking is never reminded twice.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically
 * when CRON_SECRET is set in the project env.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = Date.now();
  const windowEnd = new Date(now + 24 * 36e5).toISOString();

  // Confirmed/pending bookings starting within the next 24h, not yet reminded.
  const { data: due, error } = await admin
    .from("bookings")
    .select("id, slot:slots!inner(start_time)")
    .in("status", ["confirmed", "pending"])
    .is("reminded_at", null)
    .gte("slot.start_time", new Date(now).toISOString())
    .lte("slot.start_time", windowEnd);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let sent = 0;
  for (const row of due ?? []) {
    // Stamp first — a crash mid-run must not re-send, and a send failure is
    // recoverable by clearing reminded_at manually.
    const { data: claimed } = await admin
      .from("bookings")
      .update({ reminded_at: new Date().toISOString() })
      .eq("id", row.id)
      .is("reminded_at", null)
      .select("id");
    if (!claimed || claimed.length === 0) continue;

    const ctx = await getBookingContext(row.id);
    if (ctx) {
      await sendReminder(ctx);
      sent++;
    }
  }

  return NextResponse.json({ checked: due?.length ?? 0, sent });
}
