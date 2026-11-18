import type { NextConfig } from "next";

// Extra origins allowed to load dev-server assets (for example the VM's LAN IP).
// Only used by `next dev`; production ignores it.
const devOrigins = (process.env.DEV_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  // Produces a self-contained server in .next/standalone for the Docker image.
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  // Database drivers and the job queue run as plain Node modules, not bundled.
  serverExternalPackages: ["pg", "pg-boss"],
  // SQL migrations are read from disk at startup, so ship them with the server.
  outputFileTracingIncludes: {
    "/**": ["./drizzle/**/*"],
  },
  allowedDevOrigins: devOrigins,
  poweredByHeader: false,
  async headers() {
    return [
      {
        // The service worker must always be fresh and only run our own code.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
  experimental: {
    serverActions: {
      // Receipts can be up to 10 MB each (see attachments-service.ts), plus form overhead.
      bodySizeLimit: "11mb",
    },
  },
  devIndicators: { position: "bottom-right" },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
