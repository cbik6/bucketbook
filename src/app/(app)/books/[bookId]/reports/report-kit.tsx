import { Download } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Money } from "@/components/money";
import { ButtonLink } from "@/components/ui/button";
import { type DateRange, type RangePreset, resolveRange } from "@/lib/dates";
import type { ReportLine } from "@/server/reports/service";

export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The report's dates: a preset or custom range, with "All dates" running from the book's start. */
export function reportRange(
  sp: Record<string, string | string[] | undefined>,
  startDate: string,
  today: string,
  fallback: RangePreset,
): { range: DateRange; from: string; to: string } {
  const range = resolveRange(
    { range: one(sp.range), from: one(sp.from), to: one(sp.to) },
    today,
    fallback,
  );
  const from = range.from ?? startDate;
  const to = range.to ?? today;
  return { range, from: from < startDate ? startDate : from, to };
}

export function csvHref(
  bookId: string,
  report: string,
  params: Record<string, string | undefined>,
) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  return `/api/books/${bookId}/reports/${report}?${q}`;
}

export function CsvButton({ href }: { href: string }) {
  return (
    <ButtonLink href={href} variant="secondary" prefetch={false}>
      <Download size={15} aria-hidden />
      Export CSV
    </ButtonLink>
  );
}

/** A section of account lines with indentation and drill-down links to registers. */
export function LineRows<L extends ReportLine>({
  lines,
  base,
  from,
  to,
  columns,
  extra,
}: {
  lines: L[];
  base: string;
  from?: string;
  to?: string;
  columns?: string[];
  extra?: (line: L) => ReactNode;
}) {
  const q = new URLSearchParams();
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  return (
    <>
      {lines.map((l) => (
        <tr key={l.id} className="border-b border-rule hover:bg-sunken/70">
          <td className="py-2 pr-3" style={{ paddingLeft: `${l.depth * 1.25}rem` }}>
            <Link
              href={`${base}/accounts/${l.id}?${q}`}
              className={`hover:underline ${l.hasChildren ? "font-medium text-ink" : "text-ink"}`}
            >
              {l.name}
            </Link>
          </td>
          {columns?.map((m) => (
            <td key={m} className="whitespace-nowrap py-2 pr-3 text-right">
              <Money cents={l.columns?.[m] ?? 0} blankZero />
            </td>
          ))}
          <td
            className={`whitespace-nowrap py-2 pr-3 text-right ${l.hasChildren ? "font-medium" : ""}`}
          >
            <Money cents={l.totalCents} />
          </td>
          {extra?.(l)}
        </tr>
      ))}
    </>
  );
}

export function SectionHead({ label, span }: { label: string; span: number }) {
  return (
    <tr>
      <th
        colSpan={span}
        scope="colgroup"
        className="border-b border-rule-strong pb-1.5 pt-6 text-left text-[0.9375rem] font-semibold text-ink"
      >
        {label}
      </th>
    </tr>
  );
}

export function TotalRow({
  label,
  cents,
  columns,
  strong,
  extra,
}: {
  label: string;
  cents: number;
  columns?: { key: string; cents: number }[];
  strong?: boolean;
  extra?: ReactNode;
}) {
  return (
    <tr
      className={`border-b ${strong ? "border-rule-strong font-semibold" : "border-rule font-medium"}`}
    >
      <td className="py-2.5 pr-3">{label}</td>
      {columns?.map((c) => (
        <td key={c.key} className="whitespace-nowrap py-2.5 pr-3 text-right">
          <Money cents={c.cents} />
        </td>
      ))}
      <td className="whitespace-nowrap py-2.5 pr-3 text-right">
        <Money cents={cents} />
      </td>
      {extra}
    </tr>
  );
}

/** Accounts with nothing to show are hidden unless asked for. */
export function withoutEmpty<L extends ReportLine>(lines: L[], showEmpty: boolean): L[] {
  if (showEmpty) return lines;
  return lines.filter(
    (l) => l.totalCents !== 0 || Object.values(l.columns ?? {}).some((v) => v !== 0),
  );
}

export function EmptyToggle({
  href,
  hidden,
  showing,
}: {
  href: string;
  hidden: number;
  showing: boolean;
}) {
  if (!showing && hidden === 0) return null;
  return (
    <Link
      href={href}
      className="text-sm font-medium text-signal-ink underline"
      aria-pressed={showing}
    >
      {showing
        ? "Hide empty accounts"
        : `Show ${hidden} empty ${hidden === 1 ? "account" : "accounts"}`}
    </Link>
  );
}
