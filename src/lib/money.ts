/**
 * Money helpers. All amounts are integer cents (Postgres bigint). JS numbers are
 * exact for integers up to 2^53 - 1 cents (about $90 trillion), and every helper
 * here refuses anything that is not a safe integer instead of silently rounding.
 */

export type Cents = number;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

export function assertCents(value: number, label = "amount"): asserts value is Cents {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} must be a whole number of cents, got ${String(value)}`);
  }
}

export function addCents(...values: Cents[]): Cents {
  let total = 0;
  for (const v of values) {
    assertCents(v);
    total += v;
    assertCents(total, "total");
  }
  return total;
}

/**
 * Parses user input such as "1,234.56", "-12", "(45.10)", "$7.5" into cents.
 * Parentheses mean negative, as on a printed statement. More than two decimal
 * places is an error rather than a rounding decision.
 */
export function parseCents(input: string): Cents {
  let text = input.trim();
  if (text === "") throw new MoneyError("Enter an amount");

  let negative = false;
  if (text.startsWith("(") && text.endsWith(")")) {
    negative = true;
    text = text.slice(1, -1).trim();
  }
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1).trim();
  }
  text = text.replace(/^\$/, "").replace(/,/g, "");

  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(text) ?? /^()\.(\d{1,2})$/.exec(text);
  if (!match) throw new MoneyError(`"${input}" is not a valid amount`);

  const whole = match[1] === "" ? 0 : Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const cents = whole * 100 + fraction;
  assertCents(cents);
  return negative && cents !== 0 ? -cents : cents;
}

export type FormatOptions = {
  currency?: string;
  /** "minus" shows -$1.00, "parens" shows ($1.00) like an accountant's report. */
  negativeStyle?: "minus" | "parens";
  showSymbol?: boolean;
};

export function formatCents(cents: Cents, options: FormatOptions = {}): string {
  assertCents(cents);
  const { currency = "USD", negativeStyle = "minus", showSymbol = true } = options;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, "0");

  const formatter = new Intl.NumberFormat("en-US", {
    style: showSymbol ? "currency" : "decimal",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  // Format the whole part with Intl for grouping and symbol, then add exact cents.
  const wholeText = formatter.format(whole);
  const body = `${wholeText}.${fraction}`;

  if (cents >= 0) return body;
  return negativeStyle === "parens" ? `(${body})` : `-${body}`;
}
