/**
 * Deploy pre-flight: verifies the environment is complete and actually works
 * before you ship, instead of finding out from a 500 on the manifest page
 * mid-demo.
 *
 * Local:  npm run preflight
 * Deploy: run it against production env vars (e.g. `vercel env pull` first,
 *         or as a post-deploy check with the same variables exported).
 *
 * Exits non-zero if anything required is missing or unreachable.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

const RED = "\x1b[31m", YELLOW = "\x1b[33m", GREEN = "\x1b[32m", DIM = "\x1b[2m", RESET = "\x1b[0m";

const problems = [];
const warnings = [];

function required(name, why) {
  const value = process.env[name];
  if (!value) {
    problems.push(`${name} is not set — ${why}`);
    return null;
  }
  console.log(`${GREEN}✓${RESET} ${name} ${DIM}set${RESET}`);
  return value;
}

function optional(name, why) {
  const value = process.env[name];
  if (!value) {
    warnings.push(`${name} is not set — ${why}`);
    return null;
  }
  console.log(`${GREEN}✓${RESET} ${name} ${DIM}set${RESET}`);
  return value;
}

console.log("\nEnvironment\n");

const url = required("NEXT_PUBLIC_SUPABASE_URL", "the app cannot reach Supabase at all");
required("NEXT_PUBLIC_SUPABASE_ANON_KEY", "sign-in and every logged-in page will fail");
const serviceKey = required(
  "SUPABASE_SERVICE_ROLE_KEY",
  "the dock manifest, invite links, and both crons will fail at runtime"
);
const appUrl = optional(
  "NEXT_PUBLIC_APP_URL",
  "links in outgoing emails will point at http://localhost:3000"
);
optional("CRON_SECRET", "the cron endpoints will be publicly callable by anyone");
optional("RESEND_API_KEY", "emails print to the server log instead of being delivered");
optional("EMAIL_FROM", "emails send from Resend's shared onboarding@resend.dev address");

if (appUrl && /localhost/.test(appUrl)) {
  warnings.push(`NEXT_PUBLIC_APP_URL points at localhost (${appUrl}) — fine locally, wrong in production`);
}

// ── connectivity: prove the service role key actually works ──────────────
if (url && serviceKey) {
  console.log("\nConnectivity\n");
  try {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { error } = await admin.from("facilities").select("id").limit(1);
    if (error) {
      problems.push(`Supabase rejected the service-role key: ${error.message}`);
    } else {
      console.log(`${GREEN}✓${RESET} service-role key authenticates and the schema is reachable`);
    }
  } catch (e) {
    problems.push(`Could not reach Supabase: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ── report ───────────────────────────────────────────────────────────────
if (warnings.length) {
  console.log(`\n${YELLOW}Warnings${RESET}\n`);
  for (const w of warnings) console.log(`  ${YELLOW}!${RESET} ${w}`);
}

if (problems.length) {
  console.log(`\n${RED}Blocking${RESET}\n`);
  for (const p of problems) console.log(`  ${RED}✗${RESET} ${p}`);
  console.log(`\n${RED}Not ready to deploy.${RESET}\n`);
  process.exit(1);
}

console.log(`\n${GREEN}Ready to deploy.${RESET}${warnings.length ? ` ${DIM}(${warnings.length} warning${warnings.length > 1 ? "s" : ""} above)${RESET}` : ""}\n`);
