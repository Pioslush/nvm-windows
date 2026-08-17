-- Supabase's default privileges grant EXECUTE to anon/authenticated/service_role
-- as explicit named-role grants, not via the PUBLIC pseudo-role — so
-- "revoke ... from public" in 0002 was a no-op. Revoke from the actual roles.

-- RLS-helper functions: anon never queries these tables (gate list and
-- invite pages use the service role), so anon gets no direct RPC access.
-- authenticated keeps EXECUTE — RLS policies invoke these as the querying
-- role, so revoking would break every admin/vendor query.
revoke execute on function public.current_email() from anon;
revoke execute on function public.is_venue_admin(uuid) from anon;
revoke execute on function public.is_event_admin(uuid) from anon;
revoke execute on function public.is_invited_to_event(uuid) from anon;
revoke execute on function public.can_vendor_see_event(uuid) from anon;
revoke execute on function public.is_own_vendor(uuid) from anon;

-- Trigger functions: only Postgres' trigger machinery calls these, which
-- does not require the invoking session to hold EXECUTE. No one needs
-- direct callable access, so revoke from both anon and authenticated.
revoke execute on function public.handle_new_venue() from anon, authenticated;
revoke execute on function public.check_booking_slot() from anon, authenticated;
revoke execute on function public.sync_slot_status() from anon, authenticated;
