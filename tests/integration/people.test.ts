import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getAuth } from "@/server/auth/auth";
import { createBook, listBooksForUser, renameBook } from "@/server/books/service";
import { getDb } from "@/server/db/client";
import { bookMembers, invitations, users } from "@/server/db/schema";
import { inviteContext } from "@/server/people/invite-context";
import {
  createInvite,
  findInvite,
  listPeople,
  removePerson,
  revokeInvite,
  setPersonAccess,
  setPersonAdmin,
} from "@/server/people/service";
import { listConnections } from "@/server/simplefin/service";
import { makeUser, setupCleanDatabase } from "./helpers";

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
  };
}

/** Accepts an invitation the way the invite page does. */
async function accept(token: string, password = "a long enough password") {
  const invite = await findInvite(getDb(), token);
  if (!invite) throw new Error("invite not found");
  await inviteContext.run({ inviteId: invite.id, email: invite.email }, () =>
    getAuth().api.signUpEmail({ body: { name: invite.name, email: invite.email, password } }),
  );
  const [u] = await getDb().select().from(users).where(eq(users.email, invite.email));
  return u!;
}

async function setup() {
  const admin = await makeUser("Admin");
  const actor = { userId: admin.id };
  const { book: family } = await createBook(getDb(), actor, {
    name: "Family",
    template: "household",
    startDate: "2026-11-17",
  });
  const { book: shop } = await createBook(getDb(), actor, {
    name: "Shop",
    template: "blank",
    startDate: "2026-11-17",
  });
  return { admin, actor, family, shop };
}

describe("people and invitations", () => {
  it("makes the first login an admin", async () => {
    const res = await post("/sign-up/email", {
      name: "Owner",
      email: "owner@example.test",
      password: "a long enough password",
    });
    expect(res.status).toBe(200);
    const [u] = await getDb().select().from(users);
    expect(u!.isAdmin).toBe(true);
  });

  it("invites someone with a role in each book, and the link works once", async () => {
    const { actor, family, shop } = await setup();
    const { token, invite } = await createInvite(getDb(), actor, {
      name: "Sam",
      email: "Sam@Example.test",
      access: [
        { bookId: family.id, role: "viewer" },
        { bookId: shop.id, role: "editor" },
      ],
    });
    expect(invite.email).toBe("sam@example.test");
    // Only a hash of the token is stored.
    const [row] = await getDb().select().from(invitations);
    expect(row!.tokenHash).not.toContain(token);

    const sam = await accept(token);
    expect(sam.isAdmin).toBe(false);
    const books = await listBooksForUser(getDb(), sam.id);
    expect(Object.fromEntries(books.map((b) => [b.name, b.role]))).toEqual({
      Family: "viewer",
      Shop: "editor",
    });
    expect(await findInvite(getDb(), token)).toBeNull();

    // A viewer can't change the book or see its bank connections.
    await expect(renameBook(getDb(), { userId: sam.id }, family.id, "Mine")).rejects.toThrow();
    expect(await listConnections(getDb(), sam.id, family.id)).toEqual([]);
    await expect(listPeople(getDb(), { userId: sam.id })).rejects.toThrow(/admin/);
  });

  it("refuses sign-up without an invitation, even for an invited email", async () => {
    const { actor, family } = await setup();
    await createInvite(getDb(), actor, {
      name: "Sam",
      email: "sam@example.test",
      access: [{ bookId: family.id, role: "editor" }],
    });
    const res = await post("/sign-up/email", {
      name: "Sam",
      email: "sam@example.test",
      password: "a long enough password",
    });
    expect(res.status).toBe(403);
    expect(await getDb().select().from(users).where(eq(users.email, "sam@example.test"))).toEqual(
      [],
    );
  });

  it("stops withdrawn and replaced links", async () => {
    const { actor, family } = await setup();
    const first = await createInvite(getDb(), actor, {
      name: "Sam",
      email: "sam@example.test",
      access: [{ bookId: family.id, role: "viewer" }],
    });
    const second = await createInvite(getDb(), actor, {
      name: "Sam",
      email: "sam@example.test",
      access: [{ bookId: family.id, role: "editor" }],
    });
    expect(await findInvite(getDb(), first.token)).toBeNull();
    await revokeInvite(getDb(), actor, second.invite.id);
    expect(await findInvite(getDb(), second.token)).toBeNull();
  });

  it("changes access but never leaves a book without an owner", async () => {
    const { admin, actor, family, shop } = await setup();
    const { token } = await createInvite(getDb(), actor, {
      name: "Sam",
      email: "sam@example.test",
      access: [{ bookId: family.id, role: "viewer" }],
    });
    const sam = await accept(token);
    await setPersonAccess(getDb(), actor, sam.id, [{ bookId: shop.id, role: "owner" }]);
    const rows = await getDb().select().from(bookMembers).where(eq(bookMembers.userId, sam.id));
    expect(rows.map((r) => [r.bookId, r.role])).toEqual([[shop.id, "owner"]]);

    // The admin is Family's only owner.
    await expect(setPersonAccess(getDb(), actor, admin.id, [])).rejects.toThrow(/Family/);
    // Shop has two owners now, so the admin can step down there.
    await setPersonAccess(getDb(), actor, admin.id, [{ bookId: family.id, role: "owner" }]);
  });

  it("removes people, keeping at least one admin and one owner per book", async () => {
    const { admin, actor, family } = await setup();
    const { token } = await createInvite(getDb(), actor, {
      name: "Sam",
      email: "sam@example.test",
      access: [{ bookId: family.id, role: "editor" }],
    });
    const sam = await accept(token);
    await expect(removePerson(getDb(), actor, admin.id)).rejects.toThrow(/yourself/);
    await expect(setPersonAdmin(getDb(), actor, admin.id, false)).rejects.toThrow(/one admin/);

    await setPersonAdmin(getDb(), actor, sam.id, true);
    // Sam can't remove the admin while they're Family's only owner.
    await expect(removePerson(getDb(), { userId: sam.id }, admin.id)).rejects.toThrow(/only owner/);

    await removePerson(getDb(), actor, sam.id);
    expect(await getDb().select().from(users).where(eq(users.id, sam.id))).toEqual([]);
    expect(await getDb().select().from(bookMembers).where(eq(bookMembers.userId, sam.id))).toEqual(
      [],
    );
  });

  it("lets only admins invite", async () => {
    const { family } = await setup();
    const member = await makeUser("Member", false);
    await expect(
      createInvite(
        getDb(),
        { userId: member.id },
        {
          name: "X",
          email: "x@example.test",
          access: [{ bookId: family.id, role: "owner" }],
        },
      ),
    ).rejects.toThrow(/admin/);
  });
});
