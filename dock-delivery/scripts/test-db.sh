#!/usr/bin/env bash
# Spins up a throwaway local PostgreSQL cluster, applies the auth shim and the
# real migration, runs the database tests (including the concurrent
# double-booking test), then tears everything down.
#
# Requires PostgreSQL server binaries (initdb/pg_ctl). On Debian/Ubuntu:
#   sudo apt-get install postgresql
set -euo pipefail

cd "$(dirname "$0")/.."

PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
if [ -z "$PGBIN" ]; then PGBIN="$(dirname "$(command -v initdb)")"; fi

TMPDIR="${TMPDIR:-/tmp}"
CLUSTER="$(mktemp -d "$TMPDIR/dockdelivery-pg.XXXXXX")"
PORT="${TEST_PG_PORT:-54329}"

# initdb and pg_ctl refuse to run as root. Only those two need dropping
# privileges — psql connects over TCP and vitest must stay as the invoking
# user, which owns node_modules and the project directory Vite writes its
# transient config into.
if [ "$(id -u)" = "0" ] && id postgres >/dev/null 2>&1; then
  chown postgres:postgres "$CLUSTER"
  as_postgres() { su postgres -s /bin/bash -c "$1"; }
else
  as_postgres() { bash -c "$1"; }
fi

cleanup() {
  as_postgres "'$PGBIN/pg_ctl' -D '$CLUSTER' stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$CLUSTER"
}
trap cleanup EXIT

as_postgres "'$PGBIN/initdb' -D '$CLUSTER' -U postgres --auth=trust" >/dev/null
as_postgres "'$PGBIN/pg_ctl' -D '$CLUSTER' -o '-p $PORT -k $CLUSTER -c listen_addresses=127.0.0.1' -l '$CLUSTER/log' start" >/dev/null

export DATABASE_URL="postgresql://postgres@127.0.0.1:$PORT/dockdelivery_test"
psql "postgresql://postgres@127.0.0.1:$PORT/postgres" -q -c "create database dockdelivery_test"
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f tests/auth-shim.sql
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f supabase/migrations/0001_schema.sql
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f tests/grants.sql

npx vitest run tests/ "$@"
