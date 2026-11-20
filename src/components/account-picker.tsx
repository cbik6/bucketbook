"use client";

import { Combobox } from "@base-ui/react/combobox";
import { Check, ChevronDown, Search, Sparkles, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { AccountOptionGroup } from "@/lib/account-options";

export type PickItem = {
  /** An account id, or "transfer:<id>", "link:<entryId>", "split", or "" for none. */
  value: string;
  /** What the button shows once picked: the full path, "Food: Groceries". */
  label: string;
  /** The account's own name, shown indented under its parent in the list. */
  name: string;
  depth: number;
  disabled: boolean;
  /** A parent the book keeps as a heading. */
  heading?: boolean;
  /** Why it is suggested. */
  hint?: "rule" | "learned";
};

type PickGroup = { label: string; items: PickItem[] };

/**
 * How the account groups are named and ordered. "out" and "in" use plain
 * words for categorizing money (spending puts Expenses first, deposits put
 * Income first); "chart" keeps the chart of accounts' own types and order.
 */
export type PickOrder = "out" | "in" | "chart";

function accountGroups(
  groups: AccountOptionGroup[],
  exclude: string | undefined,
  order: PickOrder,
  value: string,
): PickGroup[] {
  const toItems = (g: AccountOptionGroup | undefined) =>
    (g?.options ?? [])
      .filter((o) => o.id !== exclude)
      .map<PickItem>((o) => ({
        value: o.id,
        label: `${o.code ? `${o.code} ` : ""}${o.label}`,
        name: `${o.code ? `${o.code} ` : ""}${o.name}`,
        depth: o.depth,
        // The current value stays pickable so an older entry can be kept as it is.
        disabled: o.disabled && o.id !== value,
        heading: o.disabled && o.isParent,
      }));
  if (order === "chart") {
    return groups
      .map((g) => ({ label: g.label, items: toItems(g) }))
      .filter((g) => g.items.length > 0);
  }
  const byType = new Map(groups.map((g) => [g.type, g]));
  const of = (...types: AccountOptionGroup["type"][]) =>
    types.flatMap((t) => toItems(byType.get(t)));
  const expenses = {
    label: order === "out" ? "Expenses" : "Expenses (refunds)",
    items: of("expense"),
  };
  const income = { label: "Income", items: of("income") };
  const transfers = { label: "Transfers and payments", items: of("asset", "liability") };
  const other = { label: "Other", items: of("equity") };
  const ordered =
    order === "out" ? [expenses, transfers, income, other] : [income, transfers, expenses, other];
  return ordered.filter((g) => g.items.length > 0);
}

const plain = (value: string, label: string): PickItem => ({
  value,
  label,
  name: label,
  depth: 0,
  disabled: false,
});

/**
 * A searchable account list, used wherever an account or category is chosen.
 * Suggestions (from a rule or from your history) and matches come first;
 * then the accounts in groups, with sub-accounts indented under their parents
 * and parents kept as headings when the book says so.
 */
export function AccountPicker({
  id,
  label,
  value,
  onChange,
  groups,
  exclude,
  order = "chart",
  placeholder = "Choose an account",
  noneLabel,
  matches = [],
  suggested = [],
  splitLabel,
  disabled,
  invalid,
  size = "regular",
}: {
  id?: string;
  /** The accessible name, when no <label> points at `id`. */
  label?: string;
  value: string;
  onChange: (value: string) => void;
  groups: AccountOptionGroup[];
  /** An account that can't be picked here, for example the bank account itself. */
  exclude?: string;
  order?: PickOrder;
  placeholder?: string;
  /** Offer a way back to no account, for example "No category". */
  noneLabel?: string;
  matches?: { value: string; label: string }[];
  suggested?: { value: string; hint: "rule" | "learned" }[];
  /** Adds the "split" choice at the end with this label. */
  splitLabel?: string;
  disabled?: boolean;
  invalid?: boolean;
  size?: "regular" | "row";
}) {
  const [query, setQuery] = useState("");
  const all = useMemo(() => {
    const accounts = accountGroups(groups, exclude, order, value);
    const byId = new Map(accounts.flatMap((g) => g.items).map((i) => [i.value, i]));
    const top: PickGroup[] = [];
    if (noneLabel) top.push({ label: "", items: [plain("", noneLabel)] });
    const sugg: PickItem[] = suggested.flatMap((s) => {
      const item = byId.get(s.value);
      return item && !item.disabled ? [{ ...item, depth: 0, hint: s.hint }] : [];
    });
    if (sugg.length) top.push({ label: "Suggested", items: sugg });
    if (matches.length) {
      top.push({ label: "Matches", items: matches.map((m) => plain(m.value, m.label)) });
    }
    const bottom: PickGroup[] = splitLabel
      ? [{ label: "More", items: [plain("split", splitLabel)] }]
      : [];
    return [...top, ...accounts, ...bottom];
  }, [groups, exclude, order, value, noneLabel, matches, suggested, splitLabel]);

  const selected = useMemo(() => {
    for (const g of all) {
      const hit = g.items.find((i) => i.value === value);
      if (hit) return hit;
    }
    return null;
  }, [all, value]);

  const searching = query.trim().length > 0;
  const noun = order === "chart" ? "account" : "category";

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
        className={`flex w-full min-w-0 items-center gap-2 rounded-lg border bg-surface px-3 text-left text-sm text-ink transition-colors duration-150 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-60 data-[popup-open]:border-[var(--focus)] ${
          size === "row" ? "h-10 lg:h-9 lg:text-[0.8125rem]" : "h-10"
        } ${invalid ? "border-negative" : "border-rule-strong/70"}`}
      >
        <span
          className={`min-w-0 flex-1 truncate ${selected && selected.value ? "" : "text-ink-muted"}`}
        >
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={15} aria-hidden className="shrink-0 text-ink-muted" />
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} align="start" className="z-50 outline-none">
          <Combobox.Popup className="flex max-h-[min(24rem,var(--available-height))] w-[max(var(--anchor-width),18rem)] max-w-[calc(100vw-2rem)] origin-[var(--transform-origin)] flex-col overflow-hidden rounded-xl border border-rule bg-surface shadow-[var(--shadow-float)] outline-none transition-[scale,opacity] duration-150 ease-out data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0">
            <div className="relative border-b border-rule p-2">
              <Search
                size={15}
                aria-hidden
                className="pointer-events-none absolute left-4.5 top-1/2 -translate-y-1/2 text-ink-faint"
              />
              <Combobox.Input
                aria-label={noun === "account" ? "Search accounts" : "Search categories"}
                placeholder={noun === "account" ? "Search accounts" : "Search categories"}
                className="h-9 w-full rounded-md border border-rule bg-paper pl-8 pr-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-[var(--focus)]"
              />
            </div>
            <Combobox.Empty className="px-3 py-4 text-sm text-ink-muted empty:hidden">
              No {noun} matches.
            </Combobox.Empty>
            <Combobox.List className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5 empty:hidden">
              {(group: PickGroup) => (
                <Combobox.Group key={group.label} items={group.items} className="pb-1">
                  {group.label ? (
                    <Combobox.GroupLabel className="sticky top-0 z-[1] bg-surface px-2.5 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-ink-muted">
                      {group.label}
                    </Combobox.GroupLabel>
                  ) : null}
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
                        <span
                          className={`min-w-0 flex-1 truncate ${item.value ? "" : "text-ink-muted"}`}
                        >
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
                        ) : item.heading && !searching ? (
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
