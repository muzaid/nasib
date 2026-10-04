#!/usr/bin/env bash
# Rebuild a throwaway database from the migrations and run the SQL suite.
#
# The suite is not idempotent by design — it draws a slate and creates a
# match, which is the behaviour under test. So it always runs against a
# freshly built database, never against one that has been used.
#
#   ./supabase/tests/run.sh                    # uses a local postgres on 5432
#   PGHOST=/tmp PGPORT=55432 ./supabase/tests/run.sh
set -euo pipefail

DB="${NASIB_TEST_DB:-nasib_test}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PSQL=(psql -v ON_ERROR_STOP=1 -X -q)

echo "Rebuilding $DB"
"${PSQL[@]}" -d postgres -c "drop database if exists $DB;" -c "create database $DB;" >/dev/null

"${PSQL[@]}" -d "$DB" -f "$ROOT/supabase/local/00_supabase_stubs.sql"
for f in "$ROOT"/supabase/migrations/*.sql \
         "$ROOT"/supabase/seed/seed.sql \
         "$ROOT"/supabase/seed/seed_photos_meetings.sql \
         "$ROOT"/supabase/tests/00_helpers.sql; do
  echo "  applying $(basename "$f")"
  "${PSQL[@]}" -d "$DB" -f "$f"
done

total=0
# Order matters: the matching suite creates the match the photo and meeting
# suite then works on.
for suite in test_matching_and_rls test_photos_and_meetings test_message_redaction test_web_signup test_review_desk test_account_security test_release test_moderation; do
  echo
  # Capture rather than let `set -e` kill the run: a failing assertion is a
  # result to report, not a crash to hide.
  out=$(psql -v ON_ERROR_STOP=1 -X -d "$DB" -f "$ROOT/supabase/tests/$suite.sql" 2>&1) || true
  echo "$out" | { grep -E 'NOTICE: +ok|== |tests passed|ERROR|FAILED' || true; } \
    | sed -E 's/^psql:[^ ]+ //'

  passed=$(echo "$out" | grep -cE 'NOTICE: +ok' || true)
  total=$((total + passed))

  if echo "$out" | grep -qE 'ERROR|FAILED'; then
    echo
    echo "FAILED in $suite after $passed assertions"
    exit 1
  fi
done

echo
echo "$total assertions passed"
