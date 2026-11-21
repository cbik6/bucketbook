"use client";

import { Archive, ArchiveRestore, Pencil, Plus, Search, X } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { AccountPicker } from "@/components/account-picker";
import { Money } from "@/components/money";
import { Button, IconButton } from "@/components/ui/button";
import { FormError, SelectInput, TextInput } from "@/components/ui/field";
import type { AccountOptionGroup } from "@/lib/account-options";
import { formatDay } from "@/lib/dates";
import type { PayeeRow } from "@/server/payees/service";
import {
  type PayeeResult,
  createPayeeAction,
  mergePayeesAction,
  removePayeeMatchAction,
  updatePayeeAction,
} from "./actions";

/** The Payees page: add, rename, merge, set the usual category, archive. */
export function PayeesManager({
  bookId,
  payees,
  groups,
  canEdit,
}: {
  bookId: string;
  payees: PayeeRow[];
  groups: AccountOptionGroup[];
  canEdit: boolean;
}) {
  const uid = useId();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      payees.filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          p.matches.some((m) => (m.sample ?? m.key).toLowerCase().includes(q)),
      ),
    [payees, q],
  );
  const active = shown.filter((p) => !p.archived);
  const archived = shown.filter((p) => p.archived);

  return (
    <div className="flex flex-col gap-6">
      {canEdit ? <AddPayee bookId={bookId} groups={groups} /> : null}

      {payees.length === 0 ? (
        <p className="max-w-prose text-sm text-ink-muted">
          No payees yet. Type a name in the Payee field when you add a transaction in For review or
          write a journal entry, and it&apos;s added here.
        </p>
      ) : (
        <>
          <div className="relative max-w-sm">
            <Search
              size={15}
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted"
            />
            <TextInput
              id={`${uid}-search`}
              aria-label="Search payees"
              placeholder="Search payees or bank text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
              autoComplete="off"
            />
          </div>
          <PayeeList
            label="Payees"
            bookId={bookId}
            rows={active}
            all={payees}
            groups={groups}
            canEdit={canEdit}
            editing={editing}
            setEditing={setEditing}
          />
          {active.length === 0 && q ? (
            <p className="text-sm text-ink-muted">No payees match &ldquo;{query.trim()}&rdquo;.</p>
          ) : null}
          {archived.length ? (
            <details className="group">
              <summary className="cursor-pointer text-sm font-medium text-ink-muted">
                Archived ({archived.length})
              </summary>
              <div className="mt-3">
                <PayeeList
                  label="Archived payees"
                  bookId={bookId}
                  rows={archived}
                  all={payees}
                  groups={groups}
                  canEdit={canEdit}
                  editing={editing}
                  setEditing={setEditing}
                />
              </div>
            </details>
          ) : null}
        </>
      )}
    </div>
  );
}

function useAction() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const runAction = (fn: () => Promise<PayeeResult>, onOk?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        setError(undefined);
        if (r.message) toast.success(r.message);
        onOk?.();
      } else setError(r.error);
    });
  return { pending, error, setError, runAction };
}

function AddPayee({ bookId, groups }: { bookId: string; groups: AccountOptionGroup[] }) {
  const uid = useId();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const { pending, error, runAction } = useAction();
  return (
    <form
      className="flex flex-col gap-2 rounded-xl border border-rule p-4"
      onSubmit={(e) => {
        e.preventDefault();
        runAction(
          () => createPayeeAction(bookId, { name, defaultAccountId: category || null }),
          () => {
            setName("");
            setCategory("");
          },
        );
      }}
    >
      <h2 className="text-sm font-semibold text-ink">Add a payee</h2>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <label className="flex flex-col gap-1.5 text-[0.8125rem] font-medium text-ink">
          Name
          <TextInput
            id={`${uid}-name`}
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
            placeholder="For example Taco Bell"
            autoComplete="off"
          />
        </label>
        <div className="flex flex-col gap-1.5 text-[0.8125rem] font-medium text-ink">
          <span>
            Usual category <span className="font-normal text-ink-muted">(optional)</span>
          </span>
          <AccountPicker
            label="Usual category"
            value={category}
            onChange={setCategory}
            groups={groups}
            order="out"
            placeholder="None"
            noneLabel="No usual category"
          />
        </div>
        <Button type="submit" variant="primary" pending={pending} pendingLabel="Adding">
          <Plus size={16} aria-hidden />
          Add payee
        </Button>
      </div>
      {error ? <FormError message={error} /> : null}
    </form>
  );
}

type ListProps = {
  label: string;
  bookId: string;
  rows: PayeeRow[];
  all: PayeeRow[];
  groups: AccountOptionGroup[];
  canEdit: boolean;
  editing: string | null;
  setEditing: (id: string | null) => void;
};

function PayeeList({ label, rows, ...p }: ListProps) {
  if (rows.length === 0) return null;
  return (
    <ul aria-label={label} className="flex flex-col border-t border-rule">
      {rows.map((row) => (
        <PayeeItem key={row.id} row={row} {...p} />
      ))}
    </ul>
  );
}

function PayeeItem({
  row,
  bookId,
  all,
  groups,
  canEdit,
  editing,
  setEditing,
}: Omit<ListProps, "label" | "rows"> & { row: PayeeRow }) {
  const open = editing === row.id;
  const { pending, error, runAction } = useAction();
  const entriesHref = `/books/${bookId}/journal?${new URLSearchParams({ payee: row.id })}`;
  return (
    <li className="border-b border-rule py-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)_auto]">
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{row.name}</p>
          <p className="flex flex-wrap gap-x-2 text-[0.8125rem] text-ink-muted">
            {row.entryCount ? (
              <Link href={entriesHref} className="text-signal-ink underline underline-offset-2">
                {row.entryCount === 1 ? "1 entry" : `${row.entryCount} entries`}
              </Link>
            ) : (
              <span>Not used yet</span>
            )}
            {row.lastUsed ? <span>Last {formatDay(row.lastUsed)}</span> : null}
            {row.spentCents ? (
              <span>
                Spent <Money cents={row.spentCents} />
              </span>
            ) : null}
            {row.matches.length ? (
              <span>
                {row.matches.length === 1
                  ? "Recognized from 1 bank text"
                  : `Recognized from ${row.matches.length} bank texts`}
              </span>
            ) : null}
          </p>
        </div>
        <div className="col-span-2 row-start-2 sm:col-span-1 sm:col-start-2 sm:row-start-1">
          <AccountPicker
            size="row"
            label={`Usual category for ${row.name}`}
            value={row.defaultAccountId ?? ""}
            onChange={(v) =>
              runAction(() => updatePayeeAction(bookId, row.id, { defaultAccountId: v || null }))
            }
            groups={groups}
            order="out"
            placeholder="No usual category"
            noneLabel="No usual category"
            disabled={!canEdit || pending}
          />
        </div>
        {canEdit ? (
          <IconButton
            size="sm"
            aria-label={`Edit ${row.name}`}
            aria-expanded={open}
            title="Rename, merge or archive"
            onClick={() => setEditing(open ? null : row.id)}
            className="col-start-2 row-start-1 sm:col-start-3"
          >
            <Pencil size={15} aria-hidden />
          </IconButton>
        ) : null}
      </div>
      {error && !open ? <FormError message={error} /> : null}
      {open ? (
        <PayeeEditor row={row} bookId={bookId} all={all} onClose={() => setEditing(null)} />
      ) : null}
    </li>
  );
}

function PayeeEditor({
  row,
  bookId,
  all,
  onClose,
}: {
  row: PayeeRow;
  bookId: string;
  all: PayeeRow[];
  onClose: () => void;
}) {
  const uid = useId();
  const [name, setName] = useState(row.name);
  const [into, setInto] = useState("");
  const { pending, error, runAction } = useAction();
  const others = all.filter((p) => p.id !== row.id);
  const intoName = others.find((p) => p.id === into)?.name;
  return (
    <div className="mt-3 flex flex-col gap-4 rounded-xl border border-rule bg-surface p-4">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          runAction(() => updatePayeeAction(bookId, row.id, { name }), onClose);
        }}
      >
        <label className="flex min-w-[14rem] flex-1 flex-col gap-1.5 text-[0.8125rem] font-medium text-ink">
          Name
          <TextInput
            id={`${uid}-rename`}
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
          />
        </label>
        <Button type="submit" variant="secondary" pending={pending} pendingLabel="Saving">
          Rename
        </Button>
      </form>

      {others.length ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!into) return;
            runAction(() => mergePayeesAction(bookId, row.id, into), onClose);
          }}
        >
          <label className="flex min-w-[14rem] flex-1 flex-col gap-1.5 text-[0.8125rem] font-medium text-ink">
            Merge into another payee
            <SelectInput id={`${uid}-merge`} value={into} onChange={(e) => setInto(e.target.value)}>
              <option value="">Choose a payee</option>
              {others.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.archived ? " (archived)" : ""}
                </option>
              ))}
            </SelectInput>
          </label>
          <Button type="submit" variant="secondary" disabled={!into} pending={pending}>
            Merge
          </Button>
          {intoName ? (
            <p className="basis-full text-[0.8125rem] text-ink-muted">
              {row.name}&apos;s entries and bank text move to {intoName}, and {row.name} is removed.
            </p>
          ) : null}
        </form>
      ) : null}

      {row.matches.length ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-[0.8125rem] font-medium text-ink">Recognized from this bank text</p>
          <ul className="flex flex-col gap-1">
            {row.matches.map((m) => (
              <li key={m.key} className="flex items-center gap-2 text-[0.8125rem] text-ink-muted">
                <span className="min-w-0 flex-1 truncate">{m.sample ?? m.key}</span>
                <IconButton
                  size="sm"
                  aria-label={`Stop recognizing ${m.sample ?? m.key} as ${row.name}`}
                  title="Stop recognizing this"
                  onClick={() => runAction(() => removePayeeMatchAction(bookId, row.id, m.key))}
                >
                  <X size={14} aria-hidden />
                </IconButton>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-3">
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            runAction(() => updatePayeeAction(bookId, row.id, { archived: !row.archived }), onClose)
          }
        >
          {row.archived ? (
            <>
              <ArchiveRestore size={14} aria-hidden />
              Restore
            </>
          ) : (
            <>
              <Archive size={14} aria-hidden />
              Archive
            </>
          )}
        </Button>
        <span className="text-[0.8125rem] text-ink-muted">
          {row.archived
            ? "Archived payees aren't offered or recognized."
            : "Archiving hides it from the payee list and review; its entries keep it."}
        </span>
        <Button size="sm" variant="ghost" onClick={onClose} className="ml-auto">
          Close
        </Button>
      </div>
      {error ? <FormError message={error} /> : null}
    </div>
  );
}
