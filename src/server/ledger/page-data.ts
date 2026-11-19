import { eq } from "drizzle-orm";
import "server-only";
import { type AccountOptionGroup, accountOptionGroups } from "@/lib/account-options";
import { todayIso } from "@/lib/dates";
import { listAccounts } from "../accounts/service";
import { getDb } from "../db/client";
import { books } from "../db/schema";

/** Account choices for the entry form. */
export async function entryFormAccounts(
  bookId: string,
  keepIds: string[] = [],
): Promise<AccountOptionGroup[]> {
  const db = getDb();
  const [rows, [book]] = await Promise.all([
    listAccounts(db, bookId),
    db.select({ postToParents: books.postToParents }).from(books).where(eq(books.id, bookId)),
  ]);
  return accountOptionGroups(rows, keepIds, { blockParents: book?.postToParents === false });
}

/** The server's idea of today; the entry form corrects it to the viewer's time zone. */
export function serverToday(): string {
  return todayIso(process.env.TZ || undefined);
}
