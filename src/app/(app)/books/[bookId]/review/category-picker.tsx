"use client";

import { Combobox } from "@base-ui/react/combobox";
import { Check, ChevronDown, Search, Sparkles, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { AccountOptionGroup } from "@/lib/account-options";

export type PickItem = {
  /** An account id, or "transfer:<id>", "link:<entryId>", "split". */
  value: string;
  /** What the button shows once picked: the full path, "Food: Groceries". */
  label: string;
  /** The account's own name, shown indented under its parent in the list. */
  name: string;
  /** Its parents, shown beside it while searching. */
  path: string;
  depth: number;
  disabled: boolean;
  /** Why it is suggested. */
  hint?: "rule" | "learned";
};

type PickGroup = { label: string; items: PickItem[] };

/** Group names in plain words, in the order that fits the direction of the money. */
function groupsFor(groups: AccountOptionGroup[], exclude: string, moneyOut: boolean): PickGroup[] {
  const byType = new Map(groups.map((g) => [g.type, g]));
  const items = (types: string[]) =>
    types.flatMap((t) =>
      (byType.get(t as AccountOptionGroup["type"])?.options ?? [])
        .filter((o) => o.id !== exclude)
        .map<PickItem>((o) => {
          const parts = o.label.split(": ");
          return {
            value: o.id,
            label: `${o.code ? `${o.code} ` : ""}${o.label}`,
            name: `${o.code ? `${o.code} ` : ""}${o.name}`,
            path: parts.slice(0, -1).join(": "),
            depth: o.depth,
            disabled: o.disabled,
          };
        }),
    );
  const expenses = {
    label: moneyOut ? "Expenses" : "Expenses (refunds)",
    items: items(["expense"]),
  };
  const income = { label: "Income", items: items(["income"]) };
  const transfers = {
    label: "Transfers and payments",
    items: items(["asset", "liability"]),
  };
  const other = { label: "Other", items: items(["equity"]) };
  const ordered = moneyOut
    ? [expenses, transfers, income, other]
    : [income, transfers, expenses, other];
  return ordered.filter((g) => g.items.length > 0);
}

/**
 * The category for a bank transaction: a searchable list. Suggestions (from a
 * rule or from your history) and matches come first; then accounts grouped
 * in plain words, money-out groups first for spending and income first for
 * deposits. Sub-accounts sit indented under their parents.
 */
export function CategoryPicker({
  id,
  label,
  value,
  onChange,
  groups,
  exclude,
  moneyOut,
  matches,
  suggested,
  splitLabel,
  disabled,
  invalid,
}: {
  id: string;
  /** The accessible name, for example "Category for Costco Gas". */
  label: string;
  value: string;
  onChange: (value: string) => void;
  groups: AccountOptionGroup[];
  /** The bank account itself, which can't be its own category. */
  exclude: string;
  moneyOut: boolean;
  matches: { value: string; label: string }[];
  suggested: { value: string; hint: "rule" | "learned" }[];
  splitLabel: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const [query, setQuery] = useState("");
  const all = useMemo(() => {
    const accountGroups = groupsFor(groups, exclude, moneyOut);
    const byId = new Map(accountGroups.flatMap((g) => g.items).map((i) => [i.value, i]));
    const top: PickGroup[] = [];
    const sugg: PickItem[] = suggested.flatMap((s) => {
      const item = byId.get(s.value);
      return item && !item.disabled ? [{ ...item, depth: 0, hint: s.hint }] : [];
    });
    if (sugg.length) top.push({ label: "Suggested", items: sugg });
    if (matches.length) {
      top.push({
        label: "Matches",
        items: matches.map((m) => ({
          value: m.value,
          label: m.label,
          name: m.label,
          path: "",
          depth: 0,
          disabled: false,
        })),
      });
    }
    const split: PickGroup = {
      label: "More",
      items: [
        {
          value: "split",
          label: splitLabel,
          name: splitLabel,
          path: "",
          depth: 0,
          disabled: false,
        },
      ],
    };
    return [...top, ...accountGroups, split];
  }, [groups, exclude, moneyOut, matches, suggested, splitLabel]);

  const selected = useMemo(() => {
    for (const g of all) {
      const hit = g.items.find((i) => i.value === value);
      if (hit) return hit;
    }
    return null;
  }, [all, value]);

  const searching = query.trim().length > 0;

  return (
    <Combobox.Root
      items={all}
      value={selected}
      onValueChange={(item) => {
        if (item) onChange((item as PickItem).value);
      }}
      onInputValueChange={setQuery}
      itemToStringLabel={(item: PickItem) => item.label}
      isItemEqualToValue={(a: PickItem, b: PickItem) => a.value === b.value}
      filter={(item: PickItem, q: string) => {
        const needle = q.trim().toLowerCase();
        if (!needle) return true;
        return `${item.label} ${item.name}`.toLowerCase().includes(needle);
      }}
      disabled={disabled}
    >
      <Combobox.Trigger
        id={id}
        aria-label={label}
        aria-invalid={invalid || undefined}
        className={`flex h-10 w-full min-w-0 items-center gap-2 rounded-lg border bg-surface px-3 text-left text-sm text-ink transition-colors duration-150 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-60 data-[popup-open]:border-[var(--focus)] lg:h-9 lg:text-[0.8125rem] ${
          invalid ? "border-negative" : "border-rule-strong/70"
        }`}
      >
        <span className={`min-w-0 flex-1 truncate ${selected ? "" : "text-ink-muted"}`}>
          {selected ? selected.label : "Choose a category"}
        </span>
        <ChevronDown size={15} aria-hidden className="shrink-0 text-ink-muted" />
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} align="start" className="z-50 outline-none">
          <Combobox.Popup className="flex max-h-[min(24rem,var(--available-height))] w-[max(var(--anchor-width),18rem)] origin-[var(--transform-origin)] flex-col overflow-hidden rounded-xl border border-rule bg-surface shadow-[var(--shadow-float)] outline-none transition-[scale,opacity] duration-150 ease-out data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0">
            <div className="relative border-b border-rule p-2">
              <Search
                size={15}
                aria-hidden
                className="pointer-events-none absolute left-4.5 top-1/2 -translate-y-1/2 text-ink-faint"
              />
              <Combobox.Input
                aria-label="Search categories"
                placeholder="Search categories"
                className="h-9 w-full rounded-md border border-rule bg-paper pl-8 pr-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-[var(--focus)]"
              />
            </div>
            <Combobox.Empty className="px-3 py-4 text-sm text-ink-muted empty:hidden">
              No category matches.
            </Combobox.Empty>
            <Combobox.List className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5 empty:hidden">
              {(group: PickGroup) => (
                <Combobox.Group key={group.label} items={group.items} className="pb-1">
                  <Combobox.GroupLabel className="sticky top-0 z-[1] bg-surface px-2.5 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-ink-muted">
                    {group.label}
                  </Combobox.GroupLabel>
                  <Combobox.Collection>
                    {(item: PickItem) => (
                      <Combobox.Item
                        key={`${group.label}:${item.value}`}
                        value={item}
                        disabled={item.disabled}
                        style={{
                          paddingLeft: `${0.625 + (searching ? 0 : item.depth) * 0.875}rem`,
                        }}
                        className="flex min-h-9 cursor-default select-none items-center gap-2 rounded-md pr-2.5 text-sm text-ink outline-none data-[disabled]:text-ink-faint data-[highlighted]:bg-sunken"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {searching || item.hint ? item.label : item.name}
                        </span>
                        {item.hint === "learned" ? (
                          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-ink-muted">
                            <Sparkles size={12} aria-hidden />
                            From your history
                          </span>
                        ) : item.hint === "rule" ? (
                          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-ink-muted">
                            <Wand2 size={12} aria-hidden />
                            Rule
                          </span>
                        ) : item.disabled && !searching ? (
                          <span className="shrink-0 text-xs text-ink-faint">Heading</span>
                        ) : null}
                        {selected?.value === item.value ? (
                          <Check size={14} aria-hidden className="shrink-0 text-signal-ink" />
                        ) : null}
                      </Combobox.Item>
                    )}
                  </Combobox.Collection>
                </Combobox.Group>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
