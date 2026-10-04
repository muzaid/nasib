#!/usr/bin/env bash
# Prove the generated bundle can be pasted into a database that already
# has some of it.
#
# This exists because the claim "safe to re-run" was made about
# nasib-setup.sql before anything checked it, and it was false: the first
# `create type` collided and the whole paste aborted. The bundle is now
# written to be re-runnable, and this is what keeps it that way.
#
#   ./supabase/tests/rerun.sh
#   PGHOST=/tmp PGPORT=55432 ./supabase/tests/rerun.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUNDLE="$(mktemp)"
trap 'rm -f "$BUNDLE"' EXIT
node "$ROOT/tool/bundle-migrations.mjs" > "$BUNDLE"

P() { psql -v ON_ERROR_STOP=1 -X -q "$@"; }
fresh() {
  P -d postgres -c "drop database if exists $1;" -c "create database $1;" >/dev/null 2>&1
  P -d "$1" -f "$ROOT/supabase/local/00_supabase_stubs.sql" >/dev/null 2>&1
}
fail=0
ok()  { echo "   ok   $1"; }
bad() { echo " FAIL  $1"; fail=1; }

# ── 1. the same paste, three times over ───────────────────────────────
# Once is the install. Twice is what happens when someone is not sure
# whether the first paste took. Three times is the same path again, which
# is where a drop-and-recreate that forgot the recreate would show up.
fresh rerun_a
for n in 1 2 3; do
  if P -d rerun_a -f "$BUNDLE" >/dev/null 2>&1; then ok "paste $n applies cleanly"
  else bad "paste $n failed"; P -d rerun_a -f "$BUNDLE" 2>&1 | grep -i error | head -2; break; fi
done

# ── 2. pasted over a database that stopped at an earlier migration ────
# The real case: the schema was built up one migration at a time, and now
# the whole bundle arrives. Everything already there has to be skipped
# and everything new has to land.
fresh rerun_b
for f in "$ROOT"/supabase/migrations/*.sql; do
  case "$(basename "$f")" in 0019_*|0020_*) continue ;; esac
  P -d rerun_b -f "$f" >/dev/null 2>&1 || { bad "building up to 0018 failed at $(basename "$f")"; break; }
done
col="select count(*) from information_schema.columns
      where table_name = 'users' and column_name = 'membership'"
[ "$(P -d rerun_b -tAc "$col")" = "0" ] \
  && ok "a database at 0018 does not have the membership column" \
  || bad "the fixture is not actually at 0018"

if P -d rerun_b -f "$BUNDLE" >/dev/null 2>&1; then
  ok "and the full bundle applies over it"
else
  bad "the full bundle failed over a database at 0018"
  P -d rerun_b -f "$BUNDLE" 2>&1 | grep -i error | head -2
fi
[ "$(P -d rerun_b -tAc "$col")" = "1" ] \
  && ok "bringing the new column with it" || bad "the new column did not land"
[ "$(P -d rerun_b -tAc "select count(*) from information_schema.tables
                         where table_name = 'contact_releases'")" = "1" ] \
  && ok "and the new tables" || bad "the new tables did not land"

# ── 3. re-pasting does not cost anyone their data ─────────────────────
# The dangerous shape of an idempotent script is one that gets there by
# dropping things. Rows, and the policies protecting them, have to be on
# the other side of a second paste.
P -d rerun_b -c "insert into auth.users (id, email)
                 values ('11111111-1111-1111-1111-111111111111', 'x@example.test')
                 on conflict (id) do nothing;" >/dev/null
P -d rerun_b -c "insert into users (id, status, gender, date_of_birth, country_code, city)
                 values ('11111111-1111-1111-1111-111111111111', 'admitted', 'female',
                         '1995-01-01', 'PS', 'رام الله')
                 on conflict (id) do nothing;" >/dev/null
before_policies=$(P -d rerun_b -tAc "select count(*) from pg_policies where schemaname = 'public'")
P -d rerun_b -f "$BUNDLE" >/dev/null 2>&1

[ "$(P -d rerun_b -tAc "select count(*) from users
                        where id = '11111111-1111-1111-1111-111111111111'")" = "1" ] \
  && ok "a member row survives a second paste" || bad "a second paste destroyed data"
[ "$(P -d rerun_b -tAc "select count(*) from pg_policies where schemaname = 'public'")" \
    = "$before_policies" ] \
  && ok "and every row-level policy is still in place" \
  || bad "policies were left dropped — the table is now unprotected"

echo
if [ "$fail" = "0" ]; then echo "the bundle is re-runnable"; else echo "re-run check FAILED"; exit 1; fi
