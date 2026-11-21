import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getAuth } from "@/server/auth/auth";
import { createBook } from "@/server/books/service";
import { getDb } from "@/server/db/client";
import { auditLog, authAccounts, users } from "@/server/db/schema";
import { getSetupState, markSetupComplete } from "@/server/setup/service";
import { setupCleanDatabase } from "./helpers";

setupCleanDatabase();

/** Calls Better Auth over HTTP, the same way the browser does. */
async function post(path: string, body: unknown) {
  const res = await getAuth().handler(
    new Request(`http://localhost:9951/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:9951" },
      body: JSON.stringify(body),
    }),
  );
  return {
    status: res.status,
    body: (await res.json().catch(() => null)) as Record<string, unknown> | null,
    res,
  };
}

describe("first-run setup", () => {
  it("walks from empty install to completed setup", async () => {
    expect(await getSetupState(getDb())).toEqual({
      hasUser: false,
      hasBook: false,
      completed: false,
    });

    const signUp = await post("/sign-up/email", {
      name: "Owner",
      email: "owner@example.test",
      password: "a long enough password",
    });
    expect(signUp.status).toBe(200);
    expect(signUp.res.headers.get("set-cookie")).toMatch(/session_token/);
    expect(await getSetupState(getDb())).toMatchObject({ hasUser: true, hasBook: false });

    const [owner] = await getDb().select().from(users);
    // Passwords are stored hashed, never in plain text.
    const [login] = await getDb()
      .select()
      .from(authAccounts)
      .where(eq(authAccounts.userId, owner!.id));
    expect(login!.password).toBeTruthy();
    expect(login!.password).not.toContain("a long enough password");

    await createBook(
      getDb(),
      { userId: owner!.id },
      { name: "Family", template: "household", startDate: "2026-01-01" },
    );
    expect(await getSetupState(getDb())).toMatchObject({ hasBook: true, completed: false });

    await markSetupComplete(getDb(), owner!.id);
    expect((await getSetupState(getDb())).completed).toBe(true);

    const audits = await getDb().select().from(auditLog).where(eq(auditLog.userId, owner!.id));
    expect(audits.some((a) => a.entityType === "user" && a.action === "create")).toBe(true);
    expect(audits.some((a) => a.entityType === "app" && a.action === "setup")).toBe(true);
    // The audit log never contains the password.
    expect(JSON.stringify(audits)).not.toContain("a long enough password");
  });

  it("closes sign-up once the owner exists", async () => {
    const first = await post("/sign-up/email", {
      name: "Owner",
      email: "owner@example.test",
      password: "a long enough password",
    });
    expect(first.status).toBe(200);
    const second = await post("/sign-up/email", {
      name: "Intruder",
      email: "intruder@example.test",
      password: "another long password",
    });
    expect(second.status).toBe(403);
    expect(String(second.body?.message)).toMatch(/Sign-up is closed/);
    expect(await getDb().select().from(users)).toHaveLength(1);
  });

  it("signs in with the right password only", async () => {
    await post("/sign-up/email", {
      name: "Owner",
      email: "owner@example.test",
      password: "a long enough password",
    });
    const ok = await post("/sign-in/email", {
      email: "owner@example.test",
      password: "a long enough password",
    });
    expect(ok.status).toBe(200);
    const bad = await post("/sign-in/email", {
      email: "owner@example.test",
      password: "wrong password!!",
    });
    expect(bad.status).toBe(401);
  });

  it("rejects short passwords", async () => {
    const res = await post("/sign-up/email", {
      name: "Owner",
      email: "owner@example.test",
      password: "short",
    });
    expect(res.status).toBe(400);
  });
});
