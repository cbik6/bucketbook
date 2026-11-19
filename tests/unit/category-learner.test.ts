import { describe, expect, it } from "vitest";
import { type LearnExample, storeKey, trainLearner, words } from "@/lib/category-learner";

const ex = (
  text: string,
  amountCents: number,
  categoryId: string,
  payee: string | null = null,
  bankAccountId = "chk",
): LearnExample => ({ text, amountCents, categoryId, payee, bankAccountId });

describe("store names", () => {
  it("drops store numbers, dates, card noise and punctuation", () => {
    expect(storeKey("COSTCO GAS #1379 IDAHO FALLS ID")).toBe("costco gas");
    expect(storeKey("SQ *CORNER CAFE 03/11")).toBe("corner cafe");
    expect(storeKey("POS DEBIT FRESH MARKET #204")).toBe("fresh market");
    expect(words("AMAZON.COM*2K4L1 AMZN.COM/BILL WA")).toEqual(["amazon", "amzn", "bill", "wa"]);
  });
});

describe("learning from your history", () => {
  const history = [
    ex("COSTCO GAS #1379 IDAHO FALLS ID", -4512, "fuel", "Costco Gas"),
    ex("COSTCO GAS #0412 POCATELLO ID", -3890, "fuel", "Costco Gas"),
    ex("COSTCO WHSE #0123 IDAHO FALLS", -21450, "groceries", "Costco"),
    ex("FRESH MARKET #204", -9562, "groceries"),
    ex("FRESH MARKET #118", -4410, "groceries"),
    ex("CITY POWER UTILITY", -10787, "utilities"),
    ex("ACME PAYROLL DIRECT DEP", 245000, "paychecks"),
    ex("AMAZON MKTPLACE PMTS", -2599, "household"),
    ex("AMAZON MKTPLACE PMTS", 2599, "household"),
  ];
  const learner = trainLearner(history);

  it("guesses the same category for the same store, with the payee you used", () => {
    const r = learner.guess({
      text: "COSTCO GAS #9999 BOISE ID",
      amountCents: -5000,
      bankAccountId: "chk",
    });
    expect(r.guess).toMatchObject({
      categoryId: "fuel",
      basis: "store",
      seen: 2,
      store: "costco gas",
      payee: "Costco Gas",
    });
    expect(r.likely[0]).toBe("fuel");
  });

  it("tells two stores of one chain apart", () => {
    const r = learner.guess({
      text: "COSTCO WHSE #0555",
      amountCents: -15000,
      bankAccountId: "chk",
    });
    expect(r.guess?.categoryId).toBe("groceries");
  });

  it("keeps money in and money out apart", () => {
    const r = learner.guess({ text: "ACME PAYROLL", amountCents: 250000, bankAccountId: "chk" });
    expect(r.guess?.categoryId).toBe("paychecks");
  });

  it("guesses from similar words when the store is new, once it has seen enough", () => {
    const more = trainLearner([
      ...history,
      ex("SHELL OIL 5744", -4000, "fuel"),
      ex("SHELL OIL 1288", -3500, "fuel"),
    ]);
    const r = more.guess({ text: "CIRCLE K SHELL OIL", amountCents: -4200, bankAccountId: "chk" });
    expect(r.guess).toMatchObject({ categoryId: "fuel", basis: "similar" });
  });

  it("makes no guess for a store with nothing in common", () => {
    const r = learner.guess({ text: "ZEPHYR BOOKS", amountCents: -1500, bankAccountId: "chk" });
    expect(r.guess).toBeNull();
    expect(r.likely).toEqual([]);
  });

  it("makes no guess when the same store went to different places", () => {
    const mixed = trainLearner([
      ex("TARGET 0012", -2000, "groceries"),
      ex("TARGET 0012", -3000, "household"),
    ]);
    const r = mixed.guess({ text: "TARGET 0099", amountCents: -2500, bankAccountId: "chk" });
    expect(r.guess).toBeNull();
    expect(r.likely).toEqual(expect.arrayContaining(["groceries", "household"]));
  });

  it("never suggests the bank account itself", () => {
    const r = learner.guess(
      { text: "COSTCO GAS", amountCents: -5000, bankAccountId: "chk" },
      "fuel",
    );
    expect(r.guess?.categoryId).not.toBe("fuel");
    expect(r.likely).not.toContain("fuel");
  });

  it("learns nothing from an empty history", () => {
    const r = trainLearner([]).guess({ text: "ANYTHING", amountCents: -100, bankAccountId: "chk" });
    expect(r).toEqual({ guess: null, likely: [] });
  });
});
