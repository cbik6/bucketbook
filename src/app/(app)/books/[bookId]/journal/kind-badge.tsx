/** Small labels that explain an entry at a glance. */
export function KindBadge({
  kind,
  reversed,
  version,
}: {
  kind: string;
  reversed?: boolean;
  version?: number;
}) {
  const badges: string[] = [];
  if (kind === "opening_balance") badges.push("Opening balances");
  if (kind === "reversal") badges.push("Reversal");
  if (kind === "bank") badges.push("From the bank");
  if (kind === "transfer") badges.push("Transfer");
  if (kind === "bucket") badges.push("Bucket move");
  if (reversed) badges.push("Reversed");
  if (version && version > 1) badges.push(`Edited, v${version}`);
  return (
    <>
      {badges.map((b) => (
        <span
          key={b}
          className="ml-2 inline-block rounded bg-sunken px-1.5 text-xs font-normal text-ink-muted"
        >
          {b}
        </span>
      ))}
    </>
  );
}
