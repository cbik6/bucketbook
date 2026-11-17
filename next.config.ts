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
