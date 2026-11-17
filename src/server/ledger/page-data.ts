import "server-only";
import { type AccountOptionGroup, accountOptionGroups } from "@/lib/account-options";
import { todayIso } from "@/lib/dates";
import { listAccounts } from "../accounts/service";
import { getDb } from "../db/client";

/** Account choices for the entry form. */
export async function entryFormAccounts(
  bookId: string,
  keepIds: string[] = [],
): Promise<AccountOptionGroup[]> {
  const rows = await listAccounts(getDb(), bookId);
  return accountOptionGroups(rows, keepIds);
}

/** The server's idea of today; the entry form corrects it to the viewer's time zone. */
export function serverToday(): string {
  return todayIso(process.env.TZ || undefined);
}
