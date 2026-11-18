"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useActionState, useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Field, FormError, SelectInput, inputClass } from "@/components/ui/field";
import { HoldButton } from "@/components/ui/hold-button";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ConnectionView, FeedView } from "@/server/simplefin/service";
import {
  connectAction,
  disconnectAction,
  mapFeedAction,
  setSyncTimeAction,
  syncNowAction,
} from "./actions";

export type MappingTarget = {
  id: string;
  name: string;
  accounts: { id: string; label: string; type: string }[];
};

const DEMO_URL = "https://demo:demo@beta-bridge.simplefin.org/simplefin";

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "AM" : "PM"}`;

function when(date: Date | null, timeZone: string) {
  if (!date) return "never";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(date));
}

function day(date: Date | null, timeZone: string) {
  if (!date) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone }).format(
    new Date(date),
  );
}

export function ConnectForm({ first }: { first: boolean }) {
  const tokenRef = useRef<HTMLTextAreaElement>(null);
  const [state, formAction] = useActionState(
    async (prev: Parameters<typeof connectAction>[0], fd: FormData) => {
      const r = await connectAction(prev, fd);
      // Never leave a pasted token or Access URL sitting on screen.
      if (r.success && tokenRef.current) tokenRef.current.value = "";
      return r;
    },
    {},
  );
  const id = useId();
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-4">
      <div>
        <h2 id={`${id}-title`} className="text-[0.9375rem] font-semibold text-ink">
          {first ? "Connect SimpleFIN" : "Add another SimpleFIN connection"}
        </h2>
        <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5 text-sm text-ink-muted">
          <li>
            In{" "}
            <a
              href="https://beta-bridge.simplefin.org/"
              target="_blank"
              rel="noreferrer"
              className="text-signal-ink underline underline-offset-2"
            >
              SimpleFIN Bridge
            </a>
            , connect your banks, then create a setup token for Bucketbook.
          </li>
          <li>Paste the token below. It works once, so make a new one if this fails.</li>
          <li>Choose which book and account each bank account feeds.</li>
        </ol>
      </div>
      <form action={formAction} className="flex flex-col gap-3">
        <FormError message={state.error} />
        {state.success ? (
          <p role="status" className="rounded-lg bg-signal-soft px-3 py-2.5 text-sm text-ink">
            {state.success}
          </p>
        ) : null}
        <Field
          label="Setup token"
          htmlFor={`${id}-token`}
          hint="Bucketbook trades it for an access key, stores that encrypted, and never shows it again."
        >
          <textarea
            id={`${id}-token`}
            name="token"
            rows={3}
            ref={tokenRef}
            spellCheck={false}
            autoComplete="off"
            className={`${inputClass} h-auto break-all py-2 text-[0.8125rem]`}
            placeholder="aHR0cHM6Ly9iZXRhLWJyaWRnZS5zaW1wbGVmaW4ub3JnL3NpbXBsZWZpbi9jbGFpbS8..."
          />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton pendingLabel="Connecting">Connect</SubmitButton>
          <Button
            variant="ghost"
            onClick={() => {
              if (tokenRef.current) tokenRef.current.value = DEMO_URL;
            }}
          >
            Use the demo bank
          </Button>
        </div>
      </form>
    </section>
  );
}

export function ConnectionCard({
  connection,
  targets,
  timeZone,
}: {
  connection: ConnectionView;
  targets: MappingTarget[];
  timeZone: string;
}) {
  const [syncing, startSync] = useTransition();
  const [, startOther] = useTransition();
  const id = useId();
  const mapped = connection.feeds.filter((f) => f.accountId);
  const unmapped = connection.feeds.filter((f) => !f.accountId && !f.ignored);
  const ignored = connection.feeds.filter((f) => f.ignored);
  const busy = syncing || connection.syncing;

  const syncNow = () =>
    startSync(async () => {
      const r = await syncNowAction(connection.id);
      const counts =
        r.newCount || r.updatedCount
          ? `${r.newCount} new, ${r.updatedCount} updated.`
          : "Nothing new.";
      if (r.status === "error") toast.error(r.messages[0] ?? "Sync failed.");
      else toast.success(`Synced. ${counts}`, { description: r.messages[0] });
    });

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-5 rounded-xl border border-rule p-4 sm:p-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="text-lg font-semibold text-ink">
            {connection.label}
          </h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            Last synced {when(connection.lastSyncAt, timeZone)}. SimpleFIN allows about 24 requests
            a day; <span className="tabular">{connection.requestsToday}</span> used in the last 24
            hours.
          </p>
        </div>
        <Button variant="primary" onClick={syncNow} aria-disabled={busy} disabled={busy}>
          <RefreshCw size={15} aria-hidden className={busy ? "motion-safe:animate-spin" : ""} />
          {busy ? "Syncing" : "Sync now"}
        </Button>
      </div>

      {connection.lastSyncMessages.length > 0 ? (
        <div
          role={connection.lastSyncStatus === "error" ? "alert" : "status"}
          className={`rounded-lg px-3 py-2.5 text-sm ${
            connection.lastSyncStatus === "error"
              ? "border border-negative/40 bg-negative-soft text-negative"
              : "bg-sunken text-ink"
          }`}
        >
          <p className="font-medium">
            {connection.lastSyncStatus === "error" ? "The last sync failed" : "From the last sync"}
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {connection.lastSyncMessages.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {unmapped.length > 0 ? (
        <FeedGroup
          title="Choose where these go"
          note="Each bank account feeds one account in one book. Transactions before that book's start date are skipped."
          feeds={unmapped}
          targets={targets}
          timeZone={timeZone}
        />
      ) : null}
      {mapped.length > 0 ? (
        <FeedGroup
          title="Connected accounts"
          feeds={mapped}
          targets={targets}
          timeZone={timeZone}
        />
      ) : null}
      {ignored.length > 0 ? (
        <FeedGroup title="Ignored" feeds={ignored} targets={targets} timeZone={timeZone} />
      ) : null}

      <div className="flex flex-col gap-3 border-t border-rule pt-4 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex items-center gap-2 text-sm text-ink">
          Sync every day at
          <span className="w-32">
            <SelectInput
              defaultValue={connection.syncHour}
              onChange={(e) => {
                const hour = Number(e.target.value);
                startOther(async () => {
                  const r = await setSyncTimeAction(connection.id, hour);
                  if (r.error) toast.error(r.error);
                  else toast.success(`Syncing daily at ${hourLabel(hour)} (${timeZone}).`);
                });
              }}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </SelectInput>
          </span>
          <span className="text-ink-muted">{timeZone}</span>
        </label>
        <HoldButton
          label="Disconnect"
          onConfirm={() =>
            startOther(async () => {
              const r = await disconnectAction(connection.id);
              if (r.error) toast.error(r.error);
              else toast.success(r.success);
            })
          }
        />
      </div>
    </section>
  );
}

function FeedGroup({
  title,
  note,
  feeds,
  targets,
  timeZone,
}: {
  title: string;
  note?: string;
  feeds: FeedView[];
  targets: MappingTarget[];
  timeZone: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <h3 className="text-[0.9375rem] font-semibold text-ink">{title}</h3>
        {note ? <p className="text-sm text-ink-muted">{note}</p> : null}
      </div>
      <ul className="flex flex-col border-t border-rule">
        {feeds.map((f) => (
          <FeedRow key={f.id} feed={f} targets={targets} timeZone={timeZone} />
        ))}
      </ul>
    </div>
  );
}

function FeedStatus({ feed }: { feed: FeedView }) {
  if (!feed.accountId || feed.ledgerCents === null) return null;
  if (!feed.syncedThrough) {
    return <p className="text-[0.8125rem] text-ink-muted">Waiting for the first sync.</p>;
  }
  const diff = feed.unexplainedCents ?? 0;
  return (
    <div className="flex flex-col gap-1 text-[0.8125rem] text-ink-muted">
      <p>
        In your books: <Money cents={feed.ledgerCents} />.
        {feed.reviewCount > 0 ? (
          <>
            {" "}
            Waiting for review: {feed.reviewCount} (<Money cents={feed.reviewCents} />
            ).
          </>
        ) : null}
        {feed.pendingCount > 0 ? ` Pending at the bank: ${feed.pendingCount}.` : null}
      </p>
      {diff === 0 ? (
        <p className="text-positive">Matches the bank.</p>
      ) : (
        // Normal until opening balances are in, so this is a note, not an alarm.
        <p className="rounded-lg bg-sunken px-2.5 py-2 text-ink">
          Your books don&apos;t match the bank yet; the difference is{" "}
          <Money cents={Math.abs(diff)} />.{" "}
          <Link
            href={`/books/${feed.bookId}/opening-balances`}
            className="text-signal-ink underline underline-offset-2"
          >
            Check opening balances
          </Link>
          , then anything dated before the book&apos;s start date.
        </p>
      )}
      {feed.backfilling ? <p>Older history is still coming in, a few weeks per sync.</p> : null}
    </div>
  );
}

function FeedRow({
  feed,
  targets,
  timeZone,
}: {
  feed: FeedView;
  targets: MappingTarget[];
  timeZone: string;
}) {
  const [editing, setEditing] = useState(!feed.accountId && !feed.ignored);
  return (
    <li className="grid gap-3 border-b border-rule py-3 sm:grid-cols-[minmax(0,1fr)_9rem_minmax(0,1.4fr)] sm:items-start">
      <div className="min-w-0">
        <div className="truncate font-medium text-ink">{feed.name}</div>
        <div className="truncate text-[0.8125rem] text-ink-muted">
          {feed.institution ?? "Bank"} {feed.currency !== "USD" ? `, ${feed.currency}` : ""}
        </div>
      </div>
      <div className="sm:text-right">
        {feed.balanceCents !== null ? (
          <>
            <Money cents={feed.balanceCents} className="font-medium" />
            <div className="text-[0.8125rem] text-ink-muted">
              Bank balance, {day(feed.balanceAt, timeZone)}
            </div>
          </>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        {editing ? (
          <MappingForm feed={feed} targets={targets} onDone={() => setEditing(false)} />
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {feed.accountId ? (
              <span className="text-sm text-ink">
                <Link
                  href={`/books/${feed.bookId}/review`}
                  className="text-signal-ink underline-offset-2 hover:underline"
                >
                  {feed.bookName}
                </Link>
                : {feed.accountName}
              </span>
            ) : (
              <span className="text-sm text-ink-muted">Ignored</span>
            )}
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Change
            </Button>
          </div>
        )}
        <FeedStatus feed={feed} />
      </div>
    </li>
  );
}

function MappingForm({
  feed,
  targets,
  onDone,
}: {
  feed: FeedView;
  targets: MappingTarget[];
  onDone: () => void;
}) {
  const [state, formAction] = useActionState(
    async (prev: Parameters<typeof mapFeedAction>[1], fd: FormData) => {
      const r = await mapFeedAction(feed.id, prev, fd);
      if (r.success) {
        toast.success(r.success);
        onDone();
      }
      return r;
    },
    {},
  );
  const id = useId();
  const [bookId, setBookId] = useState(feed.bookId ?? (targets.length === 1 ? targets[0]!.id : ""));
  const book = targets.find((t) => t.id === bookId);
  // Guess the account from the bank's name ("Checking" goes to Checking).
  const guess =
    book?.accounts.find((a) =>
      feed.name.toLowerCase().includes(a.label.toLowerCase().split(": ").pop()!),
    )?.id ?? "";
  const [accountId, setAccountId] = useState(feed.accountId ?? guess);
  if (targets.length === 0) {
    return <p className="text-sm text-ink-muted">Create a book first, then map this account.</p>;
  }
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <FormError message={state.error} />
      <div className="grid gap-2 sm:grid-cols-2">
        <SelectInput
          id={`${id}-book`}
          name="bookId"
          aria-label={`Book for ${feed.name}`}
          value={bookId}
          onChange={(e) => {
            setBookId(e.target.value);
            setAccountId("");
          }}
        >
          <option value="">Choose a book</option>
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </SelectInput>
        <SelectInput
          id={`${id}-account`}
          name="accountId"
          aria-label={`Account for ${feed.name}`}
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          disabled={!book}
          invalid={state.field === "accountId"}
        >
          <option value="">Choose an account</option>
          {book?.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </SelectInput>
      </div>
      <div className="flex flex-wrap gap-2">
        <SubmitButton size="sm" variant="secondary" pendingLabel="Saving">
          Save
        </SubmitButton>
        {!feed.ignored ? (
          <button
            type="submit"
            name="mode"
            value="ignore"
            className="h-8 rounded-full px-3 text-[0.8125rem] text-ink-muted hover:bg-sunken hover:text-ink"
          >
            Ignore this account
          </button>
        ) : null}
        {feed.accountId || feed.ignored ? (
          <Button size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
