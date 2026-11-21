#!/bin/sh
# Installs Bucketbook with Docker.
#
#   curl -fsSL https://raw.githubusercontent.com/cbik6/bucketbook/main/install.sh | sh
#
# Makes a "bucketbook" folder where you run it, downloads docker-compose.yml and
# .env.example into it, writes a .env with fresh secrets, and starts the app and
# its database. In Docker they show up together as "bucketbook".
#
# Optional settings, for example `curl ... | BUCKETBOOK_PORT=8080 sh`:
#   BUCKETBOOK_DIR   folder to install into (default: bucketbook)
#   BUCKETBOOK_PORT  port on this machine (default: 9951)
#   BUCKETBOOK_URL   address people will type (default: http://<this machine's IP>:<port>)
set -eu

SOURCE="${BUCKETBOOK_SOURCE:-https://raw.githubusercontent.com/cbik6/bucketbook/main}"
DIR="${BUCKETBOOK_DIR:-bucketbook}"
PORT="${BUCKETBOOK_PORT:-9951}"

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
  say "To update it:  cd $DIR && docker compose pull && docker compose up -d"
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

URL="${BUCKETBOOK_URL:-http://$(this_ip):$PORT}"

say "Installing Bucketbook into $(pwd)/$DIR"
mkdir -p "$DIR"
cd "$DIR"
fetch "$SOURCE/docker-compose.yml" docker-compose.yml
fetch "$SOURCE/.env.example" .env.example

umask 077
sed \
  -e "s|^APP_URL=.*|APP_URL=$URL|" \
  -e "s|^APP_PORT=.*|APP_PORT=$PORT|" \
  -e "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=$(secret_base64)|" \
  -e "s|^APP_ENCRYPTION_KEY=.*|APP_ENCRYPTION_KEY=$(secret_base64)|" \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(secret_hex)|" \
  -e "s|^TZ=.*|TZ=$(this_timezone)|" \
  .env.example >.env

say "Starting Bucketbook (the first start downloads the images)..."
docker compose up -d --wait --wait-timeout 300

say ""
say "Bucketbook is running. Open $URL to create your login and first book."
say ""
say "Your settings and secrets are in $(pwd)/.env. Keep a copy somewhere safe."
say "If you'll open it by another address (a domain name, say), change APP_URL"
say "in .env, then run:  cd $(pwd) && docker compose up -d"
