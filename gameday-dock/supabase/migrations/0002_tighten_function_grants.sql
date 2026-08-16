-- Pin search_path on current_email (flagged by the Supabase linter; others already have it).
create or replace function public.current_email()
returns text
language sql
set search_path = public
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

-- Tighten function grants:
--  - RLS-helper functions are only ever called from within policy
--    expressions evaluated as `authenticated` — anon never queries these
--    tables (the gate list and invite pages use the service role instead),
--    so anon/public direct RPC access is pure attack surface. Revoke it.
--  - Trigger functions (handle_new_venue, check_booking_slot,
--    sync_slot_status) are invoked by Postgres' trigger machinery, which
--    does not require the invoking role to hold EXECUTE — so no one needs
--    direct callable access to them at all.
--
-- Note: this revokes from the `public` pseudo-role only. On Supabase, new
-- functions also get explicit EXECUTE grants to anon/authenticated/
-- service_role via default privileges, which "revoke ... from public" does
-- NOT touch — see 0003 for the actual fix targeting those named roles.
revoke execute on function public.current_email() from public;
revoke execute on function public.is_venue_admin(uuid) from public;
revoke execute on function public.is_event_admin(uuid) from public;
revoke execute on function public.is_invited_to_event(uuid) from public;
revoke execute on function public.can_vendor_see_event(uuid) from public;
revoke execute on function public.is_own_vendor(uuid) from public;
revoke execute on function public.handle_new_venue() from public;
revoke execute on function public.check_booking_slot() from public;
revoke execute on function public.sync_slot_status() from public;

grant execute on function public.current_email() to authenticated;
grant execute on function public.is_venue_admin(uuid) to authenticated;
grant execute on function public.is_event_admin(uuid) to authenticated;
grant execute on function public.is_invited_to_event(uuid) to authenticated;
grant execute on function public.can_vendor_see_event(uuid) to authenticated;
grant execute on function public.is_own_vendor(uuid) to authenticated;
