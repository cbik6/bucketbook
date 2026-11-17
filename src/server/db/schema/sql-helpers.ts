import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

/** `column IN ('a', 'b')` for check constraints, from a list of known-safe literals. */
export function inList(column: AnyPgColumn, values: readonly string[]): SQL {
  for (const v of values) {
    if (!/^[a-z_]+$/.test(v)) throw new Error(`Unsafe literal in check constraint: ${v}`);
  }
  return sql`${column} in (${sql.raw(values.map((v) => `'${v}'`).join(", "))})`;
}
