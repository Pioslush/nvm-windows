-- Applied after the migration in test runs only: mimics Supabase's grants so
-- RLS tests can run queries as the `authenticated` role. (Supabase cloud sets
-- these up itself.)

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

grant usage on schema public, auth to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
grant execute on all functions in schema auth to authenticated;
