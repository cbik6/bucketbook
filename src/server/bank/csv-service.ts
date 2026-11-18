import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { type CsvMapping, MAX_CSV_ROWS, csvFingerprints, csvMappingSchema } from "@/lib/csv-import";
import { isIsoDate } from "@/lib/dates";
import { recordAudit } from "../audit/record";
import type { Database, DbOrTx } from "../db/client";
import { bankTransactions, books, csvPresets } from "../db/schema";
import { UserFacingError } from "../errors";
import { loadBookForPosting } from "../ledger/service";
import { DUPLICATE_WINDOW_DAYS } from "../simplefin/plan";
import { requireBankableAccount } from "./accounts";
import { applyRules } from "./rules-service";

type Actor = { userId: string };

const rowSchema = z.object({
  line: z.number().int().positive(),
  postedDate: z.string().refine(isIsoDate, "Bad date"),
  amountCents: z
    .number()
    .int()
    .refine((n) => n !== 0 && Number.isSafeInteger(n), "Bad amount"),
  description: z.string().trim().min(1).max(500),
  payee: z.string().trim().max(200).nullable(),
  memo: z.string().trim().max(500).nullable(),
});

const importSchema = z.object({
  accountId: z.uuid("Pick the account this file is for."),
  mapping: csvMappingSchema,
  rows: z.array(rowSchema).max(MAX_CSV_ROWS, `Import at most ${MAX_CSV_ROWS} rows at a time.`),
});

export type CsvRowStatus = "new" | "imported" | "possible_duplicate" | "before_start";

export type CsvPreviewRow = {
  line: number;
  status: CsvRowStatus;
  duplicateOfId: string | null;
  duplicateOfText: string | null;
};

const dayNumber = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000);

/**
 * Classifies each row: already imported (same fingerprint), a possible
 * duplicate of something on the account from another source (same amount, a
 * few days apart), before the book's start date, or new.
 */
async function classify(
  db: DbOrTx,
  bookId: string,
  accountId: string,
  startDate: string,
  rows: z.infer<typeof rowSchema>[],
) {
  const prints = csvFingerprints(rows);
  const existingPrints = new Set(
    (
      await db
        .select({ externalId: bankTransactions.externalId })
        .from(bankTransactions)
        .where(
          and(
            eq(bankTransactions.accountId, accountId),
            eq(bankTransactions.source, "csv"),
            inArray(bankTransactions.externalId, prints.length ? prints : ["-"]),
          ),
        )
    ).map((r) => r.externalId),
  );
  const others = await db
    .select({
      id: bankTransactions.id,
      postedDate: bankTransactions.postedDate,
      amountCents: bankTransactions.amountCents,
      description: bankTransactions.description,
      source: bankTransactions.source,
    })
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.bookId, bookId),
        eq(bankTransactions.accountId, accountId),
        inArray(bankTransactions.status, ["review", "posted", "pending"]),
        eq(bankTransactions.source, "simplefin"),
      ),
    );
  const claimed = new Set<string>();
  return rows.map((row, i) => {
    const print = prints[i]!;
    if (row.postedDate < startDate) {
      return { row, print, status: "before_start" as const, dup: null };
    }
    if (existingPrints.has(print)) return { row, print, status: "imported" as const, dup: null };
    let best: (typeof others)[number] | null = null;
    let bestGap = Infinity;
    for (const o of others) {
      if (claimed.has(o.id) || o.amountCents !== row.amountCents) continue;
      const gap = Math.abs(dayNumber(o.postedDate) - dayNumber(row.postedDate));
      if (gap <= DUPLICATE_WINDOW_DAYS && gap < bestGap) {
        best = o;
        bestGap = gap;
      }
    }
    if (best) {
      claimed.add(best.id);
      return { row, print, status: "possible_duplicate" as const, dup: best };
    }
    return { row, print, status: "new" as const, dup: null };
  });
}

function parseImport(raw: unknown) {
  const parsed = importSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const where = issue.path[0] === "rows" ? ` (row ${Number(issue.path[1] ?? 0) + 1})` : "";
    throw new UserFacingError(`${issue.message}${where}`, String(issue.path[0] ?? ""));
  }
  return parsed.data;
}

export async function previewCsv(db: DbOrTx, bookId: string, raw: unknown) {
  const input = parseImport(raw);
  await requireBankableAccount(db, bookId, input.accountId);
  const [book] = await db
    .select({ startDate: books.startDate })
    .from(books)
    .where(eq(books.id, bookId));
  if (!book) throw new UserFacingError("That book was not found.");
  const classified = await classify(db, bookId, input.accountId, book.startDate, input.rows);
  return classified.map((c): CsvPreviewRow => ({
    line: c.row.line,
    status: c.status,
    duplicateOfId: c.dup?.id ?? null,
    duplicateOfText: c.dup ? `${c.dup.postedDate} ${c.dup.description}` : null,
  }));
}

/**
 * Sends new rows to For review (possible duplicates come flagged for you to
 * confirm) and saves the column mapping as the account's preset.
 */
export async function importCsv(db: Database, actor: Actor, bookId: string, raw: unknown) {
  const input = parseImport(raw);
  return db.transaction(async (tx) => {
    const book = await loadBookForPosting(tx, bookId);
    await requireBankableAccount(tx, bookId, input.accountId);
    await saveCsvPreset(tx, bookId, input.accountId, input.mapping);
    const classified = await classify(tx, bookId, input.accountId, book.startDate, input.rows);
    const batchId = randomUUID();
    const fresh = classified.filter((c) => c.status === "new" || c.status === "possible_duplicate");
    const inserted = fresh.length
      ? await tx
          .insert(bankTransactions)
          .values(
            fresh.map((c) => ({
              bookId,
              accountId: input.accountId,
              source: "csv",
              externalId: c.print,
              importBatchId: batchId,
              postedDate: c.row.postedDate,
              amountCents: c.row.amountCents,
              description: c.row.description,
              payee: c.row.payee,
              bankMemo: c.row.memo,
              status: "review",
              duplicateOfId: c.dup?.id ?? null,
            })),
          )
          .onConflictDoNothing()
          .returning({ id: bankTransactions.id })
      : [];
    await applyRules(
      tx,
      bookId,
      inserted.map((r) => r.id),
    );
    const counts = {
      count: inserted.length,
      skipped: classified.filter((c) => c.status === "imported").length,
      beforeStart: classified.filter((c) => c.status === "before_start").length,
      possibleDuplicates: classified.filter((c) => c.status === "possible_duplicate").length,
    };
    await recordAudit(tx, {
      bookId,
      userId: actor.userId,
      entityType: "bank_transaction",
      entityId: batchId,
      action: "import",
      after: { accountId: input.accountId, ...counts },
    });
    return counts;
  });
}

export async function getCsvPreset(db: DbOrTx, accountId: string): Promise<CsvMapping | null> {
  if (!z.uuid().safeParse(accountId).success) return null;
  const [row] = await db.select().from(csvPresets).where(eq(csvPresets.accountId, accountId));
  if (!row) return null;
  const parsed = csvMappingSchema.safeParse(row.mapping);
  return parsed.success ? parsed.data : null;
}

async function saveCsvPreset(tx: DbOrTx, bookId: string, accountId: string, mapping: CsvMapping) {
  await tx
    .insert(csvPresets)
    .values({ bookId, accountId, mapping })
    .onConflictDoUpdate({ target: csvPresets.accountId, set: { mapping, updatedAt: new Date() } });
}
