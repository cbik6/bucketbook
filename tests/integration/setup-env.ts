import { randomBytes } from "node:crypto";
import { TEST_DATABASE_URL } from "./test-db";

// Test-only configuration. Generated fresh each run; nothing real.
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.APP_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("base64");
process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.DB_POOL_MAX = "3";
process.env.JOBS_ENABLED = "false";
