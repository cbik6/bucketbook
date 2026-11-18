"use client";

import { useEffect, useRef, useState } from "react";
import { formatCents } from "@/lib/money";
import { axisLabel, monthLabel, niceTicks, observeWidth } from "./chart-utils";

const H = 260;
const PAD = { top: 16, right: 16, bottom: 28, left: 64 };

/**
 * One series over months, as a 2px line with a soft wash under it. A
 * crosshair snaps to the nearest month; arrow keys move it too.
 */
export function LineChart({
  points,
  label,
  seriesName,
}: {
  points: { month: string; value: number }[];
  label: string;
  seriesName: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const boxRef = useRef<HTMLElement>(null);
  // 0 until measured: the chart draws once at its real width, never scaled.
  const [W, setW] = useState(0);
  useEffect(() => observeWidth(boxRef.current, setW), []);
  const svgRef = useRef<SVGSVGElement>(null);
  const values = points.map((p) => p.value);
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const ticks = niceTicks(max, min);
  const lo = ticks[0]!;
  const hi = ticks.at(-1)!;
  const compact = Math.max(Math.abs(lo), Math.abs(hi)) >= 1_000_000;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i: number) =>
    PAD.left + (points.length <= 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.value)}`).join(" ");
  const area = points.length
    ? `${path} L${x(points.length - 1)},${y(Math.max(lo, 0))} L${x(0)},${y(Math.max(lo, 0))} Z`
    : "";
  const showYear =
    points.length > 12 || points[0]?.month.slice(0, 4) !== points.at(-1)?.month.slice(0, 4);
  const every = Math.ceil(points.length / 12);

  const pick = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg || points.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const sx = ((clientX - rect.left) / rect.width) * W;
    const i = Math.round(((sx - PAD.left) / plotW) * (points.length - 1));
    setActive(Math.max(0, Math.min(points.length - 1, i)));
  };

  const last = points.length - 1;
  return (
    <figure className="relative" ref={boxRef}>
      {W > 0 ? (
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full touch-pan-y outline-none"
          role="img"
          aria-label={label}
          tabIndex={0}
          onPointerMove={(e) => pick(e.clientX)}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive(last)}
          onBlur={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? last) - 1));
            if (e.key === "ArrowRight") setActive((a) => Math.min(last, (a ?? last) + 1));
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(t)}
                y2={y(t)}
                stroke={t === 0 ? "var(--rule-strong)" : "var(--chart-grid)"}
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
          {points.map((p, i) =>
            i % every === 0 || i === last ? (
              <text
                key={p.month}
                x={x(i)}
                y={H - 8}
                textAnchor="middle"
                className="fill-ink-muted text-[11px]"
              >
                {monthLabel(p.month, showYear && (i === 0 || p.month.endsWith("-01")))}
              </text>
            ) : null,
          )}
          <path d={area} fill="var(--signal)" opacity={0.1} />
          <path
            d={path}
            fill="none"
            stroke="var(--signal)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {active !== null ? (
            <line
              x1={x(active)}
              x2={x(active)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke="var(--ink-muted)"
              strokeWidth={1}
            />
          ) : null}
          {points.length ? (
            <circle
              cx={x(active ?? last)}
              cy={y(points[active ?? last]!.value)}
              r={4.5}
              fill="var(--signal)"
              stroke="var(--paper)"
              strokeWidth={2}
            />
          ) : null}
        </svg>
      ) : (
        <div aria-hidden style={{ height: H }} />
      )}
      {points.length && active !== null ? (
        <div
          role="status"
          className="pointer-events-none absolute top-2 rounded-lg border border-rule bg-surface px-3 py-2 text-[0.8125rem] shadow-[var(--shadow-float)]"
          style={
            x(active ?? last) / W > 0.6
              ? { right: `${(1 - x(active ?? last) / W) * 100 + 2}%` }
              : { left: `${(x(active ?? last) / W) * 100 + 2}%` }
          }
        >
          <div className="tabular font-semibold text-ink">
            {formatCents(points[active ?? last]!.value)}
          </div>
          <div className="text-ink-muted">
            {seriesName}, {monthLabel(points[active ?? last]!.month, true)}
          </div>
        </div>
      ) : null}
    </figure>
  );
}
