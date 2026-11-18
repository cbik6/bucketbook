import type { DbOrTx } from "../db/client";
import { auditLog } from "../db/schema";

export type AuditAction =
  | "create"
  | "update"
  | "archive"
  | "unarchive"
  | "delete"
  | "reverse"
  | "setup"
  | "approve"
  | "exclude"
  | "restore"
  | "import"
  | "sync";

export type AuditEntry = {
  bookId?: string | null;
  userId?: string | null;
  entityType: string;
  entityId: string;
  action: AuditAction;
  before?: unknown;
  after?: unknown;
};

/** Never store secrets in the audit log, even if a caller passes a whole row. */
const REDACTED_KEYS = new Set([
  "password",
  "token",
  "accessToken",
  "refreshToken",
  "idToken",
  "accessUrl",
  "accessUrlCiphertext",
]);

function redact(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACTED_KEYS.has(k) ? "[redacted]" : redact(v);
    }
    return out;
  }
  return value;
}

/**
 * Writes one audit row. Call it inside the same transaction as the change, so
 * the change and its audit record are committed (or rolled back) together.
 */
export async function recordAudit(db: DbOrTx, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    bookId: entry.bookId ?? null,
    userId: entry.userId ?? null,
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    beforeData: redact(entry.before),
    afterData: redact(entry.after),
  });
}
