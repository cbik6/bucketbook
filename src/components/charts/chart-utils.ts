/** Clean axis ticks from min to max (both in cents). */
export function niceTicks(max: number, min = 0, count = 4): number[] {
  const span = Math.max(1, max - min);
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const lo = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= max + step * 0.999; v += step) ticks.push(Math.round(v));
  return ticks;
}

/** Axis labels in dollars: in full under 10,000, compact above (10K, 1.5M). */
export function axisLabel(cents: number, compact: boolean): string {
  const dollars = cents / 100;
  const sign = dollars < 0 ? "-" : "";
  const abs = Math.abs(dollars);
  if (!compact) return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
  const short =
    abs >= 1_000_000
      ? `${+(abs / 1_000_000).toFixed(1)}M`
      : `${+(abs / 1000).toFixed(abs >= 100_000 ? 0 : 1)}K`;
  return `${sign}$${short}`;
}

export function monthLabel(month: string, withYear = false): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: withYear ? "numeric" : undefined,
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export const SERIES_VARS = ["--series-1", "--series-2", "--series-3", "--series-4", "--series-5"];

/**
 * Tracks an element's width so a chart draws at its real size: text stays at
 * its true pixel size on a phone instead of shrinking with a scaled viewBox.
 */
export function observeWidth(el: HTMLElement | null, onWidth: (w: number) => void) {
  if (!el || typeof ResizeObserver === "undefined") return () => {};
  const ro = new ResizeObserver(([entry]) => {
    const w = Math.round(entry?.contentRect.width ?? 0);
    if (w > 0) onWidth(w);
  });
  ro.observe(el);
  return () => ro.disconnect();
}
