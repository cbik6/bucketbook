import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://bucketbook:bucketbook@localhost:5433/bucketbook",
  },
  strict: true,
  verbose: true,
});
