import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "../audit/record";
import type { Database, DbOrTx } from "../db/client";
import { attachments, bankTransactions, journalEntries } from "../db/schema";
import { getEnv } from "../env";
import { NotFoundError, UserFacingError } from "../errors";

type Actor = { userId: string };

/** Receipts are photos or PDFs; 10 MB covers a phone photo with room to spare. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_ITEM = 20;

/**
 * Allowed types, identified by the file's first bytes rather than its name
 * or the browser's claim, so a renamed script can't be stored as a "PDF".
 */
const SIGNATURES: Array<{ type: string; ext: string; test: (b: Buffer) => boolean }> = [
  { type: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    type: "image/png",
    ext: "png",
    test: (b) =>
      b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  { type: "image/gif", ext: "gif", test: (b) => b.subarray(0, 4).toString("latin1") === "GIF8" },
  {
    type: "image/webp",
    ext: "webp",
    test: (b) =>
      b.subarray(0, 4).toString("latin1") === "RIFF" &&
      b.subarray(8, 12).toString("latin1") === "WEBP",
  },
  {
    type: "image/heic",
    ext: "heic",
    test: (b) =>
      b.subarray(4, 8).toString("latin1") === "ftyp" &&
      /^(heic|heix|hevc|mif1|msf1)$/.test(b.subarray(8, 12).toString("latin1")),
  },
  {
    type: "application/pdf",
    ext: "pdf",
    test: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-",
  },
];

export function detectFileType(bytes: Buffer): { type: string; ext: string } | null {
  const hit = SIGNATURES.find((s) => s.test(bytes));
  return hit ? { type: hit.type, ext: hit.ext } : null;
}

/** Keeps a readable name without path tricks or control characters. */
export function safeFileName(name: string, ext: string): string {
  const base = path
    .basename(name.replace(/\\/g, "/"))
    .replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "")
    .trim()
    .slice(0, 120);
  if (!base || base === "." || base === "..") return `receipt.${ext}`;
  return base;
}

function storagePath(bookId: string, attachmentId: string): string {
  const root = path.resolve(getEnv().RECEIPTS_DIR);
  return path.join(root, bookId, attachmentId);
}

export type AttachmentTarget = { entryId: string } | { bankTransactionId: string };

async function checkTarget(db: DbOrTx, bookId: string, target: AttachmentTarget) {
  if ("entryId" in target) {
    if (!z.uuid().safeParse(target.entryId).success) throw new NotFoundError("That journal entry");
    const [e] = await db
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(and(eq(journalEntries.id, target.entryId), eq(journalEntries.bookId, bookId)));
    if (!e) throw new NotFoundError("That journal entry");
  } else {
    if (!z.uuid().safeParse(target.bankTransactionId).success) {
      throw new NotFoundError("That transaction");
    }
    const [t] = await db
      .select({ id: bankTransactions.id })
      .from(bankTransactions)
      .where(
        and(eq(bankTransactions.id, target.bankTransactionId), eq(bankTransactions.bookId, bookId)),
      );
    if (!t) throw new NotFoundError("That transaction");
  }
}

export async function saveAttachment(
  db: Database,
  actor: Actor,
  bookId: string,
  target: AttachmentTarget,
  file: { name: string; bytes: Buffer },
) {
  if (file.bytes.length === 0) throw new UserFacingError("That file is empty.");
  if (file.bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new UserFacingError("Files can be up to 10 MB. Try a smaller photo or a compressed PDF.");
  }
  const kind = detectFileType(file.bytes);
  if (!kind) {
    throw new UserFacingError("Attach a photo (JPEG, PNG, HEIC, WebP, GIF) or a PDF.");
  }
  await checkTarget(db, bookId, target);
  const existing = await listAttachments(db, bookId, target);
  if (existing.length >= MAX_ATTACHMENTS_PER_ITEM) {
    throw new UserFacingError(`Up to ${MAX_ATTACHMENTS_PER_ITEM} files can be attached here.`);
  }
  const id = randomUUID();
  const dest = storagePath(bookId, id);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, file.bytes, { flag: "wx", mode: 0o640 });
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(attachments)
        .values({
          id,
          bookId,
          entryId: "entryId" in target ? target.entryId : null,
          bankTransactionId: "bankTransactionId" in target ? target.bankTransactionId : null,
          fileName: safeFileName(file.name, kind.ext),
          contentType: kind.type,
          sizeBytes: file.bytes.length,
          sha256: createHash("sha256").update(file.bytes).digest("hex"),
          createdBy: actor.userId,
        })
        .returning();
      await recordAudit(tx, {
        bookId,
        userId: actor.userId,
        entityType: "attachment",
        entityId: id,
        action: "create",
        after: { fileName: row!.fileName, sizeBytes: row!.sizeBytes, ...target },
      });
      return row!;
    });
  } catch (err) {
    await rm(dest, { force: true });
    throw err;
  }
}

/**
 * Files on a journal entry, plus (for an entry) files attached to the bank
 * transactions it records, so a receipt added in review follows the entry.
 */
export async function listAttachments(db: DbOrTx, bookId: string, target: AttachmentTarget) {
  if ("entryId" in target) {
    const linked = db
      .select({ id: bankTransactions.id })
      .from(bankTransactions)
      .where(eq(bankTransactions.entryId, target.entryId));
    return db
      .select()
      .from(attachments)
      .where(
        and(
          eq(attachments.bookId, bookId),
          or(
            eq(attachments.entryId, target.entryId),
            inArray(attachments.bankTransactionId, linked),
          ),
        ),
      )
      .orderBy(asc(attachments.createdAt));
  }
  return db
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.bookId, bookId),
        eq(attachments.bankTransactionId, target.bankTransactionId),
      ),
    )
    .orderBy(asc(attachments.createdAt));
}

export async function getAttachment(db: DbOrTx, bookId: string, attachmentId: string) {
  if (!z.uuid().safeParse(attachmentId).success) throw new NotFoundError("That file");
  const [row] = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.id, attachmentId), eq(attachments.bookId, bookId)));
  if (!row) throw new NotFoundError("That file");
  return row;
}

export async function readAttachmentBytes(row: { bookId: string; id: string }): Promise<Buffer> {
  try {
    return await readFile(storagePath(row.bookId, row.id));
  } catch {
    throw new NotFoundError("That file");
  }
}

export async function deleteAttachment(
  db: Database,
  actor: Actor,
  bookId: string,
  attachmentId: string,
) {
  const row = await getAttachment(db, bookId, attachmentId);
  await db.transaction(async (tx) => {
    await tx.delete(attachments).where(eq(attachments.id, attachmentId));
    await recordAudit(tx, {
      bookId,
      userId: actor.userId,
      entityType: "attachment",
      entityId: attachmentId,
      action: "delete",
      before: { fileName: row.fileName, sizeBytes: row.sizeBytes },
    });
  });
  await rm(storagePath(bookId, attachmentId), { force: true });
}
