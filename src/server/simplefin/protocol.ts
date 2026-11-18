import { z } from "zod";
import { todayIso } from "@/lib/dates";
import { UserFacingError } from "../errors";

/**
 * SimpleFIN protocol helpers (https://www.simplefin.org/protocol.html).
 *
 * A Setup Token is a Base64-encoded claim URL. POSTing to it once returns the
 * Access URL, which carries Basic Auth credentials. The Access URL is a
 * secret: these helpers never put it in an error message or a log line.
 */

/**
 * The bridge allows 90 days per request but warns above 45 ("may be capped"),
 * so windows stay at 45 days.
 */
export const MAX_WINDOW_DAYS = 45;
/** Each sync re-reads this many days so late-posting transactions aren't missed. */
export const OVERLAP_DAYS = 5;
/** The bridge expects about 24 requests a day; stay under it with room for setup. */
export const DAILY_REQUEST_BUDGET = 20;

export type AccessUrlParts = { baseUrl: string; authorization: string; host: string };

/** Splits an Access URL into a credential-free base URL and a Basic auth header. */
export function splitAccessUrl(accessUrl: string): AccessUrlParts {
  let url: URL;
  try {
    url = new URL(accessUrl.trim());
  } catch {
    throw new UserFacingError("That doesn't look like a SimpleFIN Access URL.", "token");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UserFacingError("That doesn't look like a SimpleFIN Access URL.", "token");
  }
  if (!url.username || !url.password) {
    throw new UserFacingError(
      "That Access URL has no credentials in it. Paste the full URL or a Setup Token.",
      "token",
    );
  }
  const user = decodeURIComponent(url.username);
  const pass = decodeURIComponent(url.password);
  url.username = "";
  url.password = "";
  return {
    baseUrl: url.toString().replace(/\/+$/, ""),
    authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`,
    host: url.host,
  };
}

/** Decodes a Setup Token into its claim URL. */
export function decodeSetupToken(token: string): string {
  const cleaned = token.trim().replace(/\s+/g, "");
  if (!cleaned) throw new UserFacingError("Paste your SimpleFIN Setup Token.", "token");
  let decoded: string;
  try {
    decoded = Buffer.from(cleaned, "base64").toString("utf8").trim();
  } catch {
    decoded = "";
  }
  let url: URL | null = null;
  try {
    url = new URL(decoded);
  } catch {
    url = null;
  }
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) {
    throw new UserFacingError(
      "That isn't a valid Setup Token. Copy the whole token from SimpleFIN Bridge and try again.",
      "token",
    );
  }
  return url.toString();
}

/** True when the pasted text is an Access URL (with credentials) rather than a token. */
export function looksLikeAccessUrl(text: string): boolean {
  return /^https?:\/\/[^/\s]+:[^/\s]+@/i.test(text.trim());
}

/**
 * Parses a SimpleFIN amount ("-05.50", "1960.00", "12") into cents. More than
 * two decimal places is accepted only when the extra digits are zeros.
 */
export function parseSimplefinAmount(value: string | number): number {
  const text = String(value).trim();
  const match = /^([+-])?(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new Error(`Unreadable amount "${text}"`);
  const [, sign, whole, frac = ""] = match;
  if (frac.length > 2 && /[^0]/.test(frac.slice(2))) {
    throw new Error(`Amount "${text}" has fractions of a cent`);
  }
  const cents = Number(whole) * 100 + Number(frac.slice(0, 2).padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new Error(`Amount "${text}" is too large`);
  return sign === "-" && cents !== 0 ? -cents : cents;
}

/** The calendar day of a Unix timestamp in the server's time zone (TZ). */
export function epochToDay(epochSeconds: number, timeZone?: string): string {
  return todayIso(timeZone, new Date(epochSeconds * 1000));
}

/** Unix timestamp for the start of a calendar day in UTC. */
export function dayToEpoch(day: string): number {
  return Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000);
}

const numeric = z.union([z.string(), z.number()]);

const transactionSchema = z.object({
  id: z.coerce.string(),
  posted: z.coerce.number().default(0),
  amount: numeric,
  description: z.string().nullish(),
  payee: z.string().nullish(),
  memo: z.string().nullish(),
  transacted_at: z.coerce.number().nullish(),
  pending: z.boolean().nullish(),
});

const accountSchema = z.object({
  id: z.coerce.string(),
  name: z.string().default("Account"),
  conn_id: z.string().nullish(),
  org: z.object({ name: z.string().nullish(), domain: z.string().nullish() }).nullish(),
  currency: z.string().default("USD"),
  balance: numeric,
  "available-balance": numeric.nullish(),
  "balance-date": z.coerce.number(),
  transactions: z.array(transactionSchema).nullish(),
});

const responseSchema = z.object({
  errlist: z
    .array(z.object({ code: z.string().nullish(), msg: z.string().nullish() }).loose())
    .nullish(),
  errors: z.array(z.string()).nullish(),
  connections: z
    .array(
      z
        .object({ conn_id: z.string(), name: z.string().nullish(), org_name: z.string().nullish() })
        .loose(),
    )
    .nullish(),
  accounts: z.array(accountSchema).default([]),
});

export type SimplefinTransaction = {
  id: string;
  /** 0 when pending. */
  postedEpoch: number;
  transactedEpoch: number | null;
  amountCents: number;
  description: string;
  payee: string | null;
  memo: string | null;
  pending: boolean;
};

export type SimplefinAccount = {
  id: string;
  name: string;
  institution: string | null;
  currency: string;
  balanceCents: number;
  availableBalanceCents: number | null;
  balanceEpoch: number;
  transactions: SimplefinTransaction[];
};

export type AccountSet = {
  accounts: SimplefinAccount[];
  /** Messages from the bridge, meant to be shown to the user. */
  messages: string[];
};

const clean = (v: string | null | undefined) => {
  const t = v?.replace(/\s+/g, " ").trim();
  return t ? t : null;
};

/** Validates and normalizes a GET /accounts response (protocol v1 or v2). */
export function parseAccountSet(json: unknown): AccountSet {
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) {
    throw new UserFacingError("SimpleFIN sent a response Bucketbook couldn't read.");
  }
  const data = parsed.data;
  const messages = [
    ...(data.errlist ?? []).map((e) => clean(e.msg) ?? clean(e.code) ?? "Unknown error"),
    ...(data.errors ?? []).map((e) => clean(e) ?? "").filter(Boolean),
  ];
  const connNames = new Map(
    (data.connections ?? []).map((c) => [c.conn_id, clean(c.org_name) ?? clean(c.name)]),
  );
  const accounts: SimplefinAccount[] = [];
  for (const a of data.accounts) {
    const transactions: SimplefinTransaction[] = [];
    for (const t of a.transactions ?? []) {
      let amountCents: number;
      try {
        amountCents = parseSimplefinAmount(t.amount);
      } catch (err) {
        messages.push(`${a.name}: skipped a transaction. ${(err as Error).message}.`);
        continue;
      }
      // A zero amount moves no money, so there is nothing to record.
      if (amountCents === 0) continue;
      const pending = t.pending === true || !t.posted;
      transactions.push({
        id: t.id,
        postedEpoch: pending ? 0 : t.posted,
        transactedEpoch: t.transacted_at ?? null,
        amountCents,
        description: clean(t.description) ?? clean(t.payee) ?? clean(t.memo) ?? "(no description)",
        payee: clean(t.payee),
        memo: clean(t.memo),
        pending,
      });
    }
    let balanceCents = 0;
    let available: number | null = null;
    try {
      balanceCents = parseSimplefinAmount(a.balance);
      if (a["available-balance"] != null) available = parseSimplefinAmount(a["available-balance"]);
    } catch {
      messages.push(`${a.name}: the balance couldn't be read.`);
    }
    accounts.push({
      id: a.id,
      name: clean(a.name) ?? "Account",
      institution: clean(a.org?.name) ?? (a.conn_id ? (connNames.get(a.conn_id) ?? null) : null),
      currency: a.currency,
      balanceCents,
      availableBalanceCents: available,
      balanceEpoch: a["balance-date"],
      transactions,
    });
  }
  return { accounts, messages };
}

/** Removes anything that looks like credentials from text before it is shown or logged. */
export function redactSecrets(text: string): string {
  return text.replace(/\/\/[^/\s@]+:[^/\s@]+@/g, "//***:***@");
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 60_000;

async function request(fetchImpl: FetchLike, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    const name = (err as Error)?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new UserFacingError("SimpleFIN didn't answer within a minute. Try again later.");
    }
    throw new UserFacingError("Couldn't reach SimpleFIN. Check this server's internet connection.");
  }
}

/** Exchanges a Setup Token for an Access URL. Tokens work once. */
export async function claimSetupToken(
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const claimUrl = decodeSetupToken(token);
  const res = await request(fetchImpl, claimUrl, {
    method: "POST",
    headers: { "Content-Length": "0" },
  });
  if (res.status === 403) {
    throw new UserFacingError(
      "SimpleFIN says this Setup Token was already used or doesn't exist. Create a new token in SimpleFIN Bridge. If you didn't use it yourself, someone else may have, so disconnect that token there.",
      "token",
    );
  }
  if (!res.ok) {
    throw new UserFacingError(
      `SimpleFIN refused the token (HTTP ${res.status}). Try again.`,
      "token",
    );
  }
  const accessUrl = (await res.text()).trim();
  if (!looksLikeAccessUrl(accessUrl)) {
    throw new UserFacingError("SimpleFIN's reply didn't contain an Access URL.", "token");
  }
  return accessUrl;
}

/** GET /accounts for a date window [startDay, endDay). */
export async function fetchAccountSet(
  accessUrl: string,
  window: { startDay: string; endDay: string } | null,
  fetchImpl: FetchLike = fetch,
): Promise<AccountSet> {
  const { baseUrl, authorization } = splitAccessUrl(accessUrl);
  const params = new URLSearchParams({ pending: "1", version: "2" });
  if (window) {
    params.set("start-date", String(dayToEpoch(window.startDay)));
    params.set("end-date", String(dayToEpoch(window.endDay)));
  } else {
    params.set("balances-only", "1");
  }
  const res = await request(fetchImpl, `${baseUrl}/accounts?${params}`, {
    headers: { Authorization: authorization, Accept: "application/json" },
  });
  if (res.status === 403) {
    throw new UserFacingError(
      "SimpleFIN rejected the saved credentials. The access may have been revoked; connect again with a new Setup Token.",
    );
  }
  if (res.status === 402) {
    throw new UserFacingError("SimpleFIN says payment is required for this account.");
  }
  if (!res.ok) throw new UserFacingError(`SimpleFIN returned HTTP ${res.status}. Try again later.`);
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new UserFacingError("SimpleFIN sent a response Bucketbook couldn't read.");
  }
  return parseAccountSet(json);
}
