#!/usr/bin/env bash
# Runs the Playwright tests against a throwaway install built from this repo.
#
#   npm run test:e2e
#
# 1. Starts a separate compose project (bucketbook-e2e) on port 3100 with fresh,
#    random secrets and empty volumes.
# 2. Runs Playwright inside Microsoft's Playwright image, so no browser or system
#    libraries are needed on this machine.
# 3. Tears everything down, volumes included.
#
# Set E2E_SKIP_BUILD=1 to reuse an already built bucketbook:local image.
set -euo pipefail
cd "$(dirname "$0")/.."

PLAYWRIGHT_VERSION=$(node -p "require('@playwright/test/package.json').version")
PORT=${E2E_PORT:-3100}
ENV_FILE=$(mktemp)
trap 'docker compose -p bucketbook-e2e --env-file "$ENV_FILE" down -v --remove-orphans >/dev/null 2>&1 || true; rm -f "$ENV_FILE"' EXIT

cat > "$ENV_FILE" <<EOF
APP_URL=http://localhost:${PORT}
APP_PORT=${PORT}
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
APP_ENCRYPTION_KEY=$(openssl rand -base64 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)
JOBS_ENABLED=true
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
