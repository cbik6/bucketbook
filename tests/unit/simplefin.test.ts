import { describe, expect, it } from "vitest";
import {
  claimSetupToken,
  decodeSetupToken,
  fetchAccountSet,
  looksLikeAccessUrl,
  parseAccountSet,
  parseSimplefinAmount,
  redactSecrets,
  splitAccessUrl,
} from "@/server/simplefin/protocol";
import {
  type ExistingRow,
  type IncomingTx,
  addDays,
  planFeedSync,
  syncWindows,
} from "@/server/simplefin/plan";

const DEMO = "https://demo:demo@beta-bridge.simplefin.org/simplefin";

describe("SimpleFIN protocol helpers", () => {
  it("parses bridge amounts exactly, including leading zeros", () => {
    expect(parseSimplefinAmount("-05.50")).toBe(-550);
    expect(parseSimplefinAmount("1960.00")).toBe(196000);
    expect(parseSimplefinAmount("12")).toBe(1200);
    expect(parseSimplefinAmount("0.1")).toBe(10);
    expect(parseSimplefinAmount("-0.00")).toBe(0);
    expect(parseSimplefinAmount("3.1400")).toBe(314);
    expect(() => parseSimplefinAmount("3.145")).toThrow(/fractions of a cent/);
    expect(() => parseSimplefinAmount("abc")).toThrow();
  });

  it("splits an Access URL into a credential-free URL and an auth header", () => {
    const parts = splitAccessUrl(DEMO);
    expect(parts.baseUrl).toBe("https://beta-bridge.simplefin.org/simplefin");
    expect(parts.authorization).toBe(`Basic ${Buffer.from("demo:demo").toString("base64")}`);
    expect(() => splitAccessUrl("https://example.com/simplefin")).toThrow(/credentials/);
    expect(() => splitAccessUrl("not a url")).toThrow();
  });

  it("decodes setup tokens and refuses junk", () => {
    const token = Buffer.from("https://bridge.example/simplefin/claim/abc").toString("base64");
    expect(decodeSetupToken(` ${token}\n`)).toBe("https://bridge.example/simplefin/claim/abc");
    expect(() => decodeSetupToken("hello")).toThrow(/valid Setup Token/);
    expect(() => decodeSetupToken("")).toThrow();
    expect(looksLikeAccessUrl(DEMO)).toBe(true);
    expect(looksLikeAccessUrl(token)).toBe(false);
  });

  it("redacts credentials from text", () => {
    expect(redactSecrets(`failed ${DEMO}/accounts`)).toBe(
      "failed https://***:***@beta-bridge.simplefin.org/simplefin/accounts",
    );
  });

  it("reads v2 responses: errlist, connections, pending and missing fields", () => {
    const set = parseAccountSet({
      errlist: [{ code: "gen.api", msg: "Range too long" }],
      connections: [{ conn_id: "C1", name: "Login", org_name: "First Bank" }],
      accounts: [
        {
          id: "A1",
          name: "Checking",
          conn_id: "C1",
          currency: "USD",
          balance: "100.25",
          "balance-date": 1795046400,
          transactions: [
            { id: "t1", posted: 1793507994, amount: "-05.50", description: "Bait", payee: "Shack" },
            { id: "t2", posted: 0, amount: "-12.00", description: "Cafe", pending: true },
            { id: "t3", posted: 1793507994, amount: "1.234", description: "Bad" },
            { id: "t4", posted: 1793507994, amount: "00.00", description: "Nothing" },
          ],
        },
      ],
    });
    expect(set.messages[0]).toBe("Range too long");
    expect(set.messages.some((m) => m.includes("fractions of a cent"))).toBe(true);
    const [a] = set.accounts;
    expect(a!.institution).toBe("First Bank");
    expect(a!.balanceCents).toBe(10025);
    expect(a!.transactions).toHaveLength(2);
    expect(a!.transactions[1]).toMatchObject({ id: "t2", pending: true, postedEpoch: 0 });
  });

  it("reads v1 responses with the deprecated errors array and org", () => {
    const set = parseAccountSet({
      errors: ["Please reauthenticate"],
      accounts: [
        {
          id: "A",
          name: "Card",
          org: { name: "Card Co" },
          currency: "USD",
          balance: "-50.00",
          "balance-date": 1,
        },
      ],
    });
    expect(set.messages).toEqual(["Please reauthenticate"]);
    expect(set.accounts[0]!.institution).toBe("Card Co");
    expect(set.accounts[0]!.balanceCents).toBe(-5000);
  });

  it("claims a token with a POST and explains a used token", async () => {
    const token = Buffer.from("https://bridge.example/claim/xyz").toString("base64");
    const calls: Array<[string, RequestInit | undefined]> = [];
    const ok = async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return new Response(DEMO, { status: 200 });
    };
    expect(await claimSetupToken(token, ok)).toBe(DEMO);
    expect(calls[0]![0]).toBe("https://bridge.example/claim/xyz");
    expect(calls[0]![1]!.method).toBe("POST");

    const used = async () => new Response("", { status: 403 });
    await expect(claimSetupToken(token, used)).rejects.toThrow(/already used/);
  });

  it("never puts credentials in the request URL", async () => {
    let seenUrl = "";
    let seenAuth = "";
    const fake = async (url: string, init?: RequestInit) => {
      seenUrl = url;
      seenAuth = new Headers(init?.headers).get("authorization") ?? "";
      return Response.json({ errlist: [], accounts: [] });
    };
    await fetchAccountSet(DEMO, { startDay: "2026-01-01", endDay: "2026-02-01" }, fake);
    expect(seenUrl).not.toContain("demo:demo");
    expect(seenUrl).toContain("start-date=1767225600");
    expect(seenUrl).toContain("pending=1");
    expect(seenAuth).toMatch(/^Basic /);
  });

  it("explains revoked access without echoing the URL", async () => {
    const fake = async () => new Response("", { status: 403 });
    const err = await fetchAccountSet(DEMO, null, fake).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/revoked/);
    expect((err as Error).message).not.toContain("demo");
  });
});

const row = (over: Partial<ExistingRow>): ExistingRow => ({
  id: "r1",
  externalId: "x1",
  feedId: "F",
  status: "review",
  amountCents: -1000,
  postedDate: "2026-03-10",
  description: "Coffee",
  ...over,
});

const tx = (over: Partial<IncomingTx>): IncomingTx => ({
  id: "x1",
  postedEpoch: 1,
  transactedEpoch: null,
  amountCents: -1000,
  description: "Coffee",
  payee: null,
  memo: null,
  pending: false,
  day: "2026-03-10",
  ...over,
});

const base = {
  feedId: "F",
  feedName: "Checking",
  others: [] as ExistingRow[],
  windowStart: "2026-03-01",
  windowEnd: "2026-03-20",
  bookStartDate: "2026-01-01",
};

describe("SimpleFIN sync planning", () => {
  it("dedupes by transaction id", () => {
    const plan = planFeedSync({ ...base, existing: [row({})], incoming: [tx({}), tx({})] });
    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates).toHaveLength(0);
  });

  it("inserts new posted transactions for review and pending ones as pending", () => {
    const plan = planFeedSync({
      ...base,
      existing: [],
      incoming: [tx({ id: "a" }), tx({ id: "b", pending: true, postedEpoch: 0 })],
    });
    expect(plan.inserts.map((i) => [i.tx.id, i.status])).toEqual([
      ["b", "pending"],
      ["a", "review"],
    ]);
  });

  it("moves a pending charge to review when it posts with the same id, taking the new amount", () => {
    const plan = planFeedSync({
      ...base,
      existing: [row({ status: "pending", amountCents: -1000 })],
      incoming: [tx({ amountCents: -1250, day: "2026-03-11" })],
    });
    expect(plan.updates).toEqual([
      expect.objectContaining({ id: "r1", status: "review", enteredReview: true }),
    ]);
    expect(plan.updates[0]!.tx.amountCents).toBe(-1250);
  });

  it("removes a pending charge the bank replaced with a new id, and flags nothing as duplicate", () => {
    const plan = planFeedSync({
      ...base,
      existing: [row({ id: "p", externalId: "pend-1", status: "pending", amountCents: -1000 })],
      incoming: [tx({ id: "posted-9", amountCents: -1200, day: "2026-03-12" })],
    });
    expect(plan.removals).toEqual(["p"]);
    expect(plan.inserts).toEqual([
      expect.objectContaining({ status: "review", duplicateOfId: null }),
    ]);
  });

  it("keeps pending charges outside the window it fetched", () => {
    const plan = planFeedSync({
      ...base,
      existing: [row({ status: "pending", postedDate: "2026-02-01" })],
      incoming: [],
    });
    expect(plan.removals).toEqual([]);
  });

  it("never moves a reviewed transaction back to pending", () => {
    const plan = planFeedSync({
      ...base,
      existing: [row({ status: "review" })],
      incoming: [tx({ pending: true, postedEpoch: 0 })],
    });
    expect(plan.updates).toEqual([]);
  });

  it("flags a likely duplicate with a different id for you to confirm", () => {
    const plan = planFeedSync({
      ...base,
      existing: [
        row({ id: "old", externalId: "old-id", status: "posted", postedDate: "2026-03-09" }),
      ],
      others: [row({ id: "csv1", externalId: "csv:..", feedId: null, postedDate: "2026-03-01" })],
      incoming: [tx({ id: "new-id", day: "2026-03-10" }), tx({ id: "new-2", day: "2026-03-10" })],
    });
    expect(plan.inserts.map((i) => i.duplicateOfId)).toEqual(["old", null]);
  });

  it("does not call two transactions in the same response duplicates of each other", () => {
    const plan = planFeedSync({
      ...base,
      existing: [row({ id: "a", externalId: "x1" })],
      incoming: [tx({ id: "x1" }), tx({ id: "x2" })],
    });
    expect(plan.inserts).toEqual([expect.objectContaining({ duplicateOfId: null })]);
  });

  it("skips transactions before the book's start date", () => {
    const plan = planFeedSync({
      ...base,
      bookStartDate: "2026-03-11",
      existing: [],
      incoming: [tx({ id: "early", day: "2026-03-10" }), tx({ id: "ok", day: "2026-03-11" })],
    });
    expect(plan.skippedBeforeStart).toBe(1);
    expect(plan.inserts.map((i) => i.tx.id)).toEqual(["ok"]);
  });

  it("warns when the bank changes a transaction that was already posted", () => {
    const plan = planFeedSync({
      ...base,
      existing: [row({ status: "posted" })],
      incoming: [tx({ amountCents: -2000 })],
    });
    expect(plan.warnings[0]).toMatch(/changed the amount/);
  });

  it("splits a long backfill into windows, newest first", () => {
    const w = syncWindows("2026-01-01", "2026-04-01", 45);
    expect(w).toEqual([
      { startDay: "2026-02-15", endDay: "2026-04-01" },
      { startDay: "2026-01-01", endDay: "2026-02-15" },
    ]);
    expect(syncWindows("2026-01-01", "2026-01-01", 45)).toEqual([]);
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
