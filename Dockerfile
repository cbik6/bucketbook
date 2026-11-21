# syntax=docker/dockerfile:1

# ---- 1. Install dependencies (cached until package files change) ----
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- 2. Build the Next.js app ----
FROM node:24-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--max-old-space-size=1536
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- 3. Small runtime image: only the standalone server and migrations ----
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=9951 \
    HOSTNAME=0.0.0.0 \
    RECEIPTS_DIR=/data/receipts

RUN addgroup -S -g 1001 app \
 && adduser -S -u 1001 -G app app \
 && mkdir -p /data/receipts \
 && chown -R app:app /data

COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/drizzle ./drizzle

USER app
EXPOSE 9951

# Healthy once migrations ran and the database answers.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/health > /dev/null || exit 1

# Startup (in instrumentation.ts) validates config and runs migrations first.
CMD ["node", "server.js"]
