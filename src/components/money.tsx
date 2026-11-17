import { formatCents } from "@/lib/money";

/**
 * An amount in a table or summary: tabular figures, right aligned by the
 * caller, and negatives shown with a minus sign plus the risk color, so they
 * read clearly without relying on color alone.
 */
export function Money({
  cents,
  blankZero,
  className,
}: {
  cents: number;
  blankZero?: boolean;
  className?: string;
}) {
  if (blankZero && cents === 0) return <span className={className} />;
  const negative = cents < 0;
  return (
    <span
      className={`tabular whitespace-nowrap ${negative ? "text-negative" : ""} ${className ?? ""}`}
    >
      {formatCents(cents)}
    </span>
  );
}
