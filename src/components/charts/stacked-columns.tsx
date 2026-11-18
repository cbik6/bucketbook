"use client";

import { useEffect, useRef, useState } from "react";
import { formatCents } from "@/lib/money";
import { SERIES_VARS, axisLabel, monthLabel, niceTicks, observeWidth } from "./chart-utils";

export type ColumnSeries = { name: string; values: number[] };

const H = 280;
const PAD = { top: 16, right: 12, bottom: 28, left: 64 };

/**
 * Monthly columns stacked by category. Up to five named series in fixed color
 * order; anything past that is folded into "Other" by the caller. Each month
 * is a hover and focus target with a readout of every series.
 */
export function StackedColumns({
  months,
  series,
  label,
}: {
  months: string[];
  series: ColumnSeries[];
  label: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(800);
  useEffect(() => observeWidth(boxRef.current, setW), []);
  const totals = months.map((_, i) =>
    series.reduce((n, s) => n + Math.max(0, s.values[i] ?? 0), 0),
  );
  const max = Math.max(1, ...totals);
  const ticks = niceTicks(max);
  const top = ticks.at(-1)!;
  const compact = top >= 1_000_000;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const band = plotW / Math.max(1, months.length);
  const barW = Math.min(24, band * 0.6);
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const color = (i: number, s: ColumnSeries) =>
    s.name === "Other" ? "var(--series-other)" : `var(${SERIES_VARS[i % SERIES_VARS.length]})`;
  const showYear = months.length > 12 || months[0]?.slice(0, 4) !== months.at(-1)?.slice(0, 4);

  return (
    <figure className="flex flex-col gap-3">
      <ul
        className="flex flex-wrap gap-x-4 gap-y-1 text-[0.8125rem] text-ink-muted"
        aria-label="Legend"
      >
        {series.map((s, i) => (
          <li key={s.name} className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-sm" style={{ background: color(i, s) }} />
            {s.name}
          </li>
        ))}
      </ul>
      <div className="relative" ref={boxRef}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full"
          role="img"
          aria-label={label}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--chart-grid)"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y(t)}
                dy="0.32em"
                textAnchor="end"
                className="fill-ink-muted text-[11px] tabular-nums"
              >
                {axisLabel(t, compact)}
              </text>
            </g>
          ))}
          {months.map((m, i) => {
            const cx = PAD.left + band * i + band / 2;
            let base = 0;
            const segs = series
              .map((s, si) => ({ s, si, v: Math.max(0, s.values[i] ?? 0) }))
              .filter((x) => x.v > 0);
            return (
              <g
                key={m}
                tabIndex={0}
                role="button"
                aria-label={`${monthLabel(m, true)}: ${formatCents(totals[i]!)} total`}
                onPointerEnter={() => setActive(i)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className="outline-none"
              >
                <rect
                  x={cx - band / 2}
                  y={PAD.top}
                  width={band}
                  height={plotH}
                  fill="transparent"
                />
                {active === i ? (
                  <rect
                    x={cx - band / 2}
                    y={PAD.top}
                    width={band}
                    height={plotH}
                    fill="var(--surface-sunken)"
                  />
                ) : null}
                {segs.map(({ s, si, v }, k) => {
                  const y0 = y(base);
                  base += v;
                  const y1 = y(base);
                  // A 2px surface gap between stacked segments.
                  const h = Math.max(0, y0 - y1 - (k > 0 ? 2 : 0));
                  const isTop = k === segs.length - 1;
                  const r = isTop ? Math.min(4, h, barW / 2) : 0;
                  const x0 = cx - barW / 2;
                  const yTop = y1;
                  const d = `M${x0},${yTop + h} V${yTop + r} Q${x0},${yTop} ${x0 + r},${yTop} H${x0 + barW - r} Q${x0 + barW},${yTop} ${x0 + barW},${yTop + r} V${yTop + h} Z`;
                  return <path key={s.name} d={d} fill={color(si, s)} />;
                })}
                <text x={cx} y={H - 8} textAnchor="middle" className="fill-ink-muted text-[11px]">
                  {monthLabel(m, showYear && (i === 0 || m.endsWith("-01")))}
                </text>
              </g>
            );
          })}
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(0)}
            y2={y(0)}
            stroke="var(--rule-strong)"
            strokeWidth={1}
          />
        </svg>
        {active !== null ? (
          <div
            role="status"
            className="pointer-events-none absolute top-2 z-10 min-w-44 rounded-lg border border-rule bg-surface px-3 py-2 text-[0.8125rem] shadow-[var(--shadow-float)]"
            style={
              (PAD.left + band * active + band / 2) / W > 0.6
                ? { right: `${(1 - (PAD.left + band * active) / W) * 100}%` }
                : { left: `${((PAD.left + band * (active + 1)) / W) * 100}%` }
            }
          >
            <div className="mb-1 font-medium text-ink">{monthLabel(months[active]!, true)}</div>
            <ul className="flex flex-col gap-0.5">
              {series.map((s, i) => (
                <li key={s.name} className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="h-0.5 w-3 rounded-full"
                    style={{ background: color(i, s) }}
                  />
                  <span className="tabular font-medium text-ink">
                    {formatCents(s.values[active] ?? 0)}
                  </span>
                  <span className="text-ink-muted">{s.name}</span>
                </li>
              ))}
              <li className="mt-1 flex gap-2 border-t border-rule pt-1">
                <span className="tabular font-semibold text-ink">
                  {formatCents(totals[active]!)}
                </span>
                <span className="text-ink-muted">Total</span>
              </li>
            </ul>
          </div>
        ) : null}
      </div>
    </figure>
  );
}
