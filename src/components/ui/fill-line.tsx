/**
 * The app's signature fill line: a hairline track filled in green from the
 * left. Used for wizard progress now and bucket goals later. The fill animates
 * with clip-path so it never changes layout.
 */
export function FillLine({
  value,
  max,
  label,
  className,
}: {
  value: number;
  max: number;
  label: string;
  className?: string;
}) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={`relative h-1.5 w-full overflow-hidden rounded-full bg-rule ${className ?? ""}`}
    >
      <div
        className="absolute inset-0 rounded-full bg-signal transition-[clip-path] duration-500 ease-[var(--ease-in-out)]"
        style={{ clipPath: `inset(0 ${100 - pct}% 0 0 round 999px)` }}
      />
    </div>
  );
}
