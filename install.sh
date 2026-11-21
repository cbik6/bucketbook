#!/bin/sh
# Installs Bucketbook with Docker.
#
#   curl -fsSL https://raw.githubusercontent.com/cbik6/bucketbook/main/install.sh | sh
#
# Makes a "bucketbook" folder where you run it, downloads docker-compose.yml and
# .env.example into it, writes a .env with fresh secrets, and starts the app, its
# database and the nightly backup. In Docker they show up together as "bucketbook".
# Everything they keep stays in that folder (data/ and backups/), so backing up the
# folder backs up Bucketbook.
#
# Optional settings, for example `curl ... | BUCKETBOOK_PORT=8080 sh`:
#   BUCKETBOOK_DIR   folder to install into (default: bucketbook)
#   BUCKETBOOK_PORT  port on this machine (default: 9951, or the next free one)
#   BUCKETBOOK_URL   address people will type (default: http://<this machine's IP>:<port>)
#   BUCKETBOOK_NEW   1 to start a new, empty install even though this machine has
#                    data from an earlier one (that data is left alone)
set -eu

SOURCE="${BUCKETBOOK_SOURCE:-https://raw.githubusercontent.com/cbik6/bucketbook/main}"
DIR="${BUCKETBOOK_DIR:-bucketbook}"
PORT="${BUCKETBOOK_PORT:-}"
PROJECT="${COMPOSE_PROJECT_NAME:-bucketbook}"

say() { printf '%s\n' "$*"; }
fail() {
  say "Bucketbook install stopped: $*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail "Docker isn't installed. Get it from https://docs.docker.com/get-docker/ and run this again."
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is needed (the 'docker compose' command). Update Docker and run this again."
docker info >/dev/null 2>&1 || fail "Docker isn't running, or this user can't use it. Start Docker (or add yourself to the docker group) and run this again."

if [ -f "$DIR/.env" ]; then
  say "Bucketbook is already installed in $DIR."
  if grep -q '^DATA_DIR=' "$DIR/.env"; then
    say "To update it, run these in $DIR:"
    say "  curl -fsSLO $SOURCE/docker-compose.yml"
    say "  docker compose pull"
    say "  docker compose up -d"
  else
    say "It keeps its data in Docker volumes (version 1.0.1 or earlier). To update it and move the"
    say "data into the folder, where folder backups pick it up, run this in $DIR:"
    say "  curl -fsSL $SOURCE/scripts/move-data.sh | sh"
    say "It backs up first and keeps your data; don't delete $DIR or its Docker volumes."
  fi
  exit 0
fi

# Bucketbook already installed somewhere else on this machine? A second install under
# the same name would take over its containers, so point to the update steps instead.
existing=$(docker ps -a --filter "label=com.docker.compose.project=$PROJECT" \
  --format '{{.Label "com.docker.compose.project.working_dir"}}' 2>/dev/null | head -n 1)
if [ -n "$existing" ] && [ "${BUCKETBOOK_NEW:-}" != 1 ]; then
  say "Bucketbook is already installed on this machine, in $existing"
  say "To update it and keep your books, go to that folder:"
  say "  cd \"$existing\""
  say "and follow \"Updating without losing data\" in the README:"
  say "  https://github.com/cbik6/bucketbook#updating-without-losing-data"
  exit 0
fi
# Data from an earlier install (1.0.1 or earlier kept it in Docker volumes).
if docker volume inspect "${PROJECT}_pgdata" >/dev/null 2>&1 && [ "${BUCKETBOOK_NEW:-}" != 1 ]; then
  say "This machine has books from an earlier Bucketbook install (the Docker volume ${PROJECT}_pgdata)."
  say "To keep them, update that install instead: in its folder (the one with its .env), run"
  say "  curl -fsSL $SOURCE/scripts/move-data.sh | sh"
  say "To start a new, empty install anyway (the old data is left alone), run this again"
  say "with BUCKETBOOK_NEW=1 in front of sh."
  exit 0
fi

fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$2" "$1"
  else
    fail "curl or wget is needed to download the files."
  fi
}

# 32 random bytes as base64, and 24 as hex (safe inside a database URL).
secret_base64() { head -c 32 /dev/urandom | base64 | tr -d '\n'; }
secret_hex() { head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'; }

this_ip() {
  ip=""
  if command -v hostname >/dev/null 2>&1; then
    ip=$(hostname -I 2>/dev/null | awk '{print $1}') || ip=""
  fi
  if [ -z "$ip" ] && command -v ipconfig >/dev/null 2>&1; then
    ip=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
  fi
  printf '%s' "${ip:-localhost}"
}

this_timezone() {
  tz=""
  if [ -f /etc/timezone ]; then
    tz=$(cat /etc/timezone)
  elif [ -L /etc/localtime ]; then
    tz=$(readlink /etc/localtime | sed 's|.*/zoneinfo/||')
  fi
  case "$tz" in
    */* | UTC) printf '%s' "$tz" ;;
    *) printf 'UTC' ;;
  esac
}

# Whether something on this machine already listens on a port, including
# another Docker container that publishes it.
port_busy() {
  if docker ps --format '{{.Ports}}' 2>/dev/null | grep -q ":$1->"; then
    return 0
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -Hltn 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]$1\$"
  elif command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  elif command -v netstat >/dev/null 2>&1; then
    netstat -an 2>/dev/null | grep -i listen | grep -Eq "[:.]$1[[:space:]]"
  else
    return 1
  fi
}

if [ -n "$PORT" ]; then
  if port_busy "$PORT"; then
    fail "port $PORT is already in use on this machine. Pick another, for example BUCKETBOOK_PORT=$((PORT + 1)), or leave BUCKETBOOK_PORT out to have one chosen."
  fi
else
  PORT=9951
  while port_busy "$PORT"; do
    PORT=$((PORT + 1))
    [ "$PORT" -le 9999 ] || fail "ports 9951 to 9999 are all in use. Choose one with BUCKETBOOK_PORT=<port>."
  done
  [ "$PORT" = 9951 ] || say "Port 9951 is in use on this machine, so Bucketbook will use port $PORT."
fi

URL="${BUCKETBOOK_URL:-http://$(this_ip):$PORT}"

say "Installing Bucketbook into $(pwd)/$DIR"
mkdir -p "$DIR"
cd "$DIR"
fetch "$SOURCE/docker-compose.yml" docker-compose.yml
fetch "$SOURCE/.env.example" .env.example

# The database, receipts and nightly backups live here. The containers make the
# files inside belong to their own users on first start.
mkdir -p data/postgres data/receipts backups

umask 077
sed \
  -e "s|^APP_URL=.*|APP_URL=$URL|" \
  -e "s|^APP_PORT=.*|APP_PORT=$PORT|" \
  -e "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=$(secret_base64)|" \
  -e "s|^APP_ENCRYPTION_KEY=.*|APP_ENCRYPTION_KEY=$(secret_base64)|" \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(secret_hex)|" \
  -e "s|^TZ=.*|TZ=$(this_timezone)|" \
  -e "s|^DATA_DIR=.*|DATA_DIR=./data|" \
  .env.example >.env

say "Downloading Bucketbook..."
# Always get the current images: an older copy may already be on this machine
# under the same tag, from an earlier install.
if [ "${BUCKETBOOK_SKIP_PULL:-}" != 1 ]; then
  docker compose pull --quiet || fail "couldn't download the images. Check the internet connection and run this again."
fi
say "Starting Bucketbook..."
docker compose up -d --wait --wait-timeout 300

say ""
say "Bucketbook is running. Open $URL to create your login and first book."
say ""
say "Your settings and secrets are in $(pwd)/.env. Keep a copy somewhere safe."
say "The database is copied every night at 02:00 into $(pwd)/backups."
say "Back up the whole $(pwd) folder to keep everything."
say "If you'll open it by another address (a domain name, say), change APP_URL"
say "in .env, then run:  cd $(pwd) && docker compose up -d"
