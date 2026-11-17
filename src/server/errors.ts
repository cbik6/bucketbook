/**
 * An error whose message is safe and helpful to show the user, optionally tied
 * to a form field. Anything else is treated as unexpected and logged.
 */
export class UserFacingError extends Error {
  readonly field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.name = "UserFacingError";
    this.field = field;
  }
}

export class NotFoundError extends UserFacingError {
  constructor(what: string) {
    super(`${what} was not found.`);
    this.name = "NotFoundError";
  }
}

export class ForbiddenError extends UserFacingError {
  constructor(message = "You don't have access to that.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

type PgError = { code?: string; constraint?: string };

export function pgErrorInfo(err: unknown): PgError {
  // Drizzle wraps driver errors; the original pg error is on `cause`.
  const candidates = [err, (err as { cause?: unknown })?.cause];
  for (const c of candidates) {
    if (c && typeof c === "object" && "code" in c) {
      return { code: String((c as PgError).code), constraint: (c as PgError).constraint };
    }
  }
  return {};
}
