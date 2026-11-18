import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { NORMAL_BALANCE, type AccountType } from "@/lib/account-types";
import { naturalBalance } from "@/lib/ledger-math";
import {
  archiveAccount,
  createAccount,
  deleteAccount,
  listAccounts,
  updateAccount,
} from "@/server/accounts/service";
import { createBook } from "@/server/books/service";
import { getDb, getPool } from "@/server/db/client";
import { accounts, auditLog, journalLines } from "@/server/db/schema";
import { UserFacingError } from "@/server/errors";
import { accountRegister, accountTotals } from "@/server/ledger/queries";
import {
  changeStartDate,
  editEntry,
  getEntryDetail,
  listEntries,
  openingBalanceState,
  postEntry,
  reverseEntry,
  saveOpeningBalances,
} from "@/server/ledger/service";
import { addMoneyAccounts, makeUser, setupCleanDatabase } from "./helpers";

setupCleanDatabase();

async function setupBook(startDate = "2026-01-01") {
  const user = await makeUser();
  const actor = { userId: user.id };
  const { book } = await createBook(getDb(), actor, {
    name: "Ledger Test",
    template: "household",
    startDate,
  });
  await addMoneyAccounts(actor, book.id, "household");
  const rows = await listAccounts(getDb(), book.id);
  const id = (name: string) => {
    const r = rows.find((a) => a.name === name);
    if (!r) throw new Error(`no account ${name}`);
    return r.id;
  };
  return { actor, bookId: book.id, id };
}

const line = (accountId: string, debit = "", credit = "", memo = "") => ({
  accountId,
  debit,
  credit,
  memo,
});

/** Sum of every current debit minus credit in the book. Must always be zero. */
async function trialBalanceNet(bookId: string): Promise<number> {
  const totals = await accountTotals(getDb(), bookId);
  let net = 0;
  for (const t of totals.values()) net += t.debitCents - t.creditCents;
  return net;
}

async function expectDbError(run: () => Promise<unknown>, message: RegExp) {
  const err = await run().then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, "expected the database to refuse").not.toBeNull();
  const text = String(
    (err as { cause?: { message?: string } }).cause?.message ?? (err as Error).message,
  );
  expect(text).toMatch(message);
}

describe("posting journal entries", () => {
  it("posts a balanced entry with sequential numbers", async () => {
    const { actor, bookId, id } = await setupBook();
    const a = await postEntry(getDb(), actor, bookId, {
      entryDate: "2026-02-01",
      memo: "Groceries",
      lines: [line(id("Groceries"), "54.20"), line(id("Checking"), "", "54.20")],
    });
    const b = await postEntry(getDb(), actor, bookId, {
      entryDate: "2026-02-02",
      lines: [line(id("Fuel"), "40"), line(id("Credit Card"), "", "40.00"), line(""), line("")],
    });
    expect(a.entryNumber).toBe(1);
    expect(b.entryNumber).toBe(2);
    const totals = await accountTotals(getDb(), bookId);
    expect(totals.get(id("Groceries"))).toEqual({ debitCents: 5420, creditCents: 0 });
    expect(totals.get(id("Checking"))).toEqual({ debitCents: 0, creditCents: 5420 });
    expect(await trialBalanceNet(bookId)).toBe(0);
  });

  it("refuses unbalanced, one-sided, or empty entries with clear messages", async () => {
    const { actor, bookId, id } = await setupBook();
    const post = (lines: ReturnType<typeof line>[]) =>
      postEntry(getDb(), actor, bookId, { entryDate: "2026-02-01", lines });
    await expect(
      post([line(id("Groceries"), "10"), line(id("Checking"), "", "9.99")]),
    ).rejects.toThrow(/must be equal\. They differ by \$0\.01/);
    await expect(post([line(id("Groceries"), "10")])).rejects.toThrow(/at least two lines/);
    await expect(
      post([line(id("Groceries"), "10", "10"), line(id("Checking"), "", "10")]),
    ).rejects.toThrow(/either a debit or a credit/);
    await expect(post([line(id("Groceries"), "-5"), line(id("Checking"), "-5")])).rejects.toThrow(
      /other column/,
    );
    await expect(post([line("", "10"), line(id("Checking"), "", "10")])).rejects.toThrow(
      /Pick an account/,
    );
    await expect(
      post([line(id("Groceries"), "1.234"), line(id("Checking"), "", "1.23")]),
    ).rejects.toThrow(/Line 1/);
  });

  it("refuses dates before the book's start date", async () => {
    const { actor, bookId, id } = await setupBook("2026-03-01");
    await expect(
      postEntry(getDb(), actor, bookId, {
        entryDate: "2026-02-28",
        lines: [line(id("Groceries"), "1"), line(id("Checking"), "", "1")],
      }),
    ).rejects.toThrow(/start on the book's start date/);
  });

  it("refuses archived accounts and accounts from another book", async () => {
    const { actor, bookId, id } = await setupBook();
    const other = await setupBook();
    await archiveAccount(getDb(), actor, bookId, id("Hobbies"));
    await expect(
      postEntry(getDb(), actor, bookId, {
        entryDate: "2026-02-01",
        lines: [line(id("Hobbies"), "1"), line(id("Checking"), "", "1")],
      }),
    ).rejects.toThrow(/Hobbies is archived/);
    await expect(
      postEntry(getDb(), actor, bookId, {
        entryDate: "2026-02-01",
        lines: [line(other.id("Groceries"), "1"), line(id("Checking"), "", "1")],
      }),
    ).rejects.toThrow(/isn't in this book/);
  });
});

describe("database guards (even if app code is bypassed)", () => {
  it("rejects an unbalanced entry at commit", async () => {
    const { bookId, id } = await setupBook();
    const client = await getPool().connect();
    try {
      await client.query("begin");
      const { rows } = await client.query(
        `insert into journal_entries (book_id, entry_number, kind, entry_date) values ($1, 99, 'manual', '2026-02-01') returning id`,
        [bookId],
      );
      const entryId = rows[0].id;
      await client.query(
        `insert into journal_entry_versions (entry_id, version, entry_date) values ($1, 1, '2026-02-01')`,
        [entryId],
      );
      await client.query(
        `insert into journal_lines (book_id, entry_id, version, line_number, account_id, debit_cents) values ($1, $2, 1, 1, $3, 1000)`,
        [bookId, entryId, id("Groceries")],
      );
      await client.query(
        `insert into journal_lines (book_id, entry_id, version, line_number, account_id, credit_cents) values ($1, $2, 1, 2, $3, 999)`,
        [bookId, entryId, id("Checking")],
      );
      await expect(client.query("commit")).rejects.toThrow(
        /does not balance: debits 1000 cents, credits 999 cents/,
      );
    } finally {
      await client.query("rollback").catch(() => {});
      client.release();
    }
  });

  it("rejects an entry with a single line or no lines at commit", async () => {
    const { bookId } = await setupBook();
    const client = await getPool().connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into journal_entries (book_id, entry_number, kind, entry_date) values ($1, 98, 'manual', '2026-02-01')`,
        [bookId],
      );
      await expect(client.query("commit")).rejects.toThrow(/needs at least two lines/);
    } finally {
      await client.query("rollback").catch(() => {});
      client.release();
    }
  });

  it("refuses to edit or delete posted lines and entries in place", async () => {
    const { actor, bookId, id } = await setupBook();
    const entry = await postEntry(getDb(), actor, bookId, {
      entryDate: "2026-02-01",
      lines: [line(id("Groceries"), "10"), line(id("Checking"), "", "10")],
    });
    await expectDbError(
      () =>
        getDb()
          .update(journalLines)
          .set({ debitCents: 1 })
          .where(eq(journalLines.entryId, entry.id)),
      /cannot be edited in place/,
    );
    await expectDbError(
      () => getDb().delete(journalLines).where(eq(journalLines.entryId, entry.id)),
      /cannot be deleted/,
    );
    await expectDbError(
      () => getDb().execute(sql`delete from journal_entries where id = ${entry.id}`),
      /reverse them instead/,
    );
    await expectDbError(
      () =>
        getDb().execute(
          sql`update journal_entry_versions set memo = 'x' where entry_id = ${entry.id}`,
        ),
      /history and cannot be changed/,
    );
  });

  it("refuses postings to an account that does not accept them (bucket parents)", async () => {
    const { actor, bookId, id } = await setupBook();
    await getDb()
      .update(accounts)
      .set({ allowsPosting: false })
      .where(and(eq(accounts.bookId, bookId), eq(accounts.id, id("Savings"))));
    await expect(
      postEntry(getDb(), actor, bookId, {
        entryDate: "2026-02-01",
        lines: [line(id("Savings"), "10"), line(id("Checking"), "", "10")],
      }),
    ).rejects.toThrow(/post to one of its buckets/);
  });
});

describe("editing creates versions", () => {
  it("keeps the old lines, marks them replaced, and audits the change", async () => {
    const { actor, bookId, id } = await setupBook();
    const entry = await postEntry(getDb(), actor, bookId, {
      entryDate: "2026-02-01",
      memo: "Dinner",
      lines: [line(id("Dining Out"), "30"), line(id("Checking"), "", "30")],
    });
    const result = await editEntry(getDb(), actor, bookId, entry.id, {
      entryDate: "2026-02-03",
      memo: "Dinner with tip",
      lines: [line(id("Dining Out"), "36"), line(id("Checking"), "", "36")],
    });
    expect(result.changed).toBe(true);
    expect(result.entry.currentVersion).toBe(2);

    const all = await getDb().select().from(journalLines).where(eq(journalLines.entryId, entry.id));
    expect(all).toHaveLength(4);
    expect(all.filter((l) => l.isCurrent).every((l) => l.version === 2)).toBe(true);
    expect(all.filter((l) => !l.isCurrent).every((l) => l.version === 1)).toBe(true);

    const totals = await accountTotals(getDb(), bookId);
    expect(totals.get(id("Dining Out"))!.debitCents).toBe(3600);

    const detail = await getEntryDetail(getDb(), bookId, entry.id, 1);
    expect(detail.shownVersion).toBe(1);
    expect(detail.lines[0]!.debitCents).toBe(3000);
    expect(detail.versions.map((v) => v.changeNote)).toEqual(["Edited", "Created"]);

    const audits = await getDb().select().from(auditLog).where(eq(auditLog.entityId, entry.id));
    const update = audits.find((a) => a.action === "update")!;
    expect((update.beforeData as { memo: string }).memo).toBe("Dinner");
    expect((update.afterData as { memo: string }).memo).toBe("Dinner with tip");
  });

  it("does nothing when nothing changed", async () => {
    const { actor, bookId, id } = await setupBook();
    const input = {
      entryDate: "2026-02-01",
      lines: [line(id("Dining Out"), "30"), line(id("Checking"), "", "30")],
    };
    const entry = await postEntry(getDb(), actor, bookId, input);
    const result = await editEntry(getDb(), actor, bookId, entry.id, input);
    expect(result.changed).toBe(false);
    expect(result.entry.currentVersion).toBe(1);
  });
});

describe("reversals", () => {
  it("posts a mirror entry and zeroes the effect", async () => {
    const { actor, bookId, id } = await setupBook();
    const entry = await postEntry(getDb(), actor, bookId, {
      entryDate: "2026-02-01",
      memo: "Wrong card",
      lines: [line(id("Clothing"), "80"), line(id("Credit Card"), "", "80")],
    });
    const reversal = await reverseEntry(getDb(), actor, bookId, entry.id, {
      entryDate: "2026-02-10",
    });
    expect(reversal.kind).toBe("reversal");
    expect(reversal.memo).toBe("Reverses JE 1: Wrong card");
    const totals = await accountTotals(getDb(), bookId);
    const c = totals.get(id("Clothing"))!;
    expect(c.debitCents - c.creditCents).toBe(0);
    expect(await trialBalanceNet(bookId)).toBe(0);

    // As of the original date, the original still shows; the reversal lands later.
    const asOf = await accountTotals(getDb(), bookId, { asOf: "2026-02-05" });
    expect(asOf.get(id("Clothing"))!.debitCents).toBe(8000);

    const detail = await getEntryDetail(getDb(), bookId, entry.id);
    expect(detail.reversedBy?.id).toBe(reversal.id);
  });

  it("blocks double reversal, reversing a reversal, editing a reversed entry, and early dates", async () => {
    const { actor, bookId, id } = await setupBook();
    const entry = await postEntry(getDb(), actor, bookId, {
      entryDate: "2026-02-05",
      lines: [line(id("Clothing"), "80"), line(id("Credit Card"), "", "80")],
    });
    await expect(
      reverseEntry(getDb(), actor, bookId, entry.id, { entryDate: "2026-02-04" }),
    ).rejects.toThrow(/before the original entry/);
    const reversal = await reverseEntry(getDb(), actor, bookId, entry.id, {
      entryDate: "2026-02-05",
    });
    await expect(
      reverseEntry(getDb(), actor, bookId, entry.id, { entryDate: "2026-02-06" }),
    ).rejects.toThrow(/already reversed by JE 2/);
    await expect(
      reverseEntry(getDb(), actor, bookId, reversal.id, { entryDate: "2026-02-06" }),
    ).rejects.toThrow(/can't be reversed/);
    await expect(
      editEntry(getDb(), actor, bookId, entry.id, {
        entryDate: "2026-02-05",
        lines: [line(id("Clothing"), "81"), line(id("Credit Card"), "", "81")],
      }),
    ).rejects.toThrow(/reversed by JE 2/);
    await expect(
      editEntry(getDb(), actor, bookId, reversal.id, {
        entryDate: "2026-02-05",
        lines: [line(id("Clothing"), "1"), line(id("Credit Card"), "", "1")],
      }),
    ).rejects.toThrow(/reversal can't be edited/);
  });
});

describe("opening balances", () => {
  it("offsets to Opening Balance Equity and versions on later saves", async () => {
    const { actor, bookId, id } = await setupBook();
    const first = await saveOpeningBalances(getDb(), actor, bookId, {
      [id("Checking")]: "2,500.00",
      [id("Savings")]: "10000",
      [id("Credit Card")]: "430.15",
    });
    expect(first.changed).toBe(true);
    let state = await openingBalanceState(getDb(), bookId);
    expect(state.entry?.entryDate).toBe("2026-01-01");
    // OBE takes the difference: 2,500 + 10,000 - 430.15 = 12,069.85 credit.
    expect(state.openingBalanceEquityNet).toBe(-1206985);
    expect(state.accounts.find((a) => a.name === "Credit Card")!.naturalCents).toBe(43015);

    const second = await saveOpeningBalances(getDb(), actor, bookId, {
      [id("Checking")]: "2,600",
      [id("Savings")]: "10000",
      [id("Credit Card")]: "430.15",
    });
    expect(second.changed).toBe(true);
    state = await openingBalanceState(getDb(), bookId);
    expect(state.entry?.currentVersion).toBe(2);
    expect(await trialBalanceNet(bookId)).toBe(0);

    await expect(saveOpeningBalances(getDb(), actor, bookId, {})).rejects.toThrow(
      /can't all be zero/,
    );
  });

  it("moves with the start date, and the move is blocked by earlier entries", async () => {
    const { actor, bookId, id } = await setupBook();
    await saveOpeningBalances(getDb(), actor, bookId, { [id("Checking")]: "100" });
    await postEntry(getDb(), actor, bookId, {
      entryDate: "2026-03-15",
      lines: [line(id("Groceries"), "5"), line(id("Checking"), "", "5")],
    });
    await expect(changeStartDate(getDb(), actor, bookId, "2026-04-01")).rejects.toThrow(
      /1 entry is dated before/,
    );
    await changeStartDate(getDb(), actor, bookId, "2026-03-01");
    const state = await openingBalanceState(getDb(), bookId);
    expect(state.entry?.entryDate).toBe("2026-03-01");
    expect(state.entry?.currentVersion).toBe(2);
  });
});

describe("accounts with activity", () => {
  it("can't be deleted, retyped, or archived while they hold a balance", async () => {
    const { actor, bookId, id } = await setupBook();
    const custom = await createAccount(getDb(), actor, bookId, {
      name: "Pet Care",
      type: "expense",
      subtype: "expense",
    });
    await postEntry(getDb(), actor, bookId, {
      entryDate: "2026-02-01",
      lines: [line(custom.id, "25"), line(id("Checking"), "", "25")],
    });
    await expect(deleteAccount(getDb(), actor, bookId, custom.id)).rejects.toThrow(
      /only be archived/,
    );
    await expect(
      updateAccount(getDb(), actor, bookId, custom.id, {
        name: "Pet Care",
        type: "asset",
        subtype: "other_asset",
      }),
    ).rejects.toThrow(/type can't change/);
    await expect(archiveAccount(getDb(), actor, bookId, custom.id)).rejects.toThrow(
      /balance of \$25\.00/,
    );
    // Move the balance, then archiving works and history is untouched.
    await postEntry(getDb(), actor, bookId, {
      entryDate: "2026-02-02",
      lines: [line(id("Hobbies"), "25"), line(custom.id, "", "25")],
    });
    await archiveAccount(getDb(), actor, bookId, custom.id);
  });
});

describe("register and ledger invariants", () => {
  it("keeps a running balance that starts from everything before the range", async () => {
    const { actor, bookId, id } = await setupBook();
    await saveOpeningBalances(getDb(), actor, bookId, { [id("Checking")]: "1000" });
    for (const [date, amt] of [
      ["2026-01-10", "100"],
      ["2026-02-10", "50"],
      ["2026-03-10", "25"],
    ] as const) {
      await postEntry(getDb(), actor, bookId, {
        entryDate: date,
        lines: [line(id("Groceries"), amt), line(id("Checking"), "", amt)],
      });
    }
    const all = await accountRegister(getDb(), bookId, [id("Checking")]);
    expect(all.rows.map((r) => r.runningNetCents)).toEqual([100000, 90000, 85000, 82500]);
    expect(all.rows[1]!.otherAccounts).toEqual(["Groceries"]);

    const feb = await accountRegister(getDb(), bookId, [id("Checking")], {
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(feb.openingNetCents).toBe(90000);
    expect(feb.rows.map((r) => r.runningNetCents)).toEqual([85000]);
  });

  it("balances: trial balance is zero and assets = liabilities + equity + net income", async () => {
    const { actor, bookId, id } = await setupBook();
    await saveOpeningBalances(getDb(), actor, bookId, {
      [id("Checking")]: "3000",
      [id("Savings")]: "12000",
      [id("Credit Card")]: "800",
    });
    // A deterministic mix of everyday activity.
    let seed = 7;
    const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    const expenseNames = ["Groceries", "Fuel", "Utilities", "Dining Out", "Travel"];
    for (let i = 0; i < 40; i++) {
      const cents = 100 + Math.floor(rand() * 20000);
      const amt = (cents / 100).toFixed(2);
      const day = String(1 + (i % 28)).padStart(2, "0");
      const month = String(1 + Math.floor(i / 10)).padStart(2, "0");
      const date = `2026-${month}-${day}`;
      if (i % 5 === 0) {
        await postEntry(getDb(), actor, bookId, {
          entryDate: date,
          lines: [line(id("Checking"), amt), line(id("Paychecks"), "", amt)],
        });
      } else {
        const exp = expenseNames[i % expenseNames.length]!;
        const pay = i % 2 ? "Credit Card" : "Checking";
        const e = await postEntry(getDb(), actor, bookId, {
          entryDate: date,
          lines: [line(id(exp), amt), line(id(pay), "", amt)],
        });
        if (i % 7 === 0) await reverseEntry(getDb(), actor, bookId, e.id, { entryDate: date });
        if (i % 11 === 0 && i % 7 !== 0) {
          await editEntry(getDb(), actor, bookId, e.id, {
            entryDate: date,
            lines: [line(id(exp), "12.34"), line(id(pay), "", "12.34")],
          });
        }
      }
    }
    expect(await trialBalanceNet(bookId)).toBe(0);

    const totals = await accountTotals(getDb(), bookId);
    const rows = await listAccounts(getDb(), bookId);
    const sum: Record<AccountType, number> = {
      asset: 0,
      liability: 0,
      equity: 0,
      income: 0,
      expense: 0,
    };
    for (const r of rows) {
      const t = totals.get(r.id);
      if (!t) continue;
      const type = r.type as AccountType;
      sum[type] += naturalBalance(type, t.debitCents, t.creditCents);
    }
    const netIncome = sum.income - sum.expense;
    expect(sum.asset).toBe(sum.liability + sum.equity + netIncome);
    expect(NORMAL_BALANCE.asset).toBe("debit");

    const listed = await listEntries(getDb(), bookId, { limit: 200 });
    expect(listed.total).toBe(listed.items.length);
    expect(listed.items.every((e) => e.totalCents > 0)).toBe(true);
  });

  it("explains failures as user-facing messages, never raw SQL", async () => {
    const { actor, bookId } = await setupBook();
    const err = await postEntry(getDb(), actor, bookId, { entryDate: "nope", lines: [] }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(UserFacingError);
  });
});
