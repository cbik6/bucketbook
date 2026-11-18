import type { AccountOptionGroup } from "@/lib/account-options";

/**
 * The options of an account picker: grouped by type, labeled by full path
 * ("Food: Groceries") so every option starts flush. Disabled accounts stay
 * visible (archived, or holding buckets) unless they are the current value.
 */
export function AccountSelectOptions({
  groups,
  value,
  exclude,
}: {
  groups: AccountOptionGroup[];
  value?: string;
  /** Leave these out (for example, the bank account the transaction is on). */
  exclude?: string;
}) {
  return (
    <>
      {groups.map((g) => (
        <optgroup key={g.type} label={g.label}>
          {g.options
            .filter((o) => o.id !== exclude)
            .map((o) => (
              <option key={o.id} value={o.id} disabled={o.disabled && o.id !== value}>
                {o.code ? `${o.code} ` : ""}
                {o.label}
              </option>
            ))}
        </optgroup>
      ))}
    </>
  );
}
