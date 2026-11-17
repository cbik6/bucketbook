import Link from "next/link";
import { type DateRange, RANGE_PRESETS } from "@/lib/dates";
import { buttonClass } from "./ui/button";
import { inputClass } from "./ui/field";

/**
 * Date range presets as plain links, plus a custom from/to form. Works without
 * JavaScript and keeps the range in the URL, so a view can be bookmarked.
 */
export function RangePicker({
  basePath,
  range,
  keep = {},
}: {
  basePath: string;
  range: DateRange;
  keep?: Record<string, string | undefined>;
}) {
  const href = (extra: Record<string, string>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...keep, ...extra })) if (v) q.set(k, v);
    return `${basePath}?${q.toString()}`;
  };
  return (
    <div className="flex flex-col gap-3">
      <nav aria-label="Date range" className="flex flex-wrap gap-1.5">
        {RANGE_PRESETS.map((p) => {
          const active = range.preset === p.id;
          return (
            <Link
              key={p.id}
              href={href({ range: p.id })}
              aria-current={active ? "true" : undefined}
              className={`rounded-full px-3 py-1 text-[0.8125rem] font-medium transition-colors duration-150 ${
                active
                  ? "bg-signal text-on-signal"
                  : "border border-rule-strong text-ink-muted hover:border-field-border hover:text-ink"
              }`}
            >
              {p.label}
            </Link>
          );
        })}
      </nav>
      <form method="get" action={basePath} className="flex flex-wrap items-end gap-2">
        {Object.entries(keep).map(([k, v]) =>
          v ? <input key={k} type="hidden" name={k} value={v} /> : null,
        )}
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          From
          <input
            type="date"
            name="from"
            defaultValue={range.from ?? ""}
            className={`${inputClass} tabular h-9 w-40`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          To
          <input
            type="date"
            name="to"
            defaultValue={range.to ?? ""}
            className={`${inputClass} tabular h-9 w-40`}
          />
        </label>
        <button type="submit" className={buttonClass("secondary", "sm", "h-9")}>
          Apply
        </button>
      </form>
    </div>
  );
}
