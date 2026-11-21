#!/bin/sh
# Moves the data of a Bucketbook 1.0.1 (or earlier) install out of Docker volumes and into its folder,
# so backing up the folder backs up Bucketbook. Run it once, in the folder with
# docker-compose.yml and .env:
#
#   curl -fsSL https://raw.githubusercontent.com/cbik6/bucketbook/main/scripts/move-data.sh | sh
#
# 1. Saves a database backup and the row count of every table.
# 2. Gets the new docker-compose.yml (keeping the old one as docker-compose.yml.old).
# 3. Stops Bucketbook and copies the volumes into data/postgres and data/receipts.
# 4. Checks the copy file by file (contents, owner, permissions).
# 5. Adds DATA_DIR=./data to .env, starts the database on the new folder, and checks
#    every table has the same number of rows as before.
# 6. Starts the rest of Bucketbook.
# 7. Only then asks whether to remove the old volumes. It never removes them by itself.
#
# Nothing in the old volumes is changed, so if any step fails, Bucketbook can go back
# to them; the script prints how.
#
# Optional settings, set in front of `sh`:
#   COMPOSE_PROJECT_NAME  if you changed the project name (default: bucketbook)
#   BUCKETBOOK_SKIP_PULL  1 to use the images already on this machine
set -eu

SOURCE="${BUCKETBOOK_SOURCE:-https://raw.githubusercontent.com/cbik6/bucketbook/main}"
OLD_COMPOSE="https://raw.githubusercontent.com/cbik6/bucketbook/v1.0.1/docker-compose.yml"
PROJECT="${COMPOSE_PROJECT_NAME:-bucketbook}"
PG_VOLUME="${PROJECT}_pgdata"
RECEIPTS_VOLUME="${PROJECT}_receipts"
TOOL_IMAGE=postgres:18-alpine
STAMP=$(date +%Y-%m-%d-%H%M%S)

say() { printf '%s\n' "$*"; }
step() { printf '\n== %s\n' "$*"; }
fail() {
  say "" >&2
  say "Moving the data stopped: $*" >&2
  exit 1
}
# After the old stack is stopped, a failure also explains how to go back.
fail_after_stop() {
  say "" >&2
  say "Moving the data stopped: $*" >&2
  say "" >&2
  say "Your data is untouched in the Docker volumes $PG_VOLUME and $RECEIPTS_VOLUME." >&2
  if [ -f "docker-compose.yml.old" ]; then
    say "To go back to how it was, run these here:" >&2
    say "  mv docker-compose.yml.old docker-compose.yml" >&2
  else
    say "To go back to how it was, run these here:" >&2
    say "  curl -fsSL $OLD_COMPOSE -o docker-compose.yml" >&2
  fi
  say "  sed -i.bak '/^DATA_DIR=/d' .env" >&2
  say "  docker compose up -d" >&2
  exit 1
}

fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$2" "$1"
  else
    fail "curl or wget is needed to download the new docker-compose.yml."
  fi
}

# Runs a shell command in a throwaway container with the given mounts.
in_tool() {
  cmd=$1
  shift
  docker run --rm "$@" --entrypoint sh "$TOOL_IMAGE" -c "$cmd"
}

container_of() {
  docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$1" | head -n 1
}

env_value() {
  sed -n "s/^$1=//p" .env | tail -n 1
}

# Every table's exact row count, one "schema.table count" per line.
ROW_COUNTS_SQL="select format('%I.%I', table_schema, table_name) || ' ' || (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', table_schema, table_name), false, true, '')))[1]::text from information_schema.tables where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog', 'information_schema') order by 1"

# --------------------------------------------------------------------------
step "Checking this folder"
[ -f docker-compose.yml ] && [ -f .env ] ||
  fail "run this in your bucketbook folder, the one with docker-compose.yml and .env."
command -v docker >/dev/null 2>&1 || fail "Docker isn't installed or isn't on the PATH."
docker info >/dev/null 2>&1 || fail "Docker isn't running, or this user can't use it."

if grep -q '^DATA_DIR=' .env; then
  say "This install already keeps its data in the folder (DATA_DIR is set in .env)."
  say "Nothing to move."
  exit 0
fi
docker volume inspect "$PG_VOLUME" >/dev/null 2>&1 ||
  fail "there is no Docker volume called $PG_VOLUME. If you changed the project name, run this with COMPOSE_PROJECT_NAME=<name> in front of sh."
if [ -d data/postgres ] && [ -n "$(ls -A data/postgres 2>/dev/null)" ]; then
  fail "data/postgres already has files in it. Move them out of the way first; nothing was changed."
fi

DB_USER=$(env_value POSTGRES_USER)
DB_USER=${DB_USER:-bucketbook}
DB_NAME=$(env_value POSTGRES_DB)
DB_NAME=${DB_NAME:-bucketbook}

# --------------------------------------------------------------------------
step "Saving a backup and the row counts"
PG=$(container_of postgres)
[ -n "$PG" ] || fail "Bucketbook's database isn't running. Start it with 'docker compose up -d' and run this again."
mkdir -p backups
umask 077
docker exec "$PG" pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges | gzip >"backups/before-move-$STAMP.sql.gz"
# pg_dump ends a complete dump with this line; without it the backup is cut short.
gzip -dc "backups/before-move-$STAMP.sql.gz" | tail -c 1000 | grep -q 'PostgreSQL database dump complete' ||
  fail "the backup before moving didn't work; nothing was changed."
umask 022
say "Saved backups/before-move-$STAMP.sql.gz"

# --------------------------------------------------------------------------
step "Getting the new docker-compose.yml"
if grep -q 'DATA_DIR' docker-compose.yml; then
  say "docker-compose.yml is already the new one."
else
  fetch "$SOURCE/docker-compose.yml" docker-compose.yml.new || fail "couldn't download the new docker-compose.yml; nothing was changed."
  grep -q 'DATA_DIR' docker-compose.yml.new || fail "the downloaded docker-compose.yml isn't the new one; nothing was changed."
  mv docker-compose.yml docker-compose.yml.old
  mv docker-compose.yml.new docker-compose.yml
  say "Kept the old one as docker-compose.yml.old"
fi
# Download the new images while the app still runs, so it's down for less time.
# An install built from source (COMPOSE_FILE with docker-compose.build.yml) builds instead.
if [ "${BUCKETBOOK_SKIP_PULL:-}" = 1 ]; then
  say "Not downloading images (BUCKETBOOK_SKIP_PULL=1)."
elif grep -q '^COMPOSE_FILE=.*build' .env; then
  DATA_DIR=./data docker compose pull --quiet --ignore-buildable postgres ||
    fail "couldn't download the database image; nothing was changed except docker-compose.yml."
else
  DATA_DIR=./data docker compose pull --quiet ||
    fail "couldn't download the new images; nothing was changed except docker-compose.yml."
fi

# --------------------------------------------------------------------------
step "Stopping Bucketbook"
docker exec "$PG" psql -U "$DB_USER" -d "$DB_NAME" -XAt -c "$ROW_COUNTS_SQL" >"backups/.row-counts-before" ||
  fail_after_stop "couldn't count the rows before stopping."
IDS=$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT")
# shellcheck disable=SC2086
[ -z "$IDS" ] || docker stop $IDS >/dev/null
say "Stopped."

# --------------------------------------------------------------------------
step "Copying the database and receipts into data/"
mkdir -p data/postgres data/receipts
in_tool 'cp -a /from/. /to/' -v "$PG_VOLUME:/from:ro" -v "$PWD/data/postgres:/to" ||
  fail_after_stop "copying the database failed."
if docker volume inspect "$RECEIPTS_VOLUME" >/dev/null 2>&1; then
  in_tool 'cp -a /from/. /to/' -v "$RECEIPTS_VOLUME:/from:ro" -v "$PWD/data/receipts:/to" ||
    fail_after_stop "copying the receipts failed."
fi

# --------------------------------------------------------------------------
step "Checking the copy"
# Same files, same contents, same owners and permissions. (Folder sizes depend on the
# filesystem, so only files' sizes are compared.)
CHECK='list() { cd "$1" && { find . -type f -exec stat -c "%u:%g %a %s %n" {} +; find . ! -type f -exec stat -c "%u:%g %a %F %n" {} +; } | sort; }
list /from >/tmp/a && list /to >/tmp/b && diff /tmp/a /tmp/b >/dev/null && diff -r /from /to >/dev/null && wc -l </tmp/a'
n=$(in_tool "$CHECK" -v "$PG_VOLUME:/from:ro" -v "$PWD/data/postgres:/to:ro") ||
  fail_after_stop "the copied database doesn't match the volume."
say "Database: $n files and folders match."
if docker volume inspect "$RECEIPTS_VOLUME" >/dev/null 2>&1; then
  n=$(in_tool "$CHECK" -v "$RECEIPTS_VOLUME:/from:ro" -v "$PWD/data/receipts:/to:ro") ||
    fail_after_stop "the copied receipts don't match the volume."
  say "Receipts: $n files and folders match."
  # Give the receipts your group, so you can read them (the app keeps that group).
  in_tool "chgrp -R $(id -g) /to" -v "$PWD/data/receipts:/to" || fail_after_stop "couldn't set the receipts' group."
fi

# --------------------------------------------------------------------------
step "Starting the database on the new folder"
{
  printf '\n# Where the database and receipts live, relative to this folder (added by move-data.sh).\n'
  printf 'DATA_DIR=./data\n'
} >>.env
docker compose up -d --wait --wait-timeout 300 postgres || fail_after_stop "the database didn't start on the new folder."
PG=$(container_of postgres)
docker exec "$PG" psql -U "$DB_USER" -d "$DB_NAME" -XAt -c "$ROW_COUNTS_SQL" >"backups/.row-counts-after" ||
  fail_after_stop "couldn't count the rows on the new folder."
if diff "backups/.row-counts-before" "backups/.row-counts-after" >/dev/null; then
  tables=$(wc -l <"backups/.row-counts-before" | tr -d ' ')
  say "All $tables tables have the same number of rows as before."
  rm -f "backups/.row-counts-before" "backups/.row-counts-after"
else
  say "Row counts before (<) and after (>):"
  diff "backups/.row-counts-before" "backups/.row-counts-after" || true
  docker compose stop >/dev/null 2>&1 || true
  fail_after_stop "the database on the new folder doesn't have the same rows, so it was stopped again."
fi

step "Starting Bucketbook"
docker compose up -d --wait --wait-timeout 300 || fail_after_stop "Bucketbook didn't start on the new folders."

# --------------------------------------------------------------------------
step "Done"
say "Bucketbook now keeps everything in $(pwd):"
say "  data/postgres   the database"
say "  data/receipts   uploaded receipts"
say "  backups/        a copy of the database every night at 02:00"
say ""
say "The old Docker volumes ($PG_VOLUME, $RECEIPTS_VOLUME) are still there and no"
say "longer used. Check that your books look right before removing them."

answer=""
# Ask on the terminal (stdin is the script itself under curl | sh); with no terminal, don't ask.
if (exec </dev/tty >/dev/tty) 2>/dev/null; then
  printf '\nRemove the old volumes now? Type "yes" to remove them, anything else keeps them: ' >/dev/tty
  read -r answer </dev/tty || answer=""
fi
if [ "$answer" = "yes" ]; then
  docker volume rm "$PG_VOLUME" >/dev/null
  docker volume rm "$RECEIPTS_VOLUME" >/dev/null 2>&1 || true
  say "Removed the old volumes."
else
  say "Kept them. Remove them later with:"
  say "  docker volume rm $PG_VOLUME $RECEIPTS_VOLUME"
fi
