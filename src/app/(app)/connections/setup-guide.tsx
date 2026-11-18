"use client";

import { Check, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { FormError, SelectInput, TextInput } from "@/components/ui/field";
import { FillLine } from "@/components/ui/fill-line";
import { formatCents } from "@/lib/money";
import type { FeedView } from "@/server/simplefin/service";
import { guidedConnectAction, syncNowAction } from "./actions";
import type { MappingTarget } from "./connection-ui";
import { NEW_KINDS, type NewKind, guessKind, startingName } from "./feed-helpers";

type Choice = "new" | "existing" | "ignore";

/**
 * A guided pop-up that walks through each bank account not yet set up, one
 * at a time: where it goes in the books, and whether the bank's balance
 * today becomes its opening balance.
 */
export function SetupGuide({
  connectionId,
  feeds,
  targets,
  open,
  onClose,
}: {
  connectionId: string;
  feeds: FeedView[];
  targets: MappingTarget[];
  open: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  // The list is fixed while the guide is open, so steps don't shift as you go.
  const [list, setList] = useState<FeedView[]>(feeds);
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState<Array<{ name: string; result: string }>>([]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setList(feeds);
      setIndex(0);
      setDone([]);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open, feeds]);

  const finished = index >= list.length;
  const feed = list[index];

  return (
    <dialog
      ref={ref}
      onClose={() => {
        onClose();
        router.refresh();
      }}
      aria-labelledby="setup-guide-title"
      className="m-auto w-[min(34rem,calc(100vw-1.5rem))] rounded-2xl border border-rule bg-surface p-0 text-ink shadow-[var(--shadow-float)] backdrop:bg-[var(--scrim)]"
    >
      <div className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="setup-guide-title" className="text-lg font-semibold">
              Set up your bank accounts
            </h2>
            <p className="text-sm text-ink-muted">
              {finished
                ? "All done."
                : `Account ${index + 1} of ${list.length}. Bank history comes in from today.`}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => ref.current?.close()}
            className="-m-1 grid size-9 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-sunken hover:text-ink"
          >
            <X size={18} aria-hidden />
          </button>
        </div>
        <FillLine
          value={Math.min(index, list.length)}
          max={Math.max(1, list.length)}
          label="Setup progress"
        />
        {finished ? (
          <Summary connectionId={connectionId} done={done} onClose={() => ref.current?.close()} />
        ) : feed ? (
          <Step
            key={feed.id}
            feed={feed}
            targets={targets}
            canGoBack={index > 0}
            onBack={() => setIndex((i) => Math.max(0, i - 1))}
            onLater={() => setIndex((i) => i + 1)}
            onDone={(result) => {
              setDone((d) => [
                ...d.filter((x) => x.name !== feed.name),
                { name: feed.name, result },
              ]);
              setIndex((i) => i + 1);
            }}
          />
        ) : null}
      </div>
    </dialog>
  );
}

function Step({
  feed,
  targets,
  canGoBack,
  onBack,
  onLater,
  onDone,
}: {
  feed: FeedView;
  targets: MappingTarget[];
  canGoBack: boolean;
  onBack: () => void;
  onLater: () => void;
  onDone: (result: string) => void;
}) {
  const uid = useId();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [bookId, setBookId] = useState(feed.bookId ?? targets[0]?.id ?? "");
  const book = targets.find((t) => t.id === bookId);
  const free = (book?.accounts ?? []).filter((a) => !a.fedBy || a.id === feed.accountId);
  const [choice, setChoice] = useState<Choice>("new");
  const [kind, setKind] = useState<NewKind>(guessKind(feed));
  const [name, setName] = useState(startingName(feed.name));
  const [accountId, setAccountId] = useState(free[0]?.id ?? "");
  const existing = free.find((a) => a.id === accountId);
  const isInvestment =
    choice === "new" ? kind === "investment" : existing?.label.toLowerCase().includes("invest");
  const owed = kind === "credit_card" || kind === "loan" || existing?.type === "liability";
  const balance = feed.balanceCents;

  const submit = () =>
    start(async () => {
      const r = await guidedConnectAction(feed.id, {
        bookId,
        choice,
        kind,
        name,
        accountId,
      });
      if (r.error) {
        setError(r.error);
        return;
      }
      onDone(
        choice === "ignore"
          ? "Skipped"
          : choice === "new"
            ? `New account: ${name}`
            : `Connected to ${existing?.label ?? "an account"}`,
      );
    });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="rounded-xl bg-sunken p-4">
        <div className="font-semibold">{feed.name}</div>
        <div className="text-sm text-ink-muted">{feed.institution ?? "Bank"}</div>
        {balance !== null ? (
          <div className="mt-2 text-sm">
            Bank balance today: <Money cents={balance} className="font-semibold" />
          </div>
        ) : null}
      </div>

      <FormError message={error} />

      {targets.length > 1 ? (
        <label className="flex flex-col gap-1.5 text-[0.8125rem] font-medium">
          Book
          <SelectInput value={bookId} onChange={(e) => setBookId(e.target.value)}>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </SelectInput>
        </label>
      ) : null}

      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-1 text-[0.8125rem] font-medium">Where should it go?</legend>
        {(
          [
            ["new", "A new account"],
            ["existing", "An account I already have"],
            ["ignore", "Don't bring this account in"],
          ] as const
        ).map(([value, label]) => (
          <label
            key={value}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm ${
              choice === value ? "border-signal bg-signal-soft/50" : "border-rule"
            } ${value === "existing" && free.length === 0 ? "opacity-50" : ""}`}
          >
            <input
              type="radio"
              name={`${uid}-choice`}
              value={value}
              checked={choice === value}
              disabled={value === "existing" && free.length === 0}
              onChange={() => setChoice(value)}
              className="size-4 accent-[var(--signal)]"
            />
            {label}
          </label>
        ))}
      </fieldset>

      {choice === "new" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-[0.8125rem] font-medium">
            Type
            <SelectInput value={kind} onChange={(e) => setKind(e.target.value as NewKind)}>
              {NEW_KINDS.map((k) => (
                <option key={k.kind} value={k.kind}>
                  {k.label}
                </option>
              ))}
            </SelectInput>
          </label>
          <label className="flex flex-col gap-1.5 text-[0.8125rem] font-medium">
            Name
            <TextInput
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              autoFocus
            />
          </label>
        </div>
      ) : null}

      {choice === "existing" ? (
        <label className="flex flex-col gap-1.5 text-[0.8125rem] font-medium">
          Account
          <SelectInput value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {free.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </SelectInput>
        </label>
      ) : null}

      {choice !== "ignore" && balance !== null ? (
        isInvestment ? (
          <p className="text-[0.8125rem] text-ink-muted">
            Its value is filled in from the bank on each sync, for net worth.
          </p>
        ) : (
          <p className="text-sm">
            Opening balance:{" "}
            <span className="font-semibold">
              {formatCents(owed ? Math.abs(balance) : balance)}
              {owed ? " owed" : ""}
            </span>
            <span className="block text-[0.8125rem] text-ink-muted">
              The bank&apos;s balance today. Transactions from today on come in through review.
            </span>
          </p>
        )
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-4">
        {canGoBack ? (
          <Button variant="ghost" onClick={onBack} disabled={pending}>
            Back
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onLater} disabled={pending}>
          Decide later
        </Button>
        <Button type="submit" variant="primary" className="ml-auto" disabled={pending}>
          {pending ? "Saving" : choice === "ignore" ? "Skip and continue" : "Connect and continue"}
        </Button>
      </div>
    </form>
  );
}

function Summary({
  connectionId,
  done,
  onClose,
}: {
  connectionId: string;
  done: Array<{ name: string; result: string }>;
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-4">
      {done.length ? (
        <ul className="flex flex-col gap-1.5 text-sm">
          {done.map((d) => (
            <li key={d.name} className="flex items-start gap-2">
              <Check size={16} aria-hidden className="mt-0.5 shrink-0 text-positive" />
              <span>
                <span className="font-medium">{d.name}</span>
                <span className="block text-ink-muted">{d.result}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-muted">Nothing was changed. You can come back any time.</p>
      )}
      <p className="text-sm text-ink-muted">
        Sync now to bring in today&apos;s transactions; they wait in For review until you approve
        them.
      </p>
      <div className="flex flex-wrap justify-end gap-2 border-t border-rule pt-4">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button
          variant="primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await syncNowAction(connectionId);
              if (r.status === "error") toast.error(r.messages[0] ?? "Sync failed.");
              else toast.success(`Synced. ${r.newCount} new transactions.`);
              onClose();
            })
          }
        >
          {pending ? "Syncing" : "Sync now"}
        </Button>
      </div>
    </div>
  );
}
