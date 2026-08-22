-- Tighten function grants (same rationale as GameDay Dock's hardening pass):
--  - RLS-helper functions are only ever called from within policy
--    expressions evaluated as `authenticated` — anon never queries these
--    tables directly (invite links and the manifest page use the service
--    role instead), so anon/public direct RPC access is pure attack surface.
--  - Trigger functions (handle_new_facility, check_booking_slot,
--    sync_slot_status) are invoked by Postgres' trigger machinery, which
--    does not require the invoking role to hold EXECUTE — so no one needs
--    direct callable access to them at all.
--
-- Every `CREATE FUNCTION` gets an implicit EXECUTE grant to PUBLIC unless
-- revoked (shows up as the bare `=X/postgres` entry in pg_proc.proacl) —
-- that's the actual permissive grant here, not a named anon/authenticated
-- grant. Revoking from PUBLIC removes it for every role, including anon
-- and authenticated; grant back to authenticated only where RLS policies
-- actually need to call these as the querying role.
-- (Confirmed via `has_function_privilege('anon'/'authenticated', oid,
-- 'EXECUTE')` against the live project — see PHASES.md.)

revoke execute on function public.current_email() from public;
revoke execute on function public.is_facility_admin(uuid) from public;
revoke execute on function public.is_invited_to_facility(uuid) from public;
revoke execute on function public.is_own_carrier(uuid) from public;
revoke execute on function public.handle_new_facility() from public;
revoke execute on function public.check_booking_slot() from public;
revoke execute on function public.sync_slot_status() from public;

grant execute on function public.current_email() to authenticated;
grant execute on function public.is_facility_admin(uuid) to authenticated;
grant execute on function public.is_invited_to_facility(uuid) to authenticated;
grant execute on function public.is_own_carrier(uuid) to authenticated;
