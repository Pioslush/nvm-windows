import type { Config } from "@netlify/functions";

/**
 * Hourly reminder emails.
 *
 * Netlify ignores `vercel.json`, so the Vercel Cron entries don't carry
 * over. Rather than duplicate the logic, this calls the existing
 * `/api/cron/reminders` route — the same code path the Vercel deploy uses,
 * already covered by the app's own idempotency (`reminded_at`).
 */
export default async () => {
  const base = Netlify.env.get("URL");
  const secret = Netlify.env.get("CRON_SECRET");
  if (!base) {
    console.error("[cron:reminders] URL is not set — cannot call the app");
    return;
  }

  const res = await fetch(`${base}/api/cron/reminders`, {
    headers: secret ? { Authorization: `Bearer ${secret}` } : {},
  });
  const body = await res.text();

  if (!res.ok) {
    console.error(`[cron:reminders] ${res.status}: ${body}`);
    return;
  }
  console.log(`[cron:reminders] ${body}`);
};

export const config: Config = {
  schedule: "@hourly",
};
