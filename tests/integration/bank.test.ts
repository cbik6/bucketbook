import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccount, listAccounts, updateAccount } from "@/server/accounts/service";
import {
  deleteAttachment,
  listAttachments,
  saveAttachment,
} from "@/server/bank/attachments-service";
import { importCsv, previewCsv } from "@/server/bank/csv-service";
import {
  approveItem,
  approveTransfer,
  bulkApprove,
  excludeItem,
  keepBoth,
  linkToEntry,
  listQueue,
  restoreItem,
} from "@/server/bank/review-service";
import { createRule, listRules } from "@/server/bank/rules-service";
import { createBook } from "@/server/books/service";
import { getDb } from "@/server/db/client";
import { bankFeeds, bankTransactions, simplefinConnections } from "@/server/db/schema";
import { accountNetCents } from "@/server/ledger/queries";
import { editEntry, getEntryDetail, postEntry, reverseEntry } from "@/server/ledger/service";
import { connectSimplefin, listConnections, mapFeed, runSync } from "@/server/simplefin/service";
import { addMoneyAccounts, makeUser, setupCleanDatabase } from "./helpers";

setupCleanDatabase();

let receiptsDir = "";
beforeAll(async () => {
  receiptsDir = await mkdtemp(path.join(os.tmpdir(), "bucketbook-receipts-"));
  process.env.RECEIPTS_DIR = receiptsDir;
});
afterAll(async () => {
  await rm(receiptsDir, { recursive: true, force: true });
});

const ACCESS_URL = "https://user:secret-pass@bridge.example/simplefin";

async function setupBook(
  template: "household" | "small_business" = "household",
  startDate = "2026-01-01",
  user?: { id: string },
) {
  const u = user ?? (await makeUser());
  const actor = { userId: u.id };
  const { book } = await createBook(getDb(), actor, {
    name: template === "household" ? "Home" : "LLC",
    template,
    startDate,
  });
  await addMoneyAccounts(actor, book.id, template);
  const rows = await listAccounts(getDb(), book.id);
  const id = (name: string) => {
    const r = rows.find((a) => a.name === name);
    if (!r) throw new Error(`no account ${name}`);
    return r.id;
  };
  return { user: u, actor, bookId: book.id, id };
}

type FakeTx = {
  id: string;
  day: string;
  amount: string;
  description: string;
  payee?: string;
  pending?: boolean;
};

const epoch = (day: string) => Math.floor(Date.parse(`${day}T12:00:00Z`) / 1000);

/** A stand-in for the SimpleFIN bridge that honors start-date and end-date. */
function fakeBridge(data: Record<string, { balance: string; transactions: FakeTx[] }>) {
  const calls: URL[] = [];
  const impl = async (input: string) => {
    const url = new URL(input);
    calls.push(url);
    const start = Number(url.searchParams.get("start-date") ?? 0);
    const end = Number(url.searchParams.get("end-date") ?? Infinity);
    const balancesOnly = url.searchParams.get("balances-only") === "1";
    return Response.json({
      errlist: [],
      connections: [{ conn_id: "C1", name: "Test", org_name: "Test Bank" }],
      accounts: Object.entries(data).map(([id, a]) => ({
        id,
        name: id,
        conn_id: "C1",
        currency: "USD",
        balance: a.balance,
        "balance-date": epoch("2026-03-20"),
        transactions: balancesOnly
          ? undefined
          : a.transactions
              .filter((t) => epoch(t.day) >= start && epoch(t.day) < end)
              .map((t) => ({
                id: t.id,
                posted: t.pending ? 0 : epoch(t.day),
                transacted_at: epoch(t.day),
                amount: t.amount,
                description: t.description,
                payee: t.payee,
                pending: t.pending ?? false,
              })),
      })),
    });
  };
  return { impl, calls };
}

const NOW = new Date("2026-03-20T15:00:00Z");

async function connectAndMap(
  bridge: ReturnType<typeof fakeBridge>,
  ctx: Awaited<ReturnType<typeof setupBook>>,
  mapping: Record<string, string>,
) {
  const { connection } = await connectSimplefin(getDb(), ctx.actor, ACCESS_URL, bridge.impl);
  const feeds = await getDb()
    .select()
    .from(bankFeeds)
    .where(eq(bankFeeds.connectionId, connection.id));
  for (const [external, accountName] of Object.entries(mapping)) {
    const feed = feeds.find((f) => f.externalId === external)!;
    await mapFeed(getDb(), ctx.actor, feed.id, {
      mode: "map",
      bookId: ctx.bookId,
      accountId: ctx.id(accountName),
      // These tests exercise history, so import from the book's start.
      importFrom: "2000-01-01",
    });
  }
  return connection;
}

const sync = (connectionId: string, bridge: ReturnType<typeof fakeBridge>, now = NOW) =>
  runSync(getDb(), connectionId, { trigger: "manual", fetchImpl: bridge.impl, now });

async function items(bookId: string) {
  return getDb()
    .select()
    .from(bankTransactions)
    .where(eq(bankTransactions.bookId, bookId))
    .orderBy(bankTransactions.postedDate, bankTransactions.externalId);
}

describe("SimpleFIN connection and sync", () => {
  it("stores the Access URL encrypted, never in plain text", async () => {
    const ctx = await setupBook();
    const bridge = fakeBridge({ CHK: { balance: "0", transactions: [] } });
    const { connection, accountCount } = await connectSimplefin(
      getDb(),
      ctx.actor,
      ACCESS_URL,
      bridge.impl,
    );
    expect(accountCount).toBe(1);
    expect(connection.label).toBe("Test Bank");
    const dump = await getDb().execute(
      sql`select row_to_json(c)::text as j from simplefin_connections c`,
    );
    expect(JSON.stringify(dump.rows)).not.toContain("secret-pass");
    const audit = await getDb().execute(sql`select after_data::text as a from audit_log`);
    expect(JSON.stringify(audit.rows)).not.toContain("secret-pass");
    expect(bridge.calls[0]!.toString()).not.toContain("secret-pass");
  });

  it("backfills from the book start date, dedupes by id, and handles pending charges", async () => {
    const ctx = await setupBook("household", "2026-01-10");
    const data = {
      CHK: {
        balance: "1000.00",
        transactions: [
          { id: "old", day: "2026-01-05", amount: "-1.00", description: "Before start" },
          { id: "jan", day: "2026-01-15", amount: "-40.00", description: "Grocery Store" },
          { id: "pay", day: "2026-03-01", amount: "2000.00", description: "Payroll" },
          { id: "tip", day: "2026-03-18", amount: "-20.00", description: "Cafe", pending: true },
          { id: "swap", day: "2026-03-18", amount: "-9.00", description: "Gas", pending: true },
        ] as FakeTx[],
      },
    };
    const bridge = fakeBridge(data);
    const conn = await connectAndMap(bridge, ctx, { CHK: "Checking" });
    const first = await sync(conn.id, bridge);
    expect(first.status).toBe("ok");
    expect(first.requests).toBe(2); // 2026-01-10 to 2026-03-21 in 45-day windows
    let rows = await items(ctx.bookId);
    expect(rows.map((r) => [r.externalId, r.status])).toEqual([
      ["jan", "review"],
      ["pay", "review"],
      ["swap", "pending"],
      ["tip", "pending"],
    ]);
    const [feed] = await getDb().select().from(bankFeeds).where(eq(bankFeeds.externalId, "CHK"));
    expect(feed!.syncedFrom).toBe("2026-01-10");
    expect(feed!.syncedThrough).toBe("2026-03-21");

    // Next day: the tip posts with the same id and a new amount; the gas
    // charge posts under a new id; nothing is duplicated.
    data.CHK.transactions = [
      ...data.CHK.transactions.filter((t) => t.id !== "tip" && t.id !== "swap"),
      { id: "tip", day: "2026-03-19", amount: "-24.00", description: "Cafe" },
      { id: "gas-posted", day: "2026-03-19", amount: "-9.00", description: "Gas" },
    ];
    const second = await sync(conn.id, bridge, new Date("2026-03-21T15:00:00Z"));
    expect(second.requests).toBe(1);
    rows = await items(ctx.bookId);
    const byId = new Map(rows.map((r) => [r.externalId, r]));
    expect(byId.get("tip")).toMatchObject({
      status: "review",
      amountCents: -2400,
      postedDate: "2026-03-19",
    });
    expect(byId.get("swap")!.status).toBe("removed");
    expect(byId.get("gas-posted")!.status).toBe("review");
    expect(rows).toHaveLength(5);
  });

  it("flags a re-issued transaction as a possible duplicate instead of importing it twice silently", async () => {
    const ctx = await setupBook();
    const data = {
      CHK: {
        balance: "0",
        transactions: [{ id: "a1", day: "2026-03-17", amount: "-15.00", description: "Pizza" }],
      },
    };
    const bridge = fakeBridge(data);
    const conn = await connectAndMap(bridge, ctx, { CHK: "Checking" });
    await sync(conn.id, bridge);
    // The bank re-issues it under a new id a day later, inside the re-read window.
    data.CHK.transactions = [
      { id: "a1-new", day: "2026-03-18", amount: "-15.00", description: "Pizza" },
    ];
    await sync(conn.id, bridge, new Date("2026-03-21T15:00:00Z"));
    const rows = await items(ctx.bookId);
    const original = rows.find((r) => r.externalId === "a1")!;
    const dup = rows.find((r) => r.externalId === "a1-new")!;
    expect(dup.duplicateOfId).toBe(original.id);

    // You decide: it's a duplicate (exclude) or keep both.
    await keepBoth(getDb(), ctx.actor, ctx.bookId, dup.id);
    const [after] = await getDb()
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.id, dup.id));
    expect(after!.duplicateOfId).toBeNull();
  });

  it("refuses to sync past the daily request budget and records the reason", async () => {
    const ctx = await setupBook();
    const bridge = fakeBridge({ CHK: { balance: "0", transactions: [] } });
    const conn = await connectAndMap(bridge, ctx, { CHK: "Checking" });
    await getDb().execute(sql`
      insert into simplefin_requests (connection_id, ok)
      select ${conn.id}, true from generate_series(1, 25)
    `);
    const result = await sync(conn.id, bridge);
    expect(result.status).toBe("error");
    expect(result.messages[0]).toMatch(/24 requests a day/);
    const [row] = await getDb()
      .select()
      .from(simplefinConnections)
      .where(eq(simplefinConnections.id, conn.id));
    expect(row!.lastSyncStatus).toBe("error");
    expect(row!.syncStartedAt).toBeNull();
  });

  it("compares the bank balance with the books", async () => {
    const ctx = await setupBook();
    const bridge = fakeBridge({
      CHK: {
        balance: "60.00",
        transactions: [{ id: "d", day: "2026-03-02", amount: "60.00", description: "Deposit" }],
      },
    });
    const conn = await connectAndMap(bridge, ctx, { CHK: "Checking" });
    await sync(conn.id, bridge);
    let [view] = await listConnections(getDb(), ctx.user.id);
    expect(view!.feeds[0]).toMatchObject({
      balanceCents: 6000,
      ledgerCents: 0,
      reviewCents: 6000,
      unexplainedCents: 0,
    });
    const [item] = await items(ctx.bookId);
    await approveItem(getDb(), ctx.actor, ctx.bookId, item!.id, {
      accountId: ctx.id("Other Income"),
    });
    [view] = await listConnections(getDb(), ctx.user.id);
    expect(view!.feeds[0]).toMatchObject({
      ledgerCents: 6000,
      reviewCents: 0,
      unexplainedCents: 0,
    });
  });
});

async function csvItems(
  ctx: Awaited<ReturnType<typeof setupBook>>,
  accountName: string,
  rows: Array<[string, number, string]>,
) {
  await importCsv(getDb(), ctx.actor, ctx.bookId, {
    accountId: ctx.id(accountName),
    mapping: {
      dateColumn: 0,
      dateFormat: "YYYY-MM-DD",
      descriptionColumn: 1,
      amountMode: "signed",
      amountColumn: 2,
    },
    rows: rows.map(([postedDate, amountCents, description], i) => ({
      line: i + 2,
      postedDate,
      amountCents,
      description,
      payee: null,
      memo: null,
    })),
  });
  return (await items(ctx.bookId)).filter(
    (r) => r.accountId === ctx.id(accountName) && r.status === "review",
  );
}

describe("import start", () => {
  it("brings in only transactions from the day an account is connected", async () => {
    const ctx = await setupBook();
    const bridge = fakeBridge({
      CHK: {
        balance: "500.00",
        transactions: [
          { id: "old", day: "2026-02-01", amount: "-20.00", description: "Before connecting" },
          { id: "new", day: "2026-03-18", amount: "-5.00", description: "After connecting" },
        ],
      },
    });
    const { connection } = await connectSimplefin(getDb(), ctx.actor, ACCESS_URL, bridge.impl);
    const [feed] = await getDb()
      .select()
      .from(bankFeeds)
      .where(eq(bankFeeds.connectionId, connection.id));
    await mapFeed(getDb(), ctx.actor, feed!.id, {
      mode: "map",
      bookId: ctx.bookId,
      accountId: ctx.id("Checking"),
      importFrom: "2026-03-15",
    });
    await sync(connection.id, bridge);
    expect((await items(ctx.bookId)).map((r) => r.externalId)).toEqual(["new"]);
    const [view] = await listConnections(getDb(), ctx.user.id);
    expect(view!.feeds[0]!.importFrom).toBe("2026-03-15");
  });

  it("defaults the import start to today when connecting", async () => {
    const ctx = await setupBook();
    const bridge = fakeBridge({ CHK: { balance: "0", transactions: [] } });
    const { connection } = await connectSimplefin(getDb(), ctx.actor, ACCESS_URL, bridge.impl);
    const [feed] = await getDb()
      .select()
      .from(bankFeeds)
      .where(eq(bankFeeds.connectionId, connection.id));
    const mapped = await mapFeed(getDb(), ctx.actor, feed!.id, {
      mode: "map",
      bookId: ctx.bookId,
      accountId: ctx.id("Checking"),
    });
    const { todayIso } = await import("@/lib/dates");
    expect(mapped.importFrom).toBe(todayIso(process.env.TZ || undefined));
  });
});

describe("guided setup", () => {
  it("connects accounts one at a time with the bank's balance as the opening balance", async () => {
    const ctx = await setupBook();
    const bridge = fakeBridge({
      "Costco Visa (8837)": { balance: "-608.28", transactions: [] },
      "Baby Fund (9454)": { balance: "225.47", transactions: [] },
      "Brokerage (1111)": { balance: "25618.90", transactions: [] },
      "Old Card (0000)": { balance: "0", transactions: [] },
    });
    const { connection } = await connectSimplefin(getDb(), ctx.actor, ACCESS_URL, bridge.impl);
    const feeds = await getDb()
      .select()
      .from(bankFeeds)
      .where(eq(bankFeeds.connectionId, connection.id));
    const feed = (prefix: string) => feeds.find((f) => f.name.startsWith(prefix))!.id;
    const { guidedConnect } = await import("@/server/simplefin/service");
    const card = await guidedConnect(getDb(), ctx.actor, feed("Costco"), {
      bookId: ctx.bookId,
      choice: "new",
      kind: "credit_card",
      name: "Costco Visa",
    });
    const baby = await guidedConnect(getDb(), ctx.actor, feed("Baby"), {
      bookId: ctx.bookId,
      choice: "new",
      kind: "savings",
      name: "Baby Fund",
    });
    const broker = await guidedConnect(getDb(), ctx.actor, feed("Brokerage"), {
      bookId: ctx.bookId,
      choice: "new",
      kind: "investment",
      name: "Brokerage",
    });
    const skipped = await guidedConnect(getDb(), ctx.actor, feed("Old"), {
      bookId: ctx.bookId,
      choice: "ignore",
    });
    // Each new account opens at the bank's balance, and earlier ones are kept.
    expect(await accountNetCents(getDb(), card.accountId!)).toBe(-60_828);
    expect(await accountNetCents(getDb(), baby.accountId!)).toBe(22_547);
    // Investments take their value from the sync instead.
    expect(await accountNetCents(getDb(), broker.accountId!)).toBe(0);
    expect(skipped.ignored).toBe(true);
    const { openingBalanceState } = await import("@/server/ledger/service");
    const state = await openingBalanceState(getDb(), ctx.bookId);
    expect(state.entry?.entryDate).toBe("2026-01-01");
  });
});

describe("accounts the bank reports backwards", () => {
  it("opens a savings account shown as negative at the positive balance", async () => {
    const ctx = await setupBook();
    const bridge = fakeBridge({
      "Student Loan Payoff (5133)": { balance: "-2136.33", transactions: [] },
    });
    const { connection } = await connectSimplefin(getDb(), ctx.actor, ACCESS_URL, bridge.impl);
    const [feed] = await getDb()
      .select()
      .from(bankFeeds)
      .where(eq(bankFeeds.connectionId, connection.id));
    const { guidedConnect } = await import("@/server/simplefin/service");
    const mapped = await guidedConnect(getDb(), ctx.actor, feed!.id, {
      bookId: ctx.bookId,
      choice: "new",
      kind: "savings",
      name: "Student Loan Payoff",
      reversedSign: true,
    });
    expect(mapped.reversedSign).toBe(true);
    expect(mapped.balanceCents).toBe(213_633);
    expect(await accountNetCents(getDb(), mapped.accountId!)).toBe(213_633);
  });

  it("flips balances and transactions on every sync, and can be turned off", async () => {
    const ctx = await setupBook();
    const bridge = fakeBridge({
      SAV: {
        balance: "-2236.33",
        transactions: [
          { id: "dep", day: "2026-03-18", amount: "-100.00", description: "Transfer in" },
        ],
      },
    });
    const connection = await connectAndMap(bridge, ctx, { SAV: "Savings" });
    const [feed] = await getDb()
      .select()
      .from(bankFeeds)
      .where(eq(bankFeeds.connectionId, connection.id));
    const { setFeedReversedSign } = await import("@/server/simplefin/service");
    await setFeedReversedSign(getDb(), ctx.actor, feed!.id, true);
    await sync(connection.id, bridge);

    const [tx] = await items(ctx.bookId);
    expect(tx!.amountCents).toBe(10_000);
    const [after] = await getDb().select().from(bankFeeds).where(eq(bankFeeds.id, feed!.id));
    expect(after!.balanceCents).toBe(223_633);

    const off = await setFeedReversedSign(getDb(), ctx.actor, feed!.id, false);
    expect(off.balanceCents).toBe(-223_633);
    await sync(connection.id, bridge);
    const [again] = await getDb().select().from(bankFeeds).where(eq(bankFeeds.id, feed!.id));
    expect(again!.balanceCents).toBe(-223_633);
  });
});

describe("several cards and investments", () => {
  it("gives each card its own new account and explains a clash", async () => {
    const ctx = await setupBook();
    const bridge = fakeBridge({
      "Costco Visa® Card (8837)": { balance: "-120.00", transactions: [] },
      "Freedom Card (1111)": { balance: "-40.00", transactions: [] },
    });
    const { connection } = await connectSimplefin(getDb(), ctx.actor, ACCESS_URL, bridge.impl);
    const feeds = await getDb()
      .select()
      .from(bankFeeds)
      .where(eq(bankFeeds.connectionId, connection.id));
    const [costco, freedom] = [
      feeds.find((f) => f.name.startsWith("Costco"))!,
      feeds.find((f) => f.name.startsWith("Freedom"))!,
    ];
    await mapFeed(getDb(), ctx.actor, costco.id, {
      mode: "map",
      bookId: ctx.bookId,
      accountId: ctx.id("Credit Card"),
    });
    await expect(
      mapFeed(getDb(), ctx.actor, freedom.id, {
        mode: "map",
        bookId: ctx.bookId,
        accountId: ctx.id("Credit Card"),
      }),
    ).rejects.toThrow(/New account/);
    const mapped = await mapFeed(getDb(), ctx.actor, freedom.id, {
      mode: "create",
      bookId: ctx.bookId,
      kind: "credit_card",
      name: "Chase Freedom",
    });
    const rows = await listAccounts(getDb(), ctx.bookId);
    const created = rows.find((a) => a.id === mapped.accountId)!;
    expect(created).toMatchObject({
      name: "Chase Freedom",
      type: "liability",
      subtype: "credit_card",
    });
  });

  it("creates connected accounts at the top level; nesting happens in the chart of accounts", async () => {
    const ctx = await setupBook();
    const bridge = fakeBridge({ "Baby Fund (9454)": { balance: "225.47", transactions: [] } });
    const { connection } = await connectSimplefin(getDb(), ctx.actor, ACCESS_URL, bridge.impl);
    const [feed] = await getDb()
      .select()
      .from(bankFeeds)
      .where(eq(bankFeeds.connectionId, connection.id));
    const mapped = await mapFeed(getDb(), ctx.actor, feed!.id, {
      mode: "create",
      bookId: ctx.bookId,
      kind: "savings",
      name: "Baby Fund",
    });
    let rows = await listAccounts(getDb(), ctx.bookId);
    const baby = rows.find((a) => a.id === mapped.accountId)!;
    expect(baby).toMatchObject({ name: "Baby Fund", subtype: "savings", parentAccountId: null });

    const marcus = await createAccount(getDb(), ctx.actor, ctx.bookId, {
      name: "Marcus",
      type: "asset",
      subtype: "savings",
    });
    await updateAccount(getDb(), ctx.actor, ctx.bookId, baby.id, {
      name: "Baby Fund",
      type: "asset",
      subtype: "savings",
      parentAccountId: marcus.id,
    });
    rows = await listAccounts(getDb(), ctx.bookId);
    expect(rows.find((a) => a.id === baby.id)!.parentAccountId).toBe(marcus.id);
    const [still] = await getDb().select().from(bankFeeds).where(eq(bankFeeds.id, feed!.id));
    expect(still!.accountId).toBe(baby.id);
  });

  it("keeps an investment account at the bank's value without importing trades", async () => {
    const ctx = await setupBook();
    const data = {
      BROKER: {
        balance: "10000.00",
        transactions: [
          { id: "buy", day: "2026-03-10", amount: "-500.00", description: "BUY VTI" },
        ] as FakeTx[],
      },
    };
    const bridge = fakeBridge(data);
    const { connection } = await connectSimplefin(getDb(), ctx.actor, ACCESS_URL, bridge.impl);
    const [feed] = await getDb()
      .select()
      .from(bankFeeds)
      .where(eq(bankFeeds.connectionId, connection.id));
    const mapped = await mapFeed(getDb(), ctx.actor, feed!.id, {
      mode: "create",
      bookId: ctx.bookId,
      kind: "investment",
      name: "Brokerage",
    });
    const invest = mapped.accountId!;
    await sync(connection.id, bridge);
    expect(await accountNetCents(getDb(), invest)).toBe(1_000_000);
    expect(await items(ctx.bookId)).toHaveLength(0);

    data.BROKER.balance = "10250.50";
    await sync(connection.id, bridge, new Date("2026-03-21T15:00:00Z"));
    expect(await accountNetCents(getDb(), invest)).toBe(1_025_050);
    const rows = await listAccounts(getDb(), ctx.bookId);
    const gains = rows.find((a) => a.systemRole === "unrealized_gains")!;
    expect(await accountNetCents(getDb(), gains.id)).toBe(-25_050);
    const obe = rows.find((a) => a.systemRole === "opening_balance_equity")!;
    expect(await accountNetCents(getDb(), obe.id)).toBe(-1_000_000);
    // Value changes stay out of income and spending.
    const { profitAndLoss } = await import("@/server/reports/service");
    const pl = await profitAndLoss(getDb(), ctx.bookId, { from: "2026-01-01", to: "2026-12-31" });
    expect(pl.netIncomeCents).toBe(0);
  });
});

describe("review queue", () => {
  it("approves a transaction into a balanced entry with the payee", async () => {
    const ctx = await setupBook();
    const [item] = await csvItems(ctx, "Checking", [["2026-03-02", -4210, "LOCAL GROCER #12"]]);
    const { entry } = await approveItem(getDb(), ctx.actor, ctx.bookId, item!.id, {
      accountId: ctx.id("Groceries"),
      payee: "Local Grocer",
    });
    expect(entry.kind).toBe("bank");
    expect(entry.payee).toBe("Local Grocer");
    // Bank entries stay out of the journal list unless you ask for everything.
    const { listEntries } = await import("@/server/ledger/service");
    expect((await listEntries(getDb(), ctx.bookId)).items.map((e) => e.id)).not.toContain(entry.id);
    expect(
      (await listEntries(getDb(), ctx.bookId, { all: true })).items.map((e) => e.id),
    ).toContain(entry.id);
    expect(await accountNetCents(getDb(), ctx.id("Checking"))).toBe(-4210);
    expect(await accountNetCents(getDb(), ctx.id("Groceries"))).toBe(4210);
    await expect(
      approveItem(getDb(), ctx.actor, ctx.bookId, item!.id, { accountId: ctx.id("Groceries") }),
    ).rejects.toThrow(/already recorded/);
  });

  it("splits a transaction across accounts and insists the split adds up", async () => {
    const ctx = await setupBook();
    const [item] = await csvItems(ctx, "Credit Card", [["2026-03-03", -10000, "BIG BOX STORE"]]);
    await expect(
      approveItem(getDb(), ctx.actor, ctx.bookId, item!.id, {
        splits: [
          { accountId: ctx.id("Groceries"), amount: "60" },
          { accountId: ctx.id("Clothing"), amount: "30" },
        ],
      }),
    ).rejects.toThrow(/add up to \$90\.00 but the transaction is \$100\.00\. Add \$10\.00/);
    const { entry } = await approveItem(getDb(), ctx.actor, ctx.bookId, item!.id, {
      splits: [
        { accountId: ctx.id("Groceries"), amount: "60", memo: "food" },
        { accountId: ctx.id("Clothing"), amount: "40" },
      ],
    });
    const detail = await getEntryDetail(getDb(), ctx.bookId, entry.id);
    expect(detail.lines.map((l) => [l.accountName, l.debitCents, l.creditCents])).toEqual([
      ["Credit Card", 0, 10000],
      ["Groceries", 6000, 0],
      ["Clothing", 4000, 0],
    ]);
  });

  it("keeps a bank entry tied to its bank amount when edited, and reversing sends it back to review", async () => {
    const ctx = await setupBook();
    const [item] = await csvItems(ctx, "Checking", [["2026-03-04", -2500, "Diner"]]);
    const { entry } = await approveItem(getDb(), ctx.actor, ctx.bookId, item!.id, {
      accountId: ctx.id("Groceries"),
    });
    // Recategorizing is fine.
    await editEntry(getDb(), ctx.actor, ctx.bookId, entry.id, {
      entryDate: "2026-03-04",
      payee: "Diner",
      memo: "",
      lines: [
        { accountId: ctx.id("Checking"), debit: "", credit: "25.00", memo: "" },
        { accountId: ctx.id("Dining Out"), debit: "25.00", credit: "", memo: "" },
      ],
    });
    // Changing the bank side is not.
    await expect(
      editEntry(getDb(), ctx.actor, ctx.bookId, entry.id, {
        entryDate: "2026-03-04",
        memo: "",
        lines: [
          { accountId: ctx.id("Checking"), debit: "", credit: "30.00", memo: "" },
          { accountId: ctx.id("Dining Out"), debit: "30.00", credit: "", memo: "" },
        ],
      }),
    ).rejects.toThrow(/must still come to that amount/);
    const reversal = await reverseEntry(getDb(), ctx.actor, ctx.bookId, entry.id, {
      entryDate: "2026-03-05",
    });
    expect(reversal.returnedToReview).toBe(1);
    const [back] = await getDb()
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.id, item!.id));
    expect(back).toMatchObject({ status: "review", entryId: null });
  });

  it("matches a transfer between two accounts in one book as one entry", async () => {
    const ctx = await setupBook();
    const [out] = await csvItems(ctx, "Checking", [["2026-03-05", -50000, "PAYMENT TO CARD"]]);
    const [into] = await csvItems(ctx, "Credit Card", [["2026-03-07", 50000, "PAYMENT THANK YOU"]]);
    const queue = await listQueue(getDb(), ctx.user.id, ctx.bookId, "review");
    expect(queue.find((q) => q.id === out!.id)!.transfer?.id).toBe(into!.id);
    const { entries } = await approveTransfer(getDb(), ctx.actor, ctx.bookId, out!.id, {
      partnerId: into!.id,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.kind).toBe("transfer");
    expect(entries[0]!.entryDate).toBe("2026-03-05");
    expect(await accountNetCents(getDb(), ctx.id("Credit Card"))).toBe(50000);
    const rows = await items(ctx.bookId);
    expect(rows.every((r) => r.status === "posted" && r.entryId === entries[0]!.id)).toBe(true);
  });

  it("pairs a transfer between books: one entry per book, linked, with remembered counterparts", async () => {
    const home = await setupBook("household");
    const llc = await setupBook("small_business", "2026-01-01", home.user);
    const invest = await createAccount(getDb(), home.actor, home.bookId, {
      name: "Investment in LLC",
      type: "asset",
      subtype: "other_asset",
    });
    const [out] = await csvItems(home, "Checking", [["2026-03-05", -100000, "TRANSFER TO LLC"]]);
    const [into] = await csvItems(llc, "Business Checking", [["2026-03-06", 100000, "DEPOSIT"]]);
    const queue = await listQueue(getDb(), home.user.id, home.bookId, "review");
    expect(queue[0]!.transfer).toMatchObject({
      id: into!.id,
      bookName: "LLC",
      counterpartAccountId: null,
    });

    await expect(
      approveTransfer(getDb(), home.actor, home.bookId, out!.id, { partnerId: into!.id }),
    ).rejects.toThrow(/stands for the other book/);
    const { entries } = await approveTransfer(getDb(), home.actor, home.bookId, out!.id, {
      partnerId: into!.id,
      counterpartAccountId: invest.id,
      partnerCounterpartAccountId: llc.id("Owner Contributions"),
    });
    expect(entries).toHaveLength(2);
    expect(entries[0]!.transferGroupId).toBe(entries[1]!.transferGroupId);
    expect(entries[0]!.bookId).toBe(home.bookId);
    expect(entries[1]!.entryDate).toBe("2026-03-06");
    expect(await accountNetCents(getDb(), invest.id)).toBe(100000);
    expect(await accountNetCents(getDb(), llc.id("Owner Contributions"))).toBe(-100000);

    // The next one remembers which accounts stand for the other book.
    const [out2] = await csvItems(home, "Checking", [["2026-03-15", -20000, "TRANSFER TO LLC"]]);
    const [into2] = await csvItems(llc, "Business Checking", [["2026-03-15", 20000, "DEPOSIT"]]);
    const q2 = await listQueue(getDb(), home.user.id, home.bookId, "review");
    expect(q2[0]!.transfer).toMatchObject({
      counterpartAccountId: invest.id,
      partnerCounterpartAccountId: llc.id("Owner Contributions"),
    });
    const second = await approveTransfer(getDb(), home.actor, home.bookId, out2!.id, {
      partnerId: into2!.id,
    });
    expect(second.entries).toHaveLength(2);
  });

  it("refuses a cross-book transfer into a book you can only view", async () => {
    const home = await setupBook("household");
    const other = await setupBook("small_business"); // another user's book
    const [out] = await csvItems(home, "Checking", [["2026-03-05", -500, "X"]]);
    const [into] = await csvItems(other, "Business Checking", [["2026-03-05", 500, "Y"]]);
    const queue = await listQueue(getDb(), home.user.id, home.bookId, "review");
    expect(queue[0]!.transfer).toBeNull();
    await expect(
      approveTransfer(getDb(), home.actor, home.bookId, out!.id, { partnerId: into!.id }),
    ).rejects.toThrow(/not found/);
  });

  it("links a transaction to an entry typed by hand", async () => {
    const ctx = await setupBook();
    const manual = await postEntry(getDb(), ctx.actor, ctx.bookId, {
      entryDate: "2026-03-01",
      memo: "Rent by check",
      lines: [
        { accountId: ctx.id("Rent or Mortgage"), debit: "1200", credit: "", memo: "" },
        { accountId: ctx.id("Checking"), debit: "", credit: "1200", memo: "" },
      ],
    });
    const [item] = await csvItems(ctx, "Checking", [["2026-03-03", -120000, "CHECK 1001"]]);
    const queue = await listQueue(getDb(), ctx.user.id, ctx.bookId, "review");
    expect(queue[0]!.linkCandidates.map((c) => c.entryId)).toEqual([manual.id]);
    await linkToEntry(getDb(), ctx.actor, ctx.bookId, item!.id, manual.id);
    const [after] = await getDb()
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.id, item!.id));
    expect(after).toMatchObject({ status: "posted", postMethod: "linked", entryId: manual.id });
    // The ledger is unchanged: the money was already recorded.
    expect(await accountNetCents(getDb(), ctx.id("Checking"))).toBe(-120000);
  });

  it("excludes and restores", async () => {
    const ctx = await setupBook();
    const [item] = await csvItems(ctx, "Checking", [["2026-03-03", -100, "Fee"]]);
    await excludeItem(getDb(), ctx.actor, ctx.bookId, item!.id);
    expect(await listQueue(getDb(), ctx.user.id, ctx.bookId, "excluded")).toHaveLength(1);
    await restoreItem(getDb(), ctx.actor, ctx.bookId, item!.id);
    expect(await listQueue(getDb(), ctx.user.id, ctx.bookId, "review")).toHaveLength(1);
  });
});

describe("rules", () => {
  it("suggests categories for waiting transactions, bulk approve uses them, and save-as-rule works", async () => {
    const ctx = await setupBook();
    await csvItems(ctx, "Checking", [
      ["2026-03-02", -4000, "SHELL OIL 123"],
      ["2026-03-03", -3000, "SHELL OIL 456"],
      ["2026-03-04", -999, "Unknown thing"],
    ]);
    await createRule(getDb(), ctx.actor, ctx.bookId, {
      name: "Gas",
      conditions: { text: { value: "shell" } },
      actions: { offsetAccountId: ctx.id("Fuel"), payee: "Shell" },
    });
    const queue = await listQueue(getDb(), ctx.user.id, ctx.bookId, "review");
    expect(queue.map((q) => q.suggestedRuleName)).toEqual(["Gas", "Gas", null]);
    const result = await bulkApprove(
      getDb(),
      ctx.actor,
      ctx.bookId,
      queue.map((q) => q.id),
    );
    expect(result.approved).toBe(2);
    expect(result.skipped).toHaveLength(1);
    expect(await accountNetCents(getDb(), ctx.id("Fuel"))).toBe(7000);

    const unknown = queue[2]!;
    const { ruleCreated } = await approveItem(getDb(), ctx.actor, ctx.bookId, unknown.id, {
      accountId: ctx.id("Hobbies"),
      saveRule: true,
    });
    expect(ruleCreated).toBe(true);
    const rules = await listRules(getDb(), ctx.bookId);
    expect(rules.map((r) => r.name)).toEqual(["Gas", "Unknown thing"]);
    const [again] = await csvItems(ctx, "Checking", [["2026-03-10", -999, "Unknown thing"]]);
    expect(again!.suggestedAccountId).toBe(ctx.id("Hobbies"));
  });
});

describe("CSV import", () => {
  const mapping = {
    dateColumn: 0,
    dateFormat: "YYYY-MM-DD",
    descriptionColumn: 1,
    amountMode: "signed",
    amountColumn: 2,
  };
  const row = (line: number, postedDate: string, amountCents: number, description: string) => ({
    line,
    postedDate,
    amountCents,
    description,
    payee: null,
    memo: null,
  });

  it("skips rows already imported and rows before the start date, and saves the preset", async () => {
    const ctx = await setupBook("household", "2026-02-01");
    const payload = {
      accountId: ctx.id("Checking"),
      mapping,
      rows: [
        row(2, "2026-01-20", -100, "Too early"),
        row(3, "2026-02-02", -500, "Coffee"),
        row(4, "2026-02-02", -500, "Coffee"),
      ],
    };
    const first = await importCsv(getDb(), ctx.actor, ctx.bookId, payload);
    expect(first).toMatchObject({ count: 2, beforeStart: 1, skipped: 0 });
    const preview = await previewCsv(getDb(), ctx.bookId, payload);
    expect(preview.map((p) => p.status)).toEqual(["before_start", "imported", "imported"]);
    const second = await importCsv(getDb(), ctx.actor, ctx.bookId, payload);
    expect(second).toMatchObject({ count: 0, skipped: 2 });
    const { getCsvPreset } = await import("@/server/bank/csv-service");
    expect(await getCsvPreset(getDb(), ctx.id("Checking"))).toMatchObject({ amountColumn: 2 });
  });

  it("flags rows that SimpleFIN already brought in", async () => {
    const ctx = await setupBook();
    const bridge = fakeBridge({
      CHK: {
        balance: "0",
        transactions: [{ id: "s1", day: "2026-03-10", amount: "-12.34", description: "Lunch" }],
      },
    });
    const conn = await connectAndMap(bridge, ctx, { CHK: "Checking" });
    await sync(conn.id, bridge);
    const result = await importCsv(getDb(), ctx.actor, ctx.bookId, {
      accountId: ctx.id("Checking"),
      mapping,
      rows: [row(2, "2026-03-11", -1234, "LUNCH PLACE")],
    });
    expect(result.possibleDuplicates).toBe(1);
    const queue = await listQueue(getDb(), ctx.user.id, ctx.bookId, "review");
    expect(queue.find((q) => q.source === "csv")!.duplicateOf?.description).toBe("Lunch");
  });

  it("refuses accounts that can't hold bank data", async () => {
    const ctx = await setupBook();
    await expect(
      importCsv(getDb(), ctx.actor, ctx.bookId, {
        accountId: ctx.id("Groceries"),
        mapping,
        rows: [],
      }),
    ).rejects.toThrow(/can't hold bank transactions/);
  });
});

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
    "1f15c4890000000d49444154789c6300010000000500010d0a2db40000000049454e44ae426082",
  "hex",
);

describe("attachments", () => {
  it("stores receipts by content type, follows the bank transaction onto its entry, and deletes", async () => {
    const ctx = await setupBook();
    const [item] = await csvItems(ctx, "Checking", [["2026-03-02", -500, "Store"]]);
    const saved = await saveAttachment(
      getDb(),
      ctx.actor,
      ctx.bookId,
      { bankTransactionId: item!.id },
      {
        name: "../../etc/receipt.png",
        bytes: PNG,
      },
    );
    expect(saved).toMatchObject({ fileName: "receipt.png", contentType: "image/png" });
    await expect(
      saveAttachment(
        getDb(),
        ctx.actor,
        ctx.bookId,
        { bankTransactionId: item!.id },
        {
          name: "evil.pdf",
          bytes: Buffer.from("#!/bin/sh\necho hi"),
        },
      ),
    ).rejects.toThrow(/photo .* or a PDF/);

    const { entry } = await approveItem(getDb(), ctx.actor, ctx.bookId, item!.id, {
      accountId: ctx.id("Groceries"),
    });
    const onEntry = await listAttachments(getDb(), ctx.bookId, { entryId: entry.id });
    expect(onEntry.map((a) => a.id)).toEqual([saved.id]);

    await deleteAttachment(getDb(), ctx.actor, ctx.bookId, saved.id);
    expect(await listAttachments(getDb(), ctx.bookId, { entryId: entry.id })).toEqual([]);
  });

  it("won't attach to another book's records", async () => {
    const a = await setupBook();
    const b = await setupBook();
    const [item] = await csvItems(b, "Checking", [["2026-03-02", -500, "Store"]]);
    await expect(
      saveAttachment(
        getDb(),
        a.actor,
        a.bookId,
        { bankTransactionId: item!.id },
        { name: "r.png", bytes: PNG },
      ),
    ).rejects.toThrow(/not found/);
  });
});

describe("database guards for bank data", () => {
  it("won't mark a transaction posted without an entry", async () => {
    const ctx = await setupBook();
    const [item] = await csvItems(ctx, "Checking", [["2026-03-02", -500, "Store"]]);
    await expect(
      getDb().execute(sql`update bank_transactions set status = 'posted' where id = ${item!.id}`),
    ).rejects.toThrow();
    const rows = await getDb()
      .select()
      .from(bankTransactions)
      .where(and(eq(bankTransactions.id, item!.id), eq(bankTransactions.status, "review")));
    expect(rows).toHaveLength(1);
  });
});
