import { type SQL, sql } from "drizzle-orm";

/** A Postgres uuid[] literal from a list of ids, for `= any(...)` in raw SQL. */
export function uuidArray(ids: string[]): SQL {
  if (ids.length === 0) return sql`array[]::uuid[]`;
  return sql`array[${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}]`;
}
