import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { BOOK_ROLES, type BookRole } from "@/lib/account-types";
import { recordAudit } from "../audit/record";
import type { Database, DbOrTx } from "../db/client";
import { bookMembers, books, invitations, users, type InviteAccess } from "../db/schema";
import { ForbiddenError, NotFoundError, UserFacingError } from "../errors";

type Actor = { userId: string };

/** How long an invitation link works. */
export const INVITE_DAYS = 7;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Throws unless the user is an admin. */
export async function requireAdmin(db: DbOrTx, userId: string) {
  const [u] = await db
    .select({ id: users.id, isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, userId));
  if (!u?.isAdmin) throw new ForbiddenError("Only an admin can do that.");
  return u;
}

export async function isAdmin(db: DbOrTx, userId: string): Promise<boolean> {
  const [u] = await db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, userId));
  return Boolean(u?.isAdmin);
}

const accessSchema = z
  .array(z.object({ bookId: z.uuid(), role: z.enum(BOOK_ROLES) }))
  .max(200)
  .refine((a) => new Set(a.map((x) => x.bookId)).size === a.length, "Each book once.");

const inviteSchema = z.object({
  name: z.string().trim().min(1, "Enter their name.").max(100, "Keep the name under 100."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email({ message: "Enter a valid email address." })),
  access: accessSchema,
});

function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const r = schema.safeParse(raw);
  if (!r.success) {
    const issue = r.error.issues[0]!;
    throw new UserFacingError(issue.message, String(issue.path[0] ?? ""));
  }
  return r.data;
}

async function assertBooksExist(db: DbOrTx, access: InviteAccess) {
  if (access.length === 0) return;
  const ids = access.map((a) => a.bookId);
  const found = await db.select({ id: books.id }).from(books).where(inArray(books.id, ids));
  if (found.length !== ids.length) throw new NotFoundError("One of those books");
}

export type PersonView = {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  createdAt: Date;
  access: { bookId: string; bookName: string; role: BookRole }[];
};

export type InviteView = {
  id: string;
  name: string;
  email: string;
  expiresAt: Date;
  expired: boolean;
  access: { bookId: string; bookName: string; role: BookRole }[];
};

/** Everyone with a login, their book access, and invitations still open. Admin only. */
export async function listPeople(db: DbOrTx, actor: Actor) {
  await requireAdmin(db, actor.userId);
  const [people, members, allBooks, invites] = await Promise.all([
    db.select().from(users).orderBy(asc(users.createdAt)),
    db.select().from(bookMembers),
    db
      .select({ id: books.id, name: books.name, archivedAt: books.archivedAt })
      .from(books)
      .orderBy(asc(books.createdAt)),
    db
      .select()
      .from(invitations)
      .where(and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
      .orderBy(asc(invitations.createdAt)),
  ]);
  const bookName = new Map(allBooks.map((b) => [b.id, b.name]));
  const now = Date.now();
  return {
    books: allBooks,
    people: people.map((u): PersonView => ({
      id: u.id,
      name: u.name,
      email: u.email,
      isAdmin: u.isAdmin,
      createdAt: u.createdAt,
      access: members
        .filter((m) => m.userId === u.id)
        .map((m) => ({
          bookId: m.bookId,
          bookName: bookName.get(m.bookId) ?? "Book",
          role: m.role as BookRole,
        })),
    })),
    invites: invites.map((i): InviteView => ({
      id: i.id,
      name: i.name,
      email: i.email,
      expiresAt: i.expiresAt,
      expired: i.expiresAt.getTime() <= now,
      access: i.access.map((a) => ({ ...a, bookName: bookName.get(a.bookId) ?? "Book" })),
    })),
  };
}

/**
 * Creates an invitation and returns the one-time token for its link. The token
 * is shown once; only its hash is kept. An open invitation for the same email
 * is replaced.
 */
export async function createInvite(db: Database, actor: Actor, raw: unknown) {
  const input = parse(inviteSchema, raw);
  return db.transaction(async (tx) => {
    await requireAdmin(tx, actor.userId);
    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(sql`lower(${users.email})`, input.email));
    if (existing) {
      throw new UserFacingError(
        "Someone with that email already has a login. Change their access in the list instead.",
        "email",
      );
    }
    await assertBooksExist(tx, input.access);
    await tx
      .update(invitations)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(invitations.email, input.email),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
        ),
      );
    const token = randomBytes(32).toString("base64url");
    const [invite] = await tx
      .insert(invitations)
      .values({
        tokenHash: hashToken(token),
        name: input.name,
        email: input.email,
        access: input.access,
        invitedBy: actor.userId,
        expiresAt: new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000),
      })
      .returning();
    await recordAudit(tx, {
      userId: actor.userId,
      entityType: "invitation",
      entityId: invite!.id,
      action: "create",
      after: { name: invite!.name, email: invite!.email, access: invite!.access },
    });
    return { invite: invite!, token };
  });
}

/** A fresh link for an open invitation (the old link stops working). */
export async function renewInvite(db: Database, actor: Actor, inviteId: string) {
  if (!z.uuid().safeParse(inviteId).success) throw new NotFoundError("That invitation");
  return db.transaction(async (tx) => {
    await requireAdmin(tx, actor.userId);
    const token = randomBytes(32).toString("base64url");
    const [invite] = await tx
      .update(invitations)
      .set({
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000),
      })
      .where(
        and(
          eq(invitations.id, inviteId),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
        ),
      )
      .returning();
    if (!invite) throw new NotFoundError("That invitation");
    await recordAudit(tx, {
      userId: actor.userId,
      entityType: "invitation",
      entityId: inviteId,
      action: "update",
      after: { renewed: true, expiresAt: invite.expiresAt },
    });
    return { invite, token };
  });
}

export async function revokeInvite(db: Database, actor: Actor, inviteId: string) {
  if (!z.uuid().safeParse(inviteId).success) throw new NotFoundError("That invitation");
  await db.transaction(async (tx) => {
    await requireAdmin(tx, actor.userId);
    const [row] = await tx
      .update(invitations)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(invitations.id, inviteId),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
        ),
      )
      .returning();
    if (!row) throw new NotFoundError("That invitation");
    await recordAudit(tx, {
      userId: actor.userId,
      entityType: "invitation",
      entityId: inviteId,
      action: "delete",
      before: { name: row.name, email: row.email },
    });
  });
}

/** The open, unexpired invitation behind a link, or null. */
export async function findInvite(db: DbOrTx, token: string) {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) return null;
  const [invite] = await db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.tokenHash, hashToken(token)),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    );
  return invite ?? null;
}

/**
 * Called from the sign-up hook once the invited person's login exists: marks
 * the invitation used and gives them the books it named.
 */
export async function completeInvite(db: Database, inviteId: string, userId: string) {
  await db.transaction(async (tx) => {
    const [invite] = await tx
      .update(invitations)
      .set({ acceptedAt: new Date(), acceptedUserId: userId })
      .where(
        and(
          eq(invitations.id, inviteId),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
        ),
      )
      .returning();
    if (!invite) throw new UserFacingError("That invitation was already used or withdrawn.");
    const existing = await tx.select({ id: books.id }).from(books);
    const ids = new Set(existing.map((b) => b.id));
    const rows = invite.access
      .filter((a) => ids.has(a.bookId))
      .map((a) => ({ bookId: a.bookId, userId, role: a.role }));
    if (rows.length) await tx.insert(bookMembers).values(rows).onConflictDoNothing();
    await recordAudit(tx, {
      userId,
      entityType: "invitation",
      entityId: inviteId,
      action: "update",
      after: { accepted: true, access: rows.map((r) => ({ bookId: r.bookId, role: r.role })) },
    });
  });
}

/** Books whose only owner is this person (they can't be left without one). */
async function soleOwnerBooks(db: DbOrTx, userId: string, keep: Set<string> = new Set()) {
  const owned = await db
    .select({ bookId: bookMembers.bookId, name: books.name })
    .from(bookMembers)
    .innerJoin(books, eq(books.id, bookMembers.bookId))
    .where(and(eq(bookMembers.userId, userId), eq(bookMembers.role, "owner")));
  const result: string[] = [];
  for (const b of owned) {
    if (keep.has(b.bookId)) continue;
    const [other] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(bookMembers)
      .where(
        and(
          eq(bookMembers.bookId, b.bookId),
          eq(bookMembers.role, "owner"),
          ne(bookMembers.userId, userId),
        ),
      );
    if ((other?.n ?? 0) === 0) result.push(b.name);
  }
  return result;
}

/**
 * Replaces a person's book access with the list given (books left out lose
 * access). Every book keeps at least one owner.
 */
export async function setPersonAccess(db: Database, actor: Actor, userId: string, raw: unknown) {
  if (!z.uuid().safeParse(userId).success) throw new NotFoundError("That person");
  const access = parse(accessSchema, raw);
  await db.transaction(async (tx) => {
    await requireAdmin(tx, actor.userId);
    // One change to the membership table at a time keeps the owner check honest.
    await tx.execute(sql`lock table ${bookMembers} in share row exclusive mode`);
    const [person] = await tx.select().from(users).where(eq(users.id, userId));
    if (!person) throw new NotFoundError("That person");
    await assertBooksExist(tx, access);
    const stillOwns = new Set(access.filter((a) => a.role === "owner").map((a) => a.bookId));
    const orphaned = await soleOwnerBooks(tx, userId, stillOwns);
    if (orphaned.length) {
      throw new UserFacingError(
        `${orphaned.join(", ")} would have no owner. Make someone else an owner first.`,
      );
    }
    const before = await tx.select().from(bookMembers).where(eq(bookMembers.userId, userId));
    await tx.delete(bookMembers).where(eq(bookMembers.userId, userId));
    if (access.length) {
      await tx
        .insert(bookMembers)
        .values(access.map((a) => ({ bookId: a.bookId, userId, role: a.role })));
    }
    await recordAudit(tx, {
      userId: actor.userId,
      entityType: "user",
      entityId: userId,
      action: "update",
      before: { access: before.map((m) => ({ bookId: m.bookId, role: m.role })) },
      after: { access },
    });
  });
}

/** Makes someone an admin or not. There is always at least one admin. */
export async function setPersonAdmin(db: Database, actor: Actor, userId: string, admin: boolean) {
  if (!z.uuid().safeParse(userId).success) throw new NotFoundError("That person");
  await db.transaction(async (tx) => {
    await requireAdmin(tx, actor.userId);
    await tx.execute(sql`lock table ${users} in share row exclusive mode`);
    const [person] = await tx.select().from(users).where(eq(users.id, userId));
    if (!person) throw new NotFoundError("That person");
    if (person.isAdmin === admin) return;
    if (!admin) {
      const [others] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(users)
        .where(and(eq(users.isAdmin, true), ne(users.id, userId)));
      if ((others?.n ?? 0) === 0) throw new UserFacingError("There has to be at least one admin.");
    }
    await tx.update(users).set({ isAdmin: admin }).where(eq(users.id, userId));
    await recordAudit(tx, {
      userId: actor.userId,
      entityType: "user",
      entityId: userId,
      action: "update",
      before: { isAdmin: person.isAdmin },
      after: { isAdmin: admin },
    });
  });
}

/**
 * Removes a person's login and their access to every book. Their past work
 * stays in the books (entries keep their history; the name is no longer linked).
 */
export async function removePerson(db: Database, actor: Actor, userId: string) {
  if (!z.uuid().safeParse(userId).success) throw new NotFoundError("That person");
  if (userId === actor.userId) throw new UserFacingError("You can't remove yourself.");
  await db.transaction(async (tx) => {
    await requireAdmin(tx, actor.userId);
    await tx.execute(sql`lock table ${bookMembers} in share row exclusive mode`);
    const [person] = await tx.select().from(users).where(eq(users.id, userId));
    if (!person) throw new NotFoundError("That person");
    const orphaned = await soleOwnerBooks(tx, userId);
    if (orphaned.length) {
      throw new UserFacingError(
        `${person.name} is the only owner of ${orphaned.join(", ")}. Make someone else an owner first.`,
      );
    }
    if (person.isAdmin) {
      const [others] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(users)
        .where(and(eq(users.isAdmin, true), ne(users.id, userId)));
      if ((others?.n ?? 0) === 0) throw new UserFacingError("There has to be at least one admin.");
    }
    await tx.delete(users).where(eq(users.id, userId));
    await recordAudit(tx, {
      userId: actor.userId,
      entityType: "user",
      entityId: userId,
      action: "delete",
      before: { name: person.name, email: person.email },
    });
  });
}
