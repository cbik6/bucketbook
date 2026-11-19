"use client";

import {
  ArrowLeftRight,
  ChevronDown,
  Copy,
  Link2,
  Plus,
  Search,
  Split as SplitIcon,
  Undo2,
  Wand2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { AccountSelectOptions } from "@/components/account-select-options";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { SelectInput, TextInput } from "@/components/ui/field";
import type { AccountOptionGroup } from "@/lib/account-options";
import { formatDay } from "@/lib/dates";
import { formatEntryNumber } from "@/lib/ledger-math";
import { splitPayment } from "@/lib/loans";
import { formatCents, parseCents } from "@/lib/money";
import { suggestRuleText } from "@/lib/rules";
import type { Decision, QueueItem } from "@/server/bank/review-service";
import { type AttachmentInfo, Attachments } from "../attachments";
import { RuleEditor } from "../rules/rules-manager";
import {
  type ReviewResult,
  approveAction,
  bulkAction,
  excludeAction,
  excludeManyAction,
  keepBothAction,
  linkAction,
  restoreAction,
  transferAction,
  undoApproveAction,
} from "./actions";

export type { AttachmentInfo };

type RuleOptions = {
  bankAccounts: { id: string; name: string }[];
  buckets: { id: string; label: string }[];
};

export type LoanHint = {
  accountId: string;
  interestAccountId: string;
  rateMicro: number;
  owedCents: number;
};

type Split = { key: number; accountId: string; amount: string; memo: string };

type Draft = {
  /** An account id, or "transfer:<id>", "link:<entryId>", "split", or "". */
  choice: string;
  payee: string;
  memo: string;
  saveRule: boolean;
  splits: Split[];
  counterpart: string;
  partnerCounterpart: string;
  /** For an account with buckets: which bucket the money comes from or goes to. */
  bucketId: string;
};

let splitKey = 1;
const newSplit = (accountId = "", amount = ""): Split => ({
  key: splitKey++,
  accountId,
  amount,
  memo: "",
});

function defaultDraft(item: QueueItem): Draft {
  const link = item.linkCandidates[0];
  const choice = link
    ? `link:${link.entryId}`
    : item.transfer && (item.suggestedTransfer || !item.suggestedAccountId)
      ? `transfer:${item.transfer.id}`
      : (item.suggestedAccountId ?? (item.transfer ? `transfer:${item.transfer.id}` : ""));
  return {
    choice,
    payee: item.suggestedPayee ?? item.payee ?? item.description,
    memo: item.suggestedMemo ?? "",
    saveRule: false,
    splits: [],
    bucketId: item.suggestedBucketId ?? "",
    counterpart: item.transfer?.counterpartAccountId ?? "",
    partnerCounterpart: item.transfer?.partnerCounterpartAccountId ?? "",
  };
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.tagName === "INPUT" ||
    el.tagName === "SELECT" ||
    el.tagName === "TEXTAREA" ||
    el.isContentEditable);

/** Does a row match the search box: words in its text, or digits in its amount. */
function matchesSearch(item: QueueItem, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const text = [item.description, item.payee, item.suggestedPayee, item.bankMemo, item.accountName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (text.includes(q)) return true;
  const digits = q.replace(/[$,\s]/g, "");
  return (
    /^\d*\.?\d+$/.test(digits) && plainAmount(item.amountCents).replace(/,/g, "").includes(digits)
  );
}

/**
 * The review queue, laid out like a bank feed: one row per bank transaction
 * with Spent and Received columns, prefilled from rules, transfer matches and
 * existing entries. Add one at a time or select several. Keyboard: J and K
 * (or arrows) move, Enter opens details, A adds, X selects, E excludes.
 */
export function ReviewQueue({
  bookId,
  items,
  groups,
  partnerGroups,
  attachments,
  buckets,
  loans,
  ruleOptions,
  canEdit,
  showAccount,
}: {
  bookId: string;
  /** False when one account is showing, so rows skip its name. */
  showAccount: boolean;
  /** What the rule editor offers: bank accounts to limit to, and buckets. */
  ruleOptions: RuleOptions;
  loans: LoanHint[];
  buckets: Record<string, { id: string; name: string; isUnassigned: boolean }[]>;
  items: QueueItem[];
  groups: AccountOptionGroup[];
  partnerGroups: Record<string, AccountOptionGroup[]>;
  attachments: Record<string, AttachmentInfo[]>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const uid = useId();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null);
  // Each row saves on its own, so a second approve never steals the first row's state.
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const markBusy = (id: string, on: boolean) =>
    setBusy((b) => {
      const n = new Set(b);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [bulkPending, startBulk] = useTransition();
  const [, startRow] = useTransition();
  const rowRefs = useRef(new Map<string, HTMLLIElement>());

  const shown = useMemo(() => items.filter((i) => matchesSearch(i, query)), [items, query]);
  const ids = useMemo(() => new Set(shown.map((i) => i.id)), [shown]);
  const draftFor = (item: QueueItem) => drafts[item.id] ?? defaultDraft(item);
  const setDraft = (item: QueueItem, patch: Partial<Draft>) => {
    setDrafts((d) => ({ ...d, [item.id]: { ...(d[item.id] ?? defaultDraft(item)), ...patch } }));
    // A new category (or leaving a split) makes the last error about this row stale.
    if (patch.choice !== undefined)
      setErrors((e) => {
        if (!(item.id in e)) return e;
        const { [item.id]: _, ...rest } = e;
        return rest;
      });
  };

  // Keep selection and focus pointing at rows that still exist after a refresh.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- rows vanish when the server list changes
    setSelected((s) => new Set([...s].filter((id) => ids.has(id))));
    if (activeId && !ids.has(activeId)) setActiveId(shown[0]?.id ?? null);
  }, [ids, activeId, shown]);

  const focusRow = (id: string | undefined) => {
    if (!id) return;
    setActiveId(id);
    rowRefs.current.get(id)?.focus();
  };

  const finish = (item: QueueItem, r: ReviewResult, undo?: "approve" | "exclude") => {
    markBusy(item.id, false);
    if (!r.ok) {
      setErrors((e) => ({ ...e, [item.id]: r.error ?? "That didn't work." }));
      if (r.field === "counterpart" || r.field === "splits") setExpanded(item.id);
      return;
    }
    setErrors((e) => {
      const { [item.id]: _, ...rest } = e;
      return rest;
    });
    const index = shown.findIndex((i) => i.id === item.id);
    const next = shown[index + 1] ?? shown[index - 1];
    if (next) setActiveId(next.id);
    if (expanded === item.id) setExpanded(null);
    const entryId = r.entryId;
    const undoIt = async () => {
      const u =
        undo === "exclude"
          ? await restoreAction(bookId, item.id)
          : await undoApproveAction(bookId, entryId!);
      if (u.ok) toast.success(u.message);
      else toast.error(u.error);
    };
    toast.success(r.message ?? "Done.", {
      // A linked match added nothing to the books, so there is nothing to reverse.
      action:
        undo === "exclude" || (undo === "approve" && entryId && !r.message?.startsWith("Matched"))
          ? { label: "Undo", onClick: () => void undoIt() }
          : undefined,
      cancel: entryId
        ? {
            label: "View entry",
            onClick: () => router.push(`/books/${bookId}/journal/${entryId}`),
          }
        : undefined,
    });
  };

  const approve = (item: QueueItem) => {
    if (!canEdit || busy.has(item.id)) return;
    const d = draftFor(item);
    markBusy(item.id, true);
    startRow(async () => {
      let r: ReviewResult;
      if (d.choice === "split") {
        r = await approveAction(bookId, item.id, {
          splits: d.splits.map(({ accountId, amount, memo }) => ({ accountId, amount, memo })),
          payee: d.payee,
          memo: d.memo,
          bucketId: d.bucketId || undefined,
        });
      } else if (d.choice.startsWith("transfer:")) {
        r = await transferAction(bookId, item.id, {
          partnerId: d.choice.slice(9),
          counterpartAccountId: d.counterpart || undefined,
          partnerCounterpartAccountId: d.partnerCounterpart || undefined,
          bucketId: d.bucketId || undefined,
        });
      } else if (d.choice.startsWith("link:")) {
        r = await linkAction(bookId, item.id, d.choice.slice(5));
      } else if (!d.choice) {
        r = { ok: false, error: "Pick a category first." };
      } else {
        r = await approveAction(bookId, item.id, {
          accountId: d.choice,
          payee: d.payee,
          memo: d.memo,
          saveRule: d.saveRule,
          bucketId: d.bucketId || undefined,
        });
      }
      finish(item, r, "approve");
    });
  };

  const exclude = (item: QueueItem) => {
    if (!canEdit || busy.has(item.id)) return;
    markBusy(item.id, true);
    startRow(async () => finish(item, await excludeAction(bookId, item.id), "exclude"));
  };

  const selectedItems = shown.filter((i) => selected.has(i.id));
  const approveSelected = () =>
    startBulk(async () => {
      const decisions: Decision[] = [];
      let unready = 0;
      for (const item of selectedItems) {
        const d = draftFor(item);
        if (d.choice.startsWith("transfer:")) {
          decisions.push({ id: item.id, kind: "transfer", partnerId: d.choice.slice(9) });
        } else if (d.choice.startsWith("link:")) {
          decisions.push({ id: item.id, kind: "link", entryId: d.choice.slice(5) });
        } else if (d.choice && d.choice !== "split") {
          decisions.push({ id: item.id, kind: "account", accountId: d.choice });
        } else unready += 1;
      }
      if (decisions.length === 0) {
        toast.error("Pick a category for the selected transactions first.");
        return;
      }
      const r = await bulkAction(bookId, decisions);
      if (!r.ok) toast.error(r.error);
      else
        toast.success(r.message, {
          description: unready ? `${unready} without a category were left for you.` : undefined,
        });
      setSelected(new Set());
    });

  const excludeSelected = () =>
    startBulk(async () => {
      const r = await excludeManyAction(
        bookId,
        selectedItems.map((i) => i.id),
      );
      if (r.ok) toast.success(r.message);
      else toast.error(r.error);
      setSelected(new Set());
    });

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTyping(e.target)) {
      if (e.key === "Escape" && activeId) {
        e.preventDefault();
        rowRefs.current.get(activeId)?.focus();
      }
      return;
    }
    const index = shown.findIndex((i) => i.id === activeId);
    const item = shown[index];
    switch (e.key) {
      case "j":
      case "ArrowDown":
        e.preventDefault();
        focusRow(shown[Math.min(index + 1, shown.length - 1)]?.id);
        break;
      case "k":
      case "ArrowUp":
        e.preventDefault();
        focusRow(shown[Math.max(index - 1, 0)]?.id);
        break;
      case "Enter":
        if (item && e.target === rowRefs.current.get(item.id)) {
          e.preventDefault();
          setExpanded((x) => (x === item.id ? null : item.id));
        }
        break;
      case "a":
        if (item) {
          e.preventDefault();
          approve(item);
        }
        break;
      case "x":
        if (item) {
          e.preventDefault();
          setSelected((s) => {
            const n = new Set(s);
            if (n.has(item.id)) n.delete(item.id);
            else n.add(item.id);
            return n;
          });
        }
        break;
      case "e":
        if (item) {
          e.preventDefault();
          exclude(item);
        }
        break;
    }
  };

  if (items.length === 0) {
    return (
      <div className="flex max-w-prose flex-col gap-2 py-10">
        <p className="text-[0.9375rem] font-semibold text-ink">All caught up.</p>
        <p className="text-sm text-ink-muted">
          New transactions arrive with each sync from your{" "}
          <Link
            href={`/books/${bookId}/connections`}
            className="text-signal-ink underline underline-offset-2"
          >
            bank connections
          </Link>
          , or{" "}
          <Link
            href={`/books/${bookId}/import`}
            className="text-signal-ink underline underline-offset-2"
          >
            import a CSV or PDF statement
          </Link>
          .
        </p>
      </div>
    );
  }

  const allSelected = shown.length > 0 && shown.every((i) => selected.has(i.id));

  return (
    <div className="flex flex-col">
      <div
        className="sticky top-0 z-10 flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 border-b border-rule bg-paper py-2.5"
        aria-live="polite"
      >
        {canEdit ? (
          <label className="flex items-center gap-2 pl-1 text-[0.8125rem] text-ink-muted">
            <input
              type="checkbox"
              className="size-4 accent-[var(--signal)]"
              checked={allSelected}
              onChange={() =>
                setSelected(allSelected ? new Set() : new Set(shown.map((i) => i.id)))
              }
            />
            {selected.size > 0 ? `${selected.size} selected` : "Select all"}
          </label>
        ) : null}
        {selected.size > 0 ? (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="primary"
              onClick={approveSelected}
              pending={bulkPending}
              pendingLabel="Adding"
            >
              Add {selected.size}
            </Button>
            <Button size="sm" variant="ghost" onClick={excludeSelected} disabled={bulkPending}>
              Exclude {selected.size}
            </Button>
          </div>
        ) : (
          <span className="tabular text-[0.8125rem] text-ink-muted">
            {query ? `${shown.length} of ${items.length}` : `${items.length} waiting`}
          </span>
        )}
        <label className="relative ml-auto w-full sm:w-72">
          <span className="sr-only">Search transactions</span>
          <Search
            size={15}
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <TextInput
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by description or amount"
            autoComplete="off"
            className="h-9 pl-9 text-[0.8125rem]"
          />
        </label>
      </div>
      <div
        aria-hidden
        className="hidden grid-cols-[1.75rem_5.75rem_minmax(0,1fr)_minmax(13rem,19rem)_6.5rem_6.5rem_5.5rem] gap-3 border-b border-rule-strong bg-sunken/60 px-2 py-2 text-xs font-medium uppercase tracking-wide text-ink-muted lg:grid"
      >
        <span />
        <span>Date</span>
        <span>Description</span>
        <span>Category or match</span>
        <span className="text-right">Spent</span>
        <span className="text-right">Received</span>
        <span className="text-right">Action</span>
      </div>
      {shown.length === 0 ? (
        <p className="py-8 text-sm text-ink-muted">
          Nothing matches &ldquo;{query}&rdquo;.{" "}
          <button
            type="button"
            onClick={() => setQuery("")}
            className="text-signal-ink underline underline-offset-2"
          >
            Clear the search
          </button>
        </p>
      ) : null}
      <ol className="flex flex-col" onKeyDown={onKeyDown} aria-label="Transactions to review">
        {shown.map((item) => (
          <Row
            key={item.id}
            uid={uid}
            item={item}
            bookId={bookId}
            draft={draftFor(item)}
            setDraft={(p) => setDraft(item, p)}
            groups={groups}
            partnerGroups={item.transfer ? partnerGroups[item.transfer.bookId] : undefined}
            files={attachments[item.id] ?? []}
            buckets={buckets[item.accountId]}
            loans={loans}
            ruleOptions={ruleOptions}
            showAccount={showAccount}
            active={item.id === activeId}
            selected={selected.has(item.id)}
            expanded={expanded === item.id}
            busy={busy.has(item.id)}
            error={errors[item.id]}
            canEdit={canEdit}
            onFocus={() => setActiveId(item.id)}
            onToggleSelect={() =>
              setSelected((s) => {
                const n = new Set(s);
                if (n.has(item.id)) n.delete(item.id);
                else n.add(item.id);
                return n;
              })
            }
            onToggleExpand={() => setExpanded((x) => (x === item.id ? null : item.id))}
            onApprove={() => approve(item)}
            onExclude={() => exclude(item)}
            onKeepBoth={() => {
              if (busy.has(item.id)) return;
              markBusy(item.id, true);
              startRow(async () => {
                const r = await keepBothAction(bookId, item.id);
                markBusy(item.id, false);
                if (r.ok) toast.success(r.message);
                else toast.error(r.error);
              });
            }}
            refCallback={(el) => {
              if (el) rowRefs.current.set(item.id, el);
              else rowRefs.current.delete(item.id);
            }}
          />
        ))}
      </ol>
      <p className="mt-3 hidden text-xs text-ink-muted lg:block">
        <Kbd>J</Kbd> <Kbd>K</Kbd> move, <Kbd>Enter</Kbd> details, <Kbd>A</Kbd> add, <Kbd>X</Kbd>{" "}
        select, <Kbd>E</Kbd> exclude
      </p>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-rule bg-surface px-1 font-sans text-[0.6875rem] text-ink-muted">
      {children}
    </kbd>
  );
}

type RowProps = {
  uid: string;
  item: QueueItem;
  bookId: string;
  draft: Draft;
  setDraft: (patch: Partial<Draft>) => void;
  groups: AccountOptionGroup[];
  partnerGroups?: AccountOptionGroup[];
  files: AttachmentInfo[];
  buckets?: { id: string; name: string; isUnassigned: boolean }[];
  loans: LoanHint[];
  ruleOptions: RuleOptions;
  showAccount: boolean;
  active: boolean;
  selected: boolean;
  expanded: boolean;
  busy: boolean;
  error?: string;
  canEdit: boolean;
  onFocus: () => void;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onApprove: () => void;
  onExclude: () => void;
  onKeepBoth: () => void;
  refCallback: (el: HTMLLIElement | null) => void;
};

type RowData = Omit<RowProps, "refCallback">;

function Row({ refCallback, ...p }: RowProps) {
  const { item, draft } = p;
  const base = `${p.uid}-${item.id}`;
  const title = item.suggestedPayee ?? item.payee ?? item.description;
  const transfer = item.transfer;
  const crossBook = transfer && transfer.bookId !== p.bookId;
  const isSplit = draft.choice === "split";

  const chooseCategory = (value: string) => {
    if (value === "split") {
      const start = draft.choice && !draft.choice.includes(":") ? draft.choice : "";
      p.setDraft({
        choice: "split",
        splits: draft.splits.length
          ? draft.splits
          : [newSplit(start, plainAmount(item.amountCents)), newSplit()],
      });
      if (!p.expanded) p.onToggleExpand();
    } else {
      // A payment to a loan splits into principal and interest, ready to edit.
      const loan = p.loans.find((l) => l.accountId === value);
      if (loan && item.amountCents < 0) {
        const { interestCents, principalCents } = splitPayment(
          -item.amountCents,
          loan.owedCents,
          loan.rateMicro,
        );
        const lines = [newSplit(loan.accountId, plainAmount(principalCents))];
        if (interestCents > 0)
          lines.push(newSplit(loan.interestAccountId, plainAmount(interestCents)));
        if (lines.length > 1) {
          p.setDraft({ choice: "split", splits: lines });
          if (!p.expanded) p.onToggleExpand();
          return;
        }
      }
      p.setDraft({ choice: value });
    }
  };

  const spent = item.amountCents < 0;
  const isMatch = draft.choice.startsWith("transfer:") || draft.choice.startsWith("link:");

  return (
    <li
      ref={refCallback}
      tabIndex={p.active ? 0 : -1}
      onFocus={(e) => {
        if (e.target === e.currentTarget) p.onFocus();
      }}
      onClickCapture={p.onFocus}
      aria-label={`${formatDay(item.postedDate)}, ${title}, ${formatCents(item.amountCents)}`}
      className={`group border-b border-rule outline-none transition-colors duration-150 focus-visible:bg-sunken focus-visible:shadow-[inset_3px_0_0_var(--focus)] focus-within:shadow-[inset_3px_0_0_var(--focus)] ${
        p.selected ? "bg-signal-soft/60" : p.expanded ? "bg-sunken/50" : "hover:bg-sunken/40"
      }`}
    >
      <div className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] gap-x-3 gap-y-2 px-2 py-3 lg:grid-cols-[1.75rem_5.75rem_minmax(0,1fr)_minmax(13rem,19rem)_6.5rem_6.5rem_5.5rem] lg:items-center lg:py-2">
        <div className="row-span-2 pt-0.5 lg:row-span-1 lg:pt-0">
          {p.canEdit ? (
            // The label pads the checkbox to a finger-sized target without moving it.
            <label className="-m-3 inline-flex p-3">
              <input
                type="checkbox"
                aria-label={`Select ${title}`}
                className="size-4 accent-[var(--signal)]"
                checked={p.selected}
                onChange={p.onToggleSelect}
                tabIndex={-1}
              />
            </label>
          ) : null}
        </div>
        <div className="tabular hidden whitespace-nowrap text-sm text-ink-muted lg:block">
          {formatDay(item.postedDate)}
        </div>
        <div className="min-w-0">
          <button
            type="button"
            onClick={p.onToggleExpand}
            aria-expanded={p.expanded}
            aria-controls={`${base}-details`}
            className="group/title flex max-w-full items-center gap-1 text-left"
            tabIndex={-1}
          >
            <span className="truncate font-medium text-ink">{title}</span>
            <ChevronDown
              size={14}
              aria-hidden
              className={`shrink-0 text-ink-faint transition-transform duration-150 ${p.expanded ? "rotate-180" : ""}`}
            />
          </button>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] text-ink-muted">
            <span className="tabular lg:hidden">{formatDay(item.postedDate)}</span>
            {p.showAccount ? <span>{item.accountName}</span> : null}
            {title !== item.description ? (
              // On a phone the bank's text gets its own line under the date.
              <span className="min-w-0 basis-full truncate lg:basis-auto">
                {p.showAccount ? (
                  <span aria-hidden className="hidden lg:inline">
                    ·{" "}
                  </span>
                ) : null}
                {item.description}
              </span>
            ) : null}
            <Badges item={item} />
          </div>
        </div>
        {/* On a phone, one signed amount; on a wide screen, Spent and Received columns. */}
        <div className="text-right lg:hidden">
          <Money cents={item.amountCents} className="font-medium" />
        </div>

        <div className="col-start-2 row-start-2 flex min-w-0 flex-col gap-1.5 lg:col-start-4 lg:row-start-1">
          {p.buckets && p.buckets.length > 0 ? (
            <SelectInput
              aria-label={`${spent ? "Bucket it comes from" : "Bucket it goes to"} for ${title}`}
              value={draft.bucketId || p.buckets.find((b) => b.isUnassigned)?.id || ""}
              onChange={(e) => p.setDraft({ bucketId: e.target.value })}
              disabled={!p.canEdit}
              className="h-9 text-[0.8125rem]"
            >
              {p.buckets.map((b) => (
                <option key={b.id} value={b.id}>
                  {spent ? "From" : "Into"} {b.name}
                </option>
              ))}
            </SelectInput>
          ) : null}
          {/* Split stays a choice in the same list, so picking a category backs out of it. */}
          <SelectInput
            id={`${base}-category`}
            aria-label={`Category for ${title}`}
            value={draft.choice}
            onChange={(e) => chooseCategory(e.target.value)}
            disabled={!p.canEdit}
            invalid={Boolean(p.error) && !draft.choice}
            className="lg:h-9 lg:text-[0.8125rem]"
          >
            <option value="">Choose a category</option>
            {item.linkCandidates.length || transfer ? (
              <optgroup label="Matches">
                {item.linkCandidates.map((c) => (
                  <option key={c.entryId} value={`link:${c.entryId}`}>
                    Already recorded: {formatEntryNumber(c.entryNumber)}, {formatDay(c.entryDate)}
                  </option>
                ))}
                {transfer ? (
                  <option value={`transfer:${transfer.id}`}>
                    Transfer {spent ? "to" : "from"} {transfer.accountName}
                    {crossBook ? ` (${transfer.bookName})` : ""}
                  </option>
                ) : null}
              </optgroup>
            ) : null}
            <AccountSelectOptions groups={p.groups} value={draft.choice} exclude={item.accountId} />
            <optgroup label="More">
              <option value="split">
                {isSplit ? `Split into ${draft.splits.length} lines` : "Split across accounts"}
              </option>
            </optgroup>
          </SelectInput>
        </div>
        <div className="tabular hidden text-right text-sm font-medium text-ink lg:col-start-5 lg:row-start-1 lg:block">
          {spent ? formatCents(-item.amountCents) : null}
        </div>
        <div className="tabular hidden text-right text-sm font-medium text-ink lg:col-start-6 lg:row-start-1 lg:block">
          {spent ? null : formatCents(item.amountCents)}
        </div>
        <div className="col-start-3 row-start-2 flex items-center justify-end gap-1 lg:col-start-7 lg:row-start-1">
          {p.canEdit ? (
            <Button
              // Every row's button looks the same; the row itself shows keyboard focus.
              variant="secondary"
              className="min-w-[4.5rem] lg:h-8 lg:px-3 lg:text-[0.8125rem]"
              onClick={p.onApprove}
              pending={p.busy}
              pendingLabel="Saving"
              aria-label={`${isMatch ? "Match" : "Add"} ${title}`}
            >
              {isMatch ? "Match" : "Add"}
            </Button>
          ) : null}
        </div>
      </div>

      {p.error ? (
        <p role="alert" className="-mt-1 pb-2 pl-12 text-[0.8125rem] text-negative">
          {p.error}
        </p>
      ) : null}

      {item.duplicateOf ? (
        <div className="mx-2 mb-3 flex flex-col lg:ml-12 gap-2 rounded-lg bg-sunken px-3 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-ink">
            <Copy size={14} aria-hidden className="mr-1.5 inline text-ink-muted" />
            Looks like a duplicate of {formatDay(item.duplicateOf.postedDate)} &ldquo;
            {item.duplicateOf.description}&rdquo;
            {item.duplicateOf.status === "posted" ? ", already recorded" : ", also in review"}.
          </p>
          {p.canEdit ? (
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="secondary" onClick={p.onExclude} disabled={p.busy}>
                It&apos;s a duplicate
              </Button>
              <Button size="sm" variant="ghost" onClick={p.onKeepBoth} disabled={p.busy}>
                Keep both
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {p.expanded ? (
        <Details
          {...p}
          base={base}
          crossBook={Boolean(crossBook)}
          isSplit={isSplit}
          title={title}
          onSplit={() => chooseCategory("split")}
        />
      ) : (
        <div id={`${base}-details`} hidden />
      )}
    </li>
  );
}

function Badges({ item }: { item: QueueItem }) {
  return (
    <>
      {item.suggestedRuleName ? (
        <span className="inline-flex items-center gap-1 rounded bg-sunken px-1.5 py-px text-xs text-ink-muted">
          <Wand2 size={11} aria-hidden />
          Rule: {item.suggestedRuleName}
        </span>
      ) : null}
      {item.transfer ? (
        <span className="inline-flex items-center gap-1 rounded bg-sunken px-1.5 py-px text-xs text-ink-muted">
          <ArrowLeftRight size={11} aria-hidden />
          Transfer match
        </span>
      ) : null}
      {item.linkCandidates.length ? (
        <span className="inline-flex items-center gap-1 rounded bg-sunken px-1.5 py-px text-xs text-ink-muted">
          <Link2 size={11} aria-hidden />
          Already recorded?
        </span>
      ) : null}
    </>
  );
}

const plainAmount = (cents: number) => formatCents(Math.abs(cents), { showSymbol: false });

type Mode = "categorize" | "match" | "transfer";

function Details(
  p: RowData & {
    base: string;
    crossBook: boolean;
    isSplit: boolean;
    title: string;
    onSplit: () => void;
  },
) {
  const { item, draft } = p;
  const choice = draft.choice;
  const plainAccount = choice && !choice.includes(":") && choice !== "split";
  const [ruleOpen, setRuleOpen] = useState(false);
  const mode: Mode = choice.startsWith("link:")
    ? "match"
    : choice.startsWith("transfer:")
      ? "transfer"
      : "categorize";
  const modes: { id: Mode; label: string }[] = [
    { id: "categorize", label: "Categorize" },
    ...(item.linkCandidates.length ? [{ id: "match" as const, label: "Find match" }] : []),
    ...(item.transfer ? [{ id: "transfer" as const, label: "Record as transfer" }] : []),
  ];
  const setMode = (m: Mode) => {
    if (m === mode) return;
    if (m === "match") p.setDraft({ choice: `link:${item.linkCandidates[0]!.entryId}` });
    else if (m === "transfer") p.setDraft({ choice: `transfer:${item.transfer!.id}` });
    else p.setDraft({ choice: item.suggestedAccountId ?? "" });
  };
  const isMatch = mode !== "categorize";

  return (
    <div
      id={`${p.base}-details`}
      className="mx-2 mb-4 flex flex-col gap-4 rounded-xl border border-rule bg-surface p-4 lg:ml-12"
    >
      {modes.length > 1 && p.canEdit ? (
        <div
          role="radiogroup"
          aria-label={`What to do with ${p.title}`}
          className="flex flex-wrap gap-x-5 gap-y-2"
        >
          {modes.map((m) => (
            <label key={m.id} className="flex items-center gap-2 text-sm font-medium text-ink">
              <input
                type="radio"
                name={`${p.base}-mode`}
                className="size-4 accent-[var(--signal)]"
                checked={mode === m.id}
                onChange={() => setMode(m.id)}
              />
              {m.label}
            </label>
          ))}
        </div>
      ) : null}

      {item.bankMemo ||
      (item.payee && item.payee !== item.description) ||
      item.source === "csv" ||
      item.source === "pdf" ? (
        <p className="text-[0.8125rem] text-ink-muted">
          {item.source === "csv" || item.source === "pdf"
            ? `From a ${item.source.toUpperCase()} import: `
            : "From the bank: "}
          {item.description}
          {item.bankMemo && item.bankMemo !== item.description ? `, ${item.bankMemo}` : ""}
        </p>
      ) : null}

      {mode === "transfer" && item.transfer ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink">
            {formatCents(Math.abs(item.amountCents))} {item.amountCents < 0 ? "left" : "arrived in"}{" "}
            {item.accountName} on {formatDay(item.postedDate)} and{" "}
            {item.amountCents < 0 ? "arrived in" : "left"} {item.transfer.accountName}
            {p.crossBook ? ` (${item.transfer.bookName})` : ""} on{" "}
            {formatDay(item.transfer.postedDate)}. Matching records both sides at once.
          </p>
          {p.crossBook ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-[0.8125rem] font-medium text-ink">
                In this book, the account for {item.transfer.bookName}
                <SelectInput
                  value={draft.counterpart}
                  onChange={(e) => p.setDraft({ counterpart: e.target.value })}
                >
                  <option value="">Choose an account</option>
                  <AccountSelectOptions
                    groups={p.groups}
                    value={draft.counterpart}
                    exclude={item.accountId}
                  />
                </SelectInput>
                <span className="font-normal text-ink-muted">
                  For example Investment in {item.transfer.bookName}, or Owner Draws.
                </span>
              </label>
              <label className="flex flex-col gap-1.5 text-[0.8125rem] font-medium text-ink">
                In {item.transfer.bookName}, the account for this book
                <SelectInput
                  value={draft.partnerCounterpart}
                  onChange={(e) => p.setDraft({ partnerCounterpart: e.target.value })}
                >
                  <option value="">Choose an account</option>
                  {p.partnerGroups ? (
                    <AccountSelectOptions
                      groups={p.partnerGroups}
                      value={draft.partnerCounterpart}
                    />
                  ) : null}
                </SelectInput>
                <span className="font-normal text-ink-muted">
                  For example Owner Contributions. Both are remembered for next time.
                </span>
              </label>
            </div>
          ) : null}
        </div>
      ) : null}

      {mode === "match" ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm text-ink">
            These entries already record {formatCents(Math.abs(item.amountCents))} on{" "}
            {item.accountName}. Matching marks this bank transaction as recorded and adds nothing to
            the books.
          </legend>
          {item.linkCandidates.map((c) => (
            <label
              key={c.entryId}
              className="flex items-center gap-3 rounded-lg border border-rule px-3 py-2 text-sm has-[:checked]:border-signal has-[:checked]:bg-signal-soft/50"
            >
              <input
                type="radio"
                name={`${p.base}-match`}
                className="size-4 accent-[var(--signal)]"
                checked={choice === `link:${c.entryId}`}
                onChange={() => p.setDraft({ choice: `link:${c.entryId}` })}
              />
              <span className="tabular text-ink-muted">{formatDay(c.entryDate)}</span>
              <span className="min-w-0 flex-1 truncate text-ink">
                {c.payee ?? c.memo ?? formatEntryNumber(c.entryNumber)}
              </span>
              <Link
                href={`/books/${p.bookId}/journal/${c.entryId}`}
                className="shrink-0 text-[0.8125rem] text-signal-ink underline underline-offset-2"
              >
                Open {formatEntryNumber(c.entryNumber)}
              </Link>
            </label>
          ))}
        </fieldset>
      ) : null}

      {mode === "categorize" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-[0.8125rem] font-medium text-ink">
            Payee
            <TextInput
              value={draft.payee}
              maxLength={200}
              onChange={(e) => p.setDraft({ payee: e.target.value })}
              autoComplete="off"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[0.8125rem] font-medium text-ink">
            <span>
              Memo <span className="font-normal text-ink-muted">(optional)</span>
            </span>
            <TextInput
              value={draft.memo}
              maxLength={500}
              onChange={(e) => p.setDraft({ memo: e.target.value })}
              autoComplete="off"
            />
          </label>
        </div>
      ) : null}

      {p.isSplit ? (
        <SplitEditor {...p} />
      ) : mode === "categorize" && p.canEdit ? (
        <div>
          <Button size="sm" variant="ghost" onClick={p.onSplit}>
            <SplitIcon size={14} aria-hidden />
            Split
          </Button>
        </div>
      ) : null}

      {plainAccount && p.canEdit ? (
        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-[var(--signal)]"
            checked={draft.saveRule}
            onChange={(e) => p.setDraft({ saveRule: e.target.checked })}
          />
          <span>
            Always use this category for &ldquo;{item.payee ?? item.description}&rdquo;
            <span className="block text-[0.8125rem] text-ink-muted">
              Saves a rule. Rules only suggest; you still add each one.
            </span>
          </span>
        </label>
      ) : null}

      {p.canEdit && ruleOpen ? (
        <RuleEditor
          bookId={p.bookId}
          groups={p.groups}
          bankAccounts={p.ruleOptions.bankAccounts}
          buckets={p.ruleOptions.buckets}
          prefill={{
            name: draft.payee || p.title,
            conditions: {
              text: {
                field: "any",
                op: "contains",
                value: suggestRuleText(item.payee ?? item.description),
              },
              direction: item.amountCents < 0 ? "outflow" : "inflow",
              accountId: item.accountId,
            },
            actions: {
              offsetAccountId: plainAccount ? choice : null,
              bucketAccountId: draft.bucketId || null,
              payee:
                draft.payee && draft.payee !== (item.payee ?? item.description)
                  ? draft.payee
                  : null,
              transfer: choice.startsWith("transfer:"),
            },
          }}
          onDone={() => setRuleOpen(false)}
        />
      ) : null}

      <Attachments
        bookId={p.bookId}
        target={{ bankTransactionId: item.id }}
        files={p.files}
        canEdit={p.canEdit}
      />

      {p.canEdit ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-3">
          {ruleOpen ? null : (
            <Button size="sm" variant="ghost" onClick={() => setRuleOpen(true)}>
              <Wand2 size={14} aria-hidden />
              Create a rule from this
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={p.onExclude}
              disabled={p.busy}
              title="Excluded transactions never reach the books. You can restore them from the Excluded tab."
            >
              <X size={14} aria-hidden />
              Exclude
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={p.onApprove}
              pending={p.busy}
              pendingLabel="Saving"
            >
              {isMatch ? "Match" : "Add"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SplitEditor(p: RowData) {
  const { item, draft } = p;
  const total = Math.abs(item.amountCents);
  let assigned = 0;
  let unreadable = false;
  for (const s of draft.splits) {
    if (!s.amount.trim()) continue;
    try {
      assigned += parseCents(s.amount);
    } catch {
      unreadable = true;
    }
  }
  const left = total - assigned;
  const update = (key: number, patch: Partial<Split>) =>
    p.setDraft({ splits: draft.splits.map((s) => (s.key === key ? { ...s, ...patch } : s)) });

  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-1 text-[0.8125rem] font-medium text-ink">Split</legend>
      <ol className="flex flex-col gap-2">
        {draft.splits.map((s, i) => (
          <li
            key={s.key}
            className="grid grid-cols-[minmax(0,1fr)_7.5rem_2rem] gap-2 sm:grid-cols-[minmax(0,1.4fr)_7.5rem_minmax(0,1fr)_2rem]"
          >
            <SelectInput
              aria-label={`Split line ${i + 1} account`}
              value={s.accountId}
              onChange={(e) => update(s.key, { accountId: e.target.value })}
            >
              <option value="">Choose an account</option>
              <AccountSelectOptions
                groups={p.groups}
                value={s.accountId}
                exclude={item.accountId}
              />
            </SelectInput>
            <TextInput
              aria-label={`Split line ${i + 1} amount`}
              inputMode="decimal"
              value={s.amount}
              onChange={(e) => update(s.key, { amount: e.target.value })}
              onFocus={() => {
                if (!s.amount && left > 0) update(s.key, { amount: plainAmount(left) });
              }}
              className="tabular text-right"
              autoComplete="off"
            />
            <TextInput
              aria-label={`Split line ${i + 1} memo`}
              value={s.memo}
              placeholder="Memo"
              onChange={(e) => update(s.key, { memo: e.target.value })}
              className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto"
              autoComplete="off"
            />
            <button
              type="button"
              aria-label={`Remove split line ${i + 1}`}
              onClick={() =>
                p.setDraft({
                  splits:
                    draft.splits.length > 2
                      ? draft.splits.filter((x) => x.key !== s.key)
                      : draft.splits,
                })
              }
              className="col-start-3 row-start-1 grid size-10 place-items-center rounded-lg text-ink-muted hover:bg-sunken hover:text-ink sm:col-start-auto sm:row-start-auto"
            >
              <X size={15} aria-hidden />
            </button>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => p.setDraft({ splits: [...draft.splits, newSplit()] })}
          >
            <Plus size={14} aria-hidden />
            Add line
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => p.setDraft({ choice: draft.splits[0]?.accountId ?? "", splits: [] })}
          >
            <Undo2 size={14} aria-hidden />
            Undo split
          </Button>
        </div>
        <p className="tabular text-sm" aria-live="polite">
          {unreadable ? (
            <span className="text-negative">An amount can&apos;t be read.</span>
          ) : left === 0 ? (
            <span className="text-positive">Adds up to {formatCents(total)}.</span>
          ) : (
            <span className="text-negative">
              {left > 0 ? `${formatCents(left)} left to assign` : `${formatCents(-left)} too much`}
            </span>
          )}
        </p>
      </div>
    </fieldset>
  );
}
