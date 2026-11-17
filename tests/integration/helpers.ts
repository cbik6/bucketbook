import { afterAll, beforeEach } from "vitest";
import { getDb, getPool } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { truncateAll } from "./test-db";

/** Fresh tables before each test; close the pool after the file. */
export function setupCleanDatabase() {
  beforeEach(async () => {
    await truncateAll(getPool());
  });
  afterAll(async () => {
    await getPool().end();
  });
}

let counter = 0;

/** Inserts a user row directly (no password), for service-level tests. */
export async function makeUser(name = "Test User") {
  counter += 1;
  const [row] = await getDb()
    .insert(users)
    .values({ name, email: `user${counter}-${Date.now()}@example.test` })
    .returning();
  return row!;
}
