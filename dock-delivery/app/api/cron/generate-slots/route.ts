import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateSlotsForDock } from "@/lib/slots";

export const dynamic = "force-dynamic";

/**
 * Keeps every dock's rolling slot horizon (~21 days) topped up. Slots are
 * also generated synchronously when an admin saves a dock's availability
 * (see setDockAvailability in app/actions/admin.ts) — this cron just
 * extends the window forward daily so it never runs dry.
 *
 * Wired to Vercel Cron (see vercel.json — runs daily). Idempotent: relies
 * on slots(dock_id, start_time) unique + ignoreDuplicates.
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

  const { data: docks, error } = await admin
    .from("docks")
    .select("id, facility:facilities(timezone)");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let generated = 0;
  for (const dock of docks ?? []) {
    const timezone = (dock.facility as unknown as { timezone: string } | null)?.timezone ?? "America/Denver";
    const result = await generateSlotsForDock(admin, dock.id, timezone);
    generated += result.generated;
  }

  return NextResponse.json({ docks: docks?.length ?? 0, generated });
}
