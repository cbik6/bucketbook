/**
 * Learns categories from the transactions you have already added, on your own
 * server. Two ways to guess, strongest first:
 *
 * 1. Same store: earlier transactions with the same store name (the bank's
 *    text with store numbers, dates and card-processor prefixes removed),
 *    going the same direction. If most of them went to one category, that is
 *    the guess.
 * 2. Similar words: a naive Bayes model over the words in the description,
 *    whether money came in or went out, the bank account and the rough size
 *    of the amount. It only guesses when the words point clearly one way.
 *
 * Nothing here leaves the server: it is plain counting over your own history.
 */

export type LearnExample = {
  /** The bank's text (description, plus the bank's payee when it has one). */
  text: string;
  amountCents: number;
  bankAccountId: string;
  /** Where it went: the other side of the entry. */
  categoryId: string;
  /** The payee you kept on the entry, if any. */
  payee: string | null;
};

export type LearnSubject = { text: string; amountCents: number; bankAccountId: string };

export type LearnedGuess = {
  categoryId: string;
  /** "store": same store as before; "similar": words like earlier ones. */
  basis: "store" | "similar";
  /** How many earlier transactions back the guess. */
  seen: number;
  /** The store name it matched on (for "store"). */
  store: string;
  /** A payee you used for this store before, if you always used the same one. */
  payee: string | null;
};

export type LearnResult = {
  /** Set when the history points clearly to one category. */
  guess: LearnedGuess | null;
  /** Up to three likely categories, best first, for the top of the picker. */
  likely: string[];
};

/** Words that say how you paid, not what you bought. */
const NOISE = new Set([
  "pos",
  "debit",
  "credit",
  "purchase",
  "purch",
  "card",
  "checkcard",
  "visa",
  "mastercard",
  "recurring",
  "ach",
  "web",
  "ppd",
  "ccd",
  "pmt",
  "sq",
  "tst",
  "sp",
  "pp",
  "paypal",
  "dbt",
  "pin",
  "the",
  "and",
  "of",
  "inc",
  "llc",
  "co",
  "com",
  "www",
  "us",
  "usa",
  "id",
  "xx",
  "xxx",
  "xxxx",
]);

/** Lower-case words with digits, punctuation and payment noise removed. */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[*#/\\.,:;'"()[\]{}_|+=-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !/\d/.test(w) && !NOISE.has(w));
}

/** The store's name: its first two meaningful words ("COSTCO GAS #1379 IDAHO FALLS" is "costco gas"). */
export function storeKey(text: string): string {
  return words(text).slice(0, 2).join(" ");
}

const direction = (cents: number) => (cents < 0 ? "out" : "in");

/** Rough size of an amount, so $4 coffee and $400 rent don't look alike. */
const sizeBucket = (cents: number) => Math.round(Math.log2(Math.max(Math.abs(cents), 100) / 100));

function features(s: LearnSubject): string[] {
  return [
    ...new Set(words(s.text).map((w) => `w:${w}`)),
    `dir:${direction(s.amountCents)}`,
    `acct:${s.bankAccountId}`,
    `amt:${sizeBucket(s.amountCents)}`,
  ];
}

const SAME_STORE_SHARE = 0.75;
const SIMILAR_POSTERIOR = 0.7;
const SIMILAR_MIN_SEEN = 2;

export type Learner = { guess(subject: LearnSubject, exclude?: string): LearnResult; size: number };

export function trainLearner(examples: LearnExample[]): Learner {
  const byStore = new Map<string, LearnExample[]>();
  const docs = new Map<string, number>();
  const featureCounts = new Map<string, Map<string, number>>();
  const featureTotals = new Map<string, number>();
  const vocabulary = new Set<string>();
  /** Examples per category per word, to count how many back a "similar" guess. */
  const wordDocs = new Map<string, Map<string, number>>();

  for (const ex of examples) {
    const key = `${storeKey(ex.text)}|${direction(ex.amountCents)}`;
    if (storeKey(ex.text)) {
      const list = byStore.get(key) ?? [];
      list.push(ex);
      byStore.set(key, list);
    }
    docs.set(ex.categoryId, (docs.get(ex.categoryId) ?? 0) + 1);
    const counts = featureCounts.get(ex.categoryId) ?? new Map<string, number>();
    const fs = features(ex);
    for (const f of fs) {
      counts.set(f, (counts.get(f) ?? 0) + 1);
      vocabulary.add(f);
      if (f.startsWith("w:")) {
        const m = wordDocs.get(f) ?? new Map<string, number>();
        m.set(ex.categoryId, (m.get(ex.categoryId) ?? 0) + 1);
        wordDocs.set(f, m);
      }
    }
    featureCounts.set(ex.categoryId, counts);
    featureTotals.set(ex.categoryId, (featureTotals.get(ex.categoryId) ?? 0) + fs.length);
  }

  const total = examples.length;
  const categories = [...docs.keys()];
  const v = vocabulary.size || 1;

  function sameStore(subject: LearnSubject, exclude?: string) {
    const store = storeKey(subject.text);
    if (!store) return null;
    const list = (byStore.get(`${store}|${direction(subject.amountCents)}`) ?? []).filter(
      (e) => e.categoryId !== exclude,
    );
    if (list.length === 0) return null;
    const counts = new Map<string, number>();
    for (const e of list) counts.set(e.categoryId, (counts.get(e.categoryId) ?? 0) + 1);
    const [categoryId, n] = [...counts].sort((a, b) => b[1] - a[1])[0]!;
    const payees = new Map<string, number>();
    for (const e of list) {
      if (e.categoryId === categoryId && e.payee) {
        payees.set(e.payee, (payees.get(e.payee) ?? 0) + 1);
      }
    }
    const [payee, pn] = [...payees].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
    return {
      categoryId,
      share: n / list.length,
      seen: n,
      store,
      payee: payee && pn / n >= SAME_STORE_SHARE ? payee : null,
    };
  }

  function similar(subject: LearnSubject, exclude?: string) {
    const fs = features(subject);
    const wordFs = fs.filter((f) => f.startsWith("w:"));
    // Only categories that share at least one word have any evidence.
    const candidates = categories.filter(
      (c) => c !== exclude && wordFs.some((f) => (featureCounts.get(c)?.get(f) ?? 0) > 0),
    );
    if (candidates.length === 0) return [];
    const scores = candidates.map((c) => {
      const counts = featureCounts.get(c)!;
      const denom = (featureTotals.get(c) ?? 0) + v;
      let s = Math.log((docs.get(c)! + 1) / (total + categories.length));
      for (const f of fs) s += Math.log(((counts.get(f) ?? 0) + 1) / denom);
      return { c, s };
    });
    const max = Math.max(...scores.map((x) => x.s));
    const sum = scores.reduce((acc, x) => acc + Math.exp(x.s - max), 0);
    return scores
      .map(({ c, s }) => ({
        categoryId: c,
        posterior: Math.exp(s - max) / sum,
        // How many earlier transactions in this category share a word with it.
        seen: Math.max(0, ...wordFs.map((f) => wordDocs.get(f)?.get(c) ?? 0)),
      }))
      .sort((a, b) => b.posterior - a.posterior);
  }

  return {
    size: total,
    guess(subject, exclude) {
      const store = sameStore(subject, exclude);
      const ranked = similar(subject, exclude);
      const likely = [
        ...(store ? [store.categoryId] : []),
        ...ranked.filter((r) => r.posterior >= 0.05).map((r) => r.categoryId),
      ];
      const result: LearnResult = { guess: null, likely: [...new Set(likely)].slice(0, 3) };
      if (store && store.share >= SAME_STORE_SHARE) {
        result.guess = {
          categoryId: store.categoryId,
          basis: "store",
          seen: store.seen,
          store: store.store,
          payee: store.payee,
        };
      } else if (
        !store &&
        ranked[0] &&
        ranked[0].posterior >= SIMILAR_POSTERIOR &&
        ranked[0].seen >= SIMILAR_MIN_SEEN
      ) {
        result.guess = {
          categoryId: ranked[0].categoryId,
          basis: "similar",
          seen: ranked[0].seen,
          store: storeKey(subject.text),
          payee: null,
        };
      }
      return result;
    },
  };
}
