import type { Config } from "@netlify/functions";

/**
 * Daily slot-horizon top-up.
 *
 * Slots are also generated synchronously whenever an admin saves a dock's
 * availability, so a fresh facility is immediately bookable ~21 days out.
 * This keeps that window rolling forward; without it the horizon quietly
 * shrinks to nothing over three weeks.
 *
 * Runs at 09:10 UTC (early morning across US timezones) rather than on the
 * hour, to stay off the every-service-fires-at-midnight pileup.
 */
export default async () => {
  const base = Netlify.env.get("URL");
  const secret = Netlify.env.get("CRON_SECRET");
  if (!base) {
    console.error("[cron:generate-slots] URL is not set — cannot call the app");
    return;
  }

  const res = await fetch(`${base}/api/cron/generate-slots`, {
    headers: secret ? { Authorization: `Bearer ${secret}` } : {},
  });
  const body = await res.text();

  if (!res.ok) {
    console.error(`[cron:generate-slots] ${res.status}: ${body}`);
    return;
  }
  console.log(`[cron:generate-slots] ${body}`);
};

export const config: Config = {
  schedule: "10 9 * * *",
};
