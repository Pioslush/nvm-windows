import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client — bypasses RLS. Server-only. Used exclusively for flows
 * with their own token-based authorization (the dock manifest, invite links)
 * and for sending notifications that need to look across users.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Without this the Supabase client throws "supabaseKey is required" from
  // deep inside a request, which reads like a library bug rather than a
  // missing deploy setting. The manifest and invite pages are the only
  // surfaces that need it, so a misconfigured deploy looks fine until
  // someone opens the gate link — name the actual problem instead.
  if (!url || !serviceKey) {
    const missing = [
      !url && "NEXT_PUBLIC_SUPABASE_URL",
      !serviceKey && "SUPABASE_SERVICE_ROLE_KEY",
    ]
      .filter(Boolean)
      .join(" and ");
    throw new Error(
      `${missing} is not set. The dock manifest, invite links, and the ` +
        `reminder/slot-generation crons all need it. Add it to .env.local ` +
        `locally, or to the project's environment variables when deployed.`
    );
  }

  return createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
