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

/**
 * Books start without bank or card accounts; tests that need them add the
 * usual ones (Checking, Savings, Credit Card, or the business versions).
 */
export async function addMoneyAccounts(
  actor: { userId: string },
  bookId: string,
  kind: "household" | "small_business" = "household",
) {
  const { createAccount } = await import("@/server/accounts/service");
  const list =
    kind === "household"
      ? [
          { name: "Checking", type: "asset", subtype: "checking" },
          { name: "Savings", type: "asset", subtype: "savings" },
          { name: "Credit Card", type: "liability", subtype: "credit_card" },
        ]
      : [
          { name: "Business Checking", type: "asset", subtype: "checking", code: "1010" },
          { name: "Business Savings", type: "asset", subtype: "savings", code: "1020" },
          { name: "Business Credit Card", type: "liability", subtype: "credit_card", code: "2010" },
        ];
  for (const a of list) await createAccount(getDb(), actor, bookId, a);
}
