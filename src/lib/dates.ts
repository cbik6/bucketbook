/** Dates in the ledger are plain calendar days ("2026-02-01"), never times. */

const medium = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });
const long = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" });

export function formatDay(iso: string, style: "medium" | "long" = "medium"): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return (style === "long" ? long : medium).format(d);
}

/** Today's calendar date in the given time zone (defaults to the runtime's). */
export function todayIso(timeZone?: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function iso(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
}

export const RANGE_PRESETS = [
  { id: "this-month", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "ytd", label: "Year to date" },
  { id: "last-year", label: "Last year" },
  { id: "all", label: "All dates" },
] as const;

export type RangePreset = (typeof RANGE_PRESETS)[number]["id"] | "custom";

export type DateRange = { preset: RangePreset; from?: string; to?: string; label: string };

/**
 * Resolves a date range from URL parameters. Custom from/to wins; otherwise a
 * preset relative to `today`; otherwise `fallback`.
 */
export function resolveRange(
  params: { range?: string; from?: string; to?: string },
  today: string,
  fallback: RangePreset = "ytd",
): DateRange {
  const from = isIsoDate(params.from) ? params.from : undefined;
  const to = isIsoDate(params.to) ? params.to : undefined;
  if (from || to) {
    const label = `${from ? formatDay(from) : "Start"} to ${to ? formatDay(to) : "today"}`;
    return { preset: "custom", from, to, label };
  }
  const preset = (RANGE_PRESETS.find((p) => p.id === params.range)?.id ?? fallback) as RangePreset;
  const [y, m] = today.split("-").map(Number) as [number, number];
  const mi = m - 1;
  const label = RANGE_PRESETS.find((p) => p.id === preset)?.label ?? "Custom";
  switch (preset) {
    case "this-month":
      return { preset, from: iso(y, mi, 1), to: iso(y, mi + 1, 0), label };
    case "last-month":
      return { preset, from: iso(y, mi - 1, 1), to: iso(y, mi, 0), label };
    case "ytd":
      return { preset, from: `${y}-01-01`, to: today, label };
    case "last-year":
      return { preset, from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label };
    default:
      return { preset: "all", label: "All dates" };
  }
}
