"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { SelectInput } from "@/components/ui/field";

/** Picking an account shows its transactions right away; there is no Show button. */
export function AccountFilter({
  base,
  tab,
  accounts,
  value,
}: {
  base: string;
  tab: string;
  accounts: { id: string; name: string }[];
  value: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <div className="flex items-center gap-2 pb-2 text-sm" aria-busy={pending || undefined}>
      <label htmlFor="review-account-filter" className="text-ink-muted">
        Account
      </label>
      <SelectInput
        compact
        id="review-account-filter"
        defaultValue={value}
        onChange={(e) => {
          const params = new URLSearchParams();
          if (tab !== "review") params.set("tab", tab);
          if (e.target.value) params.set("account", e.target.value);
          const query = params.toString();
          start(() => router.replace(query ? `${base}?${query}` : base, { scroll: false }));
        }}
      >
        <option value="">All accounts</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </SelectInput>
    </div>
  );
}
