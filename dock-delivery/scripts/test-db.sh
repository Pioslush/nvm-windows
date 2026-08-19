#!/usr/bin/env bash
# Spins up a throwaway local PostgreSQL cluster, applies the auth shim and the
# real migration, runs the database tests (including the concurrent
# double-booking test), then tears everything down.
#
# Requires PostgreSQL server binaries (initdb/pg_ctl). On Debian/Ubuntu:
#   sudo apt-get install postgresql
set -euo pipefail

cd "$(dirname "$0")/.."

# initdb refuses to run as root; hand the whole script to the postgres user.
if [ "$(id -u)" = "0" ] && id postgres >/dev/null 2>&1 && [ -z "${TEST_DB_REEXEC:-}" ]; then
  chmod o+rx . scripts tests supabase supabase/migrations 2>/dev/null || true
  exec su postgres -s /bin/bash -c "TEST_DB_REEXEC=1 TMPDIR=/tmp bash '$PWD/scripts/test-db.sh' $*"
fi

PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
if [ -z "$PGBIN" ]; then PGBIN="$(dirname "$(command -v initdb)")"; fi

TMPDIR="${TMPDIR:-/tmp}"
CLUSTER="$(mktemp -d "$TMPDIR/dockdelivery-pg.XXXXXX")"
PORT="${TEST_PG_PORT:-54329}"

cleanup() {
  "$PGBIN/pg_ctl" -D "$CLUSTER" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$CLUSTER"
}
trap cleanup EXIT

"$PGBIN/initdb" -D "$CLUSTER" -U postgres --auth=trust >/dev/null
"$PGBIN/pg_ctl" -D "$CLUSTER" -o "-p $PORT -k $CLUSTER -c listen_addresses=127.0.0.1" -l "$CLUSTER/log" start >/dev/null

export DATABASE_URL="postgresql://postgres@127.0.0.1:$PORT/dockdelivery_test"
psql "postgresql://postgres@127.0.0.1:$PORT/postgres" -q -c "create database dockdelivery_test"
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f tests/auth-shim.sql
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f supabase/migrations/0001_schema.sql
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f tests/grants.sql

npx vitest run tests/ "$@"
