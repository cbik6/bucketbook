#!/usr/bin/env bash
# Tests the nightly backup and a full restore against a running throwaway install.
# scripts/e2e.sh runs it after the browser tests, so the database has real data:
#
#   bash scripts/backup-test.sh PROJECT ENV_FILE BACKUPS_DIR PORT
#
# 1. The scheduled backup ran when the stack started (BACKUP_TIME=00:00) and
#    /api/health reports it.
# 2. "Back up now" keeps only the newest BACKUP_KEEP_DAYS (3) daily files, leaves
#    other files alone, and leaves no .partial file behind.
# 3. With the app stopped: fingerprint every table (row count and a hash of all
#    rows) and every sequence, back up, delete the database's files, start an empty
#    Postgres, let the app create empty tables, and restore. The restore must save
#    the database it replaces, and the fingerprints must match exactly.
# 4. The app starts healthy on the restored database.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT=$1
ENV_FILE=$2
BACKUPS=$3
PORT=$4
DATA_DIR=$(sed -n 's/^DATA_DIR=//p' "$ENV_FILE")

dc() { docker compose -p "$PROJECT" --env-file "$ENV_FILE" "$@"; }
fail() {
  echo "BACKUP TEST FAILED: $*" >&2
  dc logs --tail 40 backup >&2 || true
  exit 1
}
health() { curl -fsS "http://localhost:${PORT}/api/health"; }
backup_status() { health | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).backup.status))'; }
sql() { dc exec -T postgres psql -U bucketbook -d bucketbook -XAt -v ON_ERROR_STOP=1 "$@"; }

fingerprint() {
  sql <<'SQL'
select format('%I.%I', table_schema, table_name)
  || ' rows=' || (xpath('/row/n/text()', query_to_xml(
       format('select count(*) as n from %I.%I', table_schema, table_name), false, true, '')))[1]::text
  || ' md5=' || (xpath('/row/h/text()', query_to_xml(
       format('select md5(coalesce(string_agg(t::text, ''|'' order by t::text), '''')) as h from %I.%I t',
              table_schema, table_name), false, true, '')))[1]::text
from information_schema.tables
where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog', 'information_schema')
union all
select format('sequence %I.%I = %s', schemaname, sequencename, coalesce(last_value::text, 'unset'))
from pg_sequences
order by 1;
SQL
}

wait_healthy() {
  for _ in $(seq 1 60); do
    health >/dev/null 2>&1 && return 0
    sleep 2
  done
  fail "the app did not become healthy"
}

echo "== Backup: the scheduled run at start"
for _ in $(seq 1 30); do
  [[ "$(backup_status)" == ok ]] && break
  sleep 2
done
[[ "$(backup_status)" == ok ]] || fail "health reports backup status $(backup_status), not ok"
TODAY=$(dc exec -T backup date +%Y-%m-%d | tr -d '\r')
[[ -f "$BACKUPS/bucketbook-$TODAY.sql.gz" ]] || fail "no bucketbook-$TODAY.sql.gz after the scheduled run"
echo "ok: scheduled backup ran, health shows it"

echo "== Backup: back up now, retention and file ownership"
for d in 01 02 03 04 05; do echo old >"$BACKUPS/bucketbook-2020-01-$d.sql.gz"; done
echo mine >"$BACKUPS/keep-me.txt"
dc exec -T backup bucketbook-backup now
mapfile -t daily < <(cd "$BACKUPS" && ls bucketbook-*.sql.gz | sort)
expected=("bucketbook-2020-01-04.sql.gz" "bucketbook-2020-01-05.sql.gz" "bucketbook-$TODAY.sql.gz")
[[ "${daily[*]}" == "${expected[*]}" ]] || fail "kept ${daily[*]}, expected ${expected[*]}"
[[ -f "$BACKUPS/keep-me.txt" ]] || fail "retention removed a file that is not a daily backup"
if compgen -G "$BACKUPS/.*.partial" >/dev/null; then fail "a .partial file was left behind"; fi
owner=$(stat -c '%u %a' "$BACKUPS/bucketbook-$TODAY.sql.gz")
[[ "$owner" == "$(stat -c %u "$BACKUPS") 600" ]] || fail "backup file owner and mode are $owner"
gzip -t "$BACKUPS/bucketbook-$TODAY.sql.gz" || fail "the backup is not valid gzip"
rm -f "$BACKUPS"/bucketbook-2020-01-0*.sql.gz "$BACKUPS/keep-me.txt"
echo "ok: kept the newest 3, other files untouched, owned by the folder's owner, mode 600"

echo "== Restore: back up, wipe the database, restore, compare"
dc stop app >/dev/null
fingerprint >"$BACKUPS/../before.txt"
rows=$(awk -F'rows=' 'NF > 1 { split($2, a, " "); n += a[1] } END { print n + 0 }' "$BACKUPS/../before.txt")
((rows > 50)) || fail "only $rows rows to test with; the browser tests should leave more"
dc exec -T backup bucketbook-backup now
file="backups/bucketbook-$TODAY.sql.gz"

# Wipe: remove Postgres and its files, then start it again on an empty folder.
dc rm -sf postgres >/dev/null
docker run --rm -v "$DATA_DIR/postgres:/x" --entrypoint sh postgres:18-alpine -c 'rm -rf /x/*'
dc up -d --wait postgres >/dev/null
[[ "$(sql -c "select count(*) from information_schema.tables where table_schema = 'public'")" == 0 ]] ||
  fail "the database was not empty after the wipe"

# Let the app create its empty tables, so the restore has a database to set aside.
dc up -d --wait app >/dev/null
dc stop app >/dev/null
dc run --rm -T backup restore "$file"
compgen -G "$BACKUPS/before-restore-*.sql.gz" >/dev/null || fail "restore did not save the database it replaced"

fingerprint >"$BACKUPS/../after.txt"
diff -u "$BACKUPS/../before.txt" "$BACKUPS/../after.txt" || fail "the restored data differs"
echo "ok: $(wc -l <"$BACKUPS/../before.txt") tables and sequences, $rows rows, identical after restore"

echo "== Restore: the app starts on the restored database"
dc up -d --wait app >/dev/null
wait_healthy
echo "ok: $(health)"
echo "BACKUP TEST PASSED"
