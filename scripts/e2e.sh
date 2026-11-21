#!/usr/bin/env bash
# Runs the Playwright tests against a throwaway install built from this repo.
#
#   npm run test:e2e
#
# 1. Starts a separate compose project (bucketbook-e2e) on port 3100 with fresh,
#    random secrets and its data and backups in a temporary folder.
# 2. Runs Playwright inside Microsoft's Playwright image, so no browser or system
#    libraries are needed on this machine.
# 3. Checks the nightly backup and a full restore (scripts/backup-test.sh) on the
#    data the browser tests created.
# 4. Tears everything down, the temporary folder included.
#
# Set E2E_SKIP_BUILD=1 to reuse an already built bucketbook:local image.
set -euo pipefail
cd "$(dirname "$0")/.."
# Test the image built from this folder, not the published one.
export COMPOSE_FILE=docker-compose.yml:docker-compose.build.yml

PLAYWRIGHT_VERSION=$(node -p "require('@playwright/test/package.json').version")
PORT=${E2E_PORT:-3100}
ENV_FILE=$(mktemp)
# Never ./data: a real install may run from this folder.
DATA_ROOT=$(mktemp -d)
cleanup() {
  docker compose -p bucketbook-e2e --env-file "$ENV_FILE" down -v --remove-orphans >/dev/null 2>&1 || true
  # The containers' users own the files, so remove them from a container.
  docker run --rm -v "$DATA_ROOT:/x" --entrypoint sh postgres:18-alpine \
    -c 'rm -rf /x/* /x/.[!.]*' >/dev/null 2>&1 || true
  rm -rf "$DATA_ROOT" "$ENV_FILE"
}
trap cleanup EXIT
mkdir -p "$DATA_ROOT/data/postgres" "$DATA_ROOT/data/receipts" "$DATA_ROOT/backups"

cat > "$ENV_FILE" <<EOF
APP_URL=http://localhost:${PORT}
APP_PORT=${PORT}
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
APP_ENCRYPTION_KEY=$(openssl rand -base64 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)
JOBS_ENABLED=true
DATA_DIR=${DATA_ROOT}/data
BACKUP_DIR=${DATA_ROOT}/backups
BACKUP_TIME=00:00
BACKUP_KEEP_DAYS=3
EOF

if [[ "${E2E_SKIP_BUILD:-0}" != "1" ]]; then
  docker compose -p bucketbook-e2e --env-file "$ENV_FILE" build
fi
echo "Starting a fresh install on port ${PORT}..."
docker compose -p bucketbook-e2e --env-file "$ENV_FILE" up -d --wait --wait-timeout 180

docker run --rm --network host --ipc host \
  --user "$(id -u):$(id -g)" -e HOME=/tmp -e CI=1 \
  -e E2E_BASE_URL="http://localhost:${PORT}" \
  -v "$PWD:/work" -w /work \
  "mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble" \
  npx playwright test "$@"

# The full run also checks backups and restore on the data the tests left behind.
if [[ $# -eq 0 ]]; then
  bash scripts/backup-test.sh bucketbook-e2e "$ENV_FILE" "$DATA_ROOT/backups" "$PORT"
fi
