"use client";

import { ArrowDown, ArrowLeftRight, ArrowUp, Pencil, Plus } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Money } from "@/components/money";
import { Button, IconButton } from "@/components/ui/button";
import { Field, FormError, SelectInput, TextInput } from "@/components/ui/field";
import { FillLine } from "@/components/ui/fill-line";
import { HoldButton } from "@/components/ui/hold-button";
import { BUCKET_COLORS, goalProgress } from "@/lib/buckets";
import { formatDay } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import type { BucketAccountView, BucketRuleRow, BucketView } from "@/server/buckets/service";
import {
  type BucketResult,
  deleteBucketRuleAction,
  enableBucketsAction,
  moveBucketRuleAction,
  moveMoneyAction,
  runMonthlyAction,
  saveBucketAction,
  saveBucketRuleAction,
} from "./actions";

type Eligible = { id: string; name: string; subtype: string; balanceCents: number };

const COLOR_LABEL: Record<string, string> = {
  green: "Green",
  blue: "Blue",
  yellow: "Yellow",
  pink: "Pink",
};

const cardColor = (b: BucketView) =>
  b.isUnassigned ? "var(--unassigned-card)" : `var(--bucket-${b.color ?? "green"})`;

function useAction() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const run = (fn: () => Promise<BucketResult>, onOk?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        setError(undefined);
        if (r.message) toast.success(r.message);
        onOk?.();
      } else setError(r.error);
    });
  return { pending, error, run, setError };
}

export function BucketsBoard({
  bookId,
  accounts,
  eligible,
  today,
  minDate,
  canEdit,
}: {
  bookId: string;
  accounts: BucketAccountView[];
  eligible: Eligible[];
  today: string;
  minDate?: string;
  canEdit: boolean;
}) {
  return (
    <div className="flex flex-col gap-12">
      {accounts.length === 0 ? (
        <div className="flex max-w-prose flex-col gap-2">
          <p className="text-[0.9375rem] font-semibold text-ink">No buckets yet.</p>
          <p className="text-sm text-ink-muted">
            Turn on buckets for a savings or checking account below. Its balance moves into an
            Unassigned bucket, and you split it into goals like Car, Vacation, or Emergency.
          </p>
        </div>
      ) : null}
      {accounts.map((a) => (
        <BucketAccount
          key={a.id}
          bookId={bookId}
          account={a}
          today={today}
          minDate={minDate}
          canEdit={canEdit}
        />
      ))}
      {canEdit && eligible.length > 0 ? <EnableList bookId={bookId} eligible={eligible} /> : null}
    </div>
  );
}

function BucketAccount({
  bookId,
  account,
  today,
  minDate,
  canEdit,
}: {
  bookId: string;
  account: BucketAccountView;
  today: string;
  minDate?: string;
  canEdit: boolean;
}) {
  const id = useId();
  const [panel, setPanel] = useState<"move" | "new" | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const active = account.buckets.filter((b) => !b.archived);
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 border-b border-rule pb-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id={`${id}-title`} className="text-lg font-semibold text-ink">
            {account.name}
          </h2>
          <p className="text-sm text-ink-muted">
            <Money cents={account.totalCents} className="font-medium text-ink" /> in {active.length}{" "}
            {active.length === 1 ? "bucket" : "buckets"}
          </p>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setPanel(panel === "move" ? null : "move")}>
              <ArrowLeftRight size={15} aria-hidden />
              Move money
            </Button>
            <Button variant="primary" onClick={() => setPanel(panel === "new" ? null : "new")}>
              <Plus size={15} aria-hidden />
              New bucket
            </Button>
          </div>
        ) : null}
      </div>
      {panel === "move" ? (
        <MoveForm
          bookId={bookId}
          buckets={active}
          today={today}
          minDate={minDate}
          onDone={() => setPanel(null)}
        />
      ) : null}
      {panel === "new" ? (
        <BucketForm
          bookId={bookId}
          target={{ parentId: account.id }}
          onDone={() => setPanel(null)}
        />
      ) : null}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {active.map((b) =>
          editing === b.id ? (
            <li key={b.id} className="sm:col-span-2 lg:col-span-3">
              <BucketForm
                bookId={bookId}
                target={{ bucketId: b.id }}
                bucket={b}
                onDone={() => setEditing(null)}
              />
            </li>
          ) : (
            <BucketCard
              key={b.id}
              bucket={b}
              today={today}
              canEdit={canEdit}
              onEdit={() => setEditing(b.id)}
            />
          ),
        )}
      </ul>
      <AllocationRules bookId={bookId} account={account} canEdit={canEdit} />
    </section>
  );
}

function BucketCard({
  bucket,
  today,
  canEdit,
  onEdit,
}: {
  bucket: BucketView;
  today: string;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const goal =
    bucket.goalCents != null
      ? goalProgress(bucket.balanceCents, bucket.goalCents, bucket.goalDate, today)
      : null;
  return (
    <li
      className="flex min-h-36 flex-col gap-3 rounded-xl p-4 text-[var(--on-bucket)]"
      style={{ background: cardColor(bucket) }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{bucket.name}</h3>
          {bucket.isUnassigned ? (
            <p className="text-[0.8125rem] opacity-80">Deposits land here first.</p>
          ) : null}
        </div>
        {canEdit ? (
          <IconButton
            onClick={onEdit}
            aria-label={`Edit ${bucket.name}`}
            title="Edit"
            size="sm"
            tone="tint"
            className="-m-1"
          >
            <Pencil size={14} aria-hidden />
          </IconButton>
        ) : null}
      </div>
      <Money cents={bucket.balanceCents} className="text-2xl font-semibold" />
      {goal && bucket.goalCents ? (
        <div className="mt-auto flex flex-col gap-1.5">
          <FillLine
            value={Math.max(0, bucket.balanceCents)}
            max={bucket.goalCents}
            label={`${bucket.name} goal progress`}
          />
          <p className="text-[0.8125rem]">
            {goal.reached ? (
              <>Goal of {formatCents(bucket.goalCents)} reached.</>
            ) : (
              <>
                {formatCents(goal.remainingCents)} to go of {formatCents(bucket.goalCents)}
                {bucket.goalDate ? ` by ${formatDay(bucket.goalDate)}` : ""}.
                {goal.monthlyCents ? (
                  <span className="block font-medium">
                    {goal.overdue
                      ? "The date has passed."
                      : `Set aside ${formatCents(goal.monthlyCents)} a month.`}
                  </span>
                ) : null}
              </>
            )}
          </p>
        </div>
      ) : null}
    </li>
  );
}

function BucketForm({
  bookId,
  target,
  bucket,
  onDone,
}: {
  bookId: string;
  target: { parentId: string } | { bucketId: string };
  bucket?: BucketView;
  onDone: () => void;
}) {
  const uid = useId();
  const { pending, error, run } = useAction();
  const [name, setName] = useState(bucket?.name ?? "");
  const [color, setColor] = useState(bucket?.color ?? "");
  const [goal, setGoal] = useState(
    bucket?.goalCents ? formatCents(bucket.goalCents, { showSymbol: false }) : "",
  );
  const [goalDate, setGoalDate] = useState(bucket?.goalDate ?? "");
  const unassigned = bucket?.isUnassigned;
  return (
    <form
      className="flex flex-col gap-4 rounded-xl border border-rule bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => saveBucketAction(bookId, target, { name, color: color || null, goal, goalDate }),
          onDone,
        );
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onDone();
      }}
    >
      <h3 className="text-[0.9375rem] font-semibold text-ink">
        {bucket ? `Edit ${bucket.name}` : "New bucket"}
      </h3>
      <FormError message={error} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Name" htmlFor={`${uid}-name`}>
          <TextInput
            id={`${uid}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={unassigned}
            maxLength={60}
            autoFocus={!unassigned}
            autoComplete="off"
          />
        </Field>
        <Field label="Color" htmlFor={`${uid}-color`}>
          <SelectInput id={`${uid}-color`} value={color} onChange={(e) => setColor(e.target.value)}>
            <option value="">Automatic</option>
            {BUCKET_COLORS.map((c) => (
              <option key={c} value={c}>
                {COLOR_LABEL[c]}
              </option>
            ))}
          </SelectInput>
        </Field>
        {!unassigned ? (
          <>
            <Field label="Goal" htmlFor={`${uid}-goal`} optional>
              <TextInput
                id={`${uid}-goal`}
                inputMode="decimal"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                className="tabular"
                placeholder="5,000"
                autoComplete="off"
              />
            </Field>
            <Field label="Goal date" htmlFor={`${uid}-date`} optional>
              <TextInput
                id={`${uid}-date`}
                type="date"
                value={goalDate}
                onChange={(e) => setGoalDate(e.target.value)}
                className="tabular"
              />
            </Field>
          </>
        ) : null}
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" pending={pending} pendingLabel="Saving">
          {bucket ? "Save bucket" : "Add bucket"}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
      {bucket && !unassigned ? (
        <p className="text-[0.8125rem] text-ink-muted">
          To remove a bucket, move its money out, then archive it from the chart of accounts.
        </p>
      ) : null}
    </form>
  );
}

function MoveForm({
  bookId,
  buckets,
  today,
  minDate,
  onDone,
}: {
  bookId: string;
  buckets: BucketView[];
  today: string;
  minDate?: string;
  onDone: () => void;
}) {
  const uid = useId();
  const { pending, error, run } = useAction();
  const [fromId, setFromId] = useState(buckets.find((b) => b.isUnassigned)?.id ?? "");
  const [toId, setToId] = useState(buckets.find((b) => !b.isUnassigned)?.id ?? "");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(minDate && today < minDate ? minDate : today);
  const [memo, setMemo] = useState("");
  const from = buckets.find((b) => b.id === fromId);
  return (
    <form
      className="flex flex-col gap-4 rounded-xl border border-rule bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => moveMoneyAction(bookId, { fromId, toId, amount, date, memo }), onDone);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onDone();
      }}
    >
      <h3 className="text-[0.9375rem] font-semibold text-ink">Move money between buckets</h3>
      <FormError message={error} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_9rem_10rem]">
        <Field
          label="From"
          htmlFor={`${uid}-from`}
          hint={from ? `Holds ${formatCents(from.balanceCents)}` : undefined}
        >
          <SelectInput
            id={`${uid}-from`}
            value={fromId}
            onChange={(e) => setFromId(e.target.value)}
          >
            {buckets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="To" htmlFor={`${uid}-to`}>
          <SelectInput id={`${uid}-to`} value={toId} onChange={(e) => setToId(e.target.value)}>
            {buckets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Amount" htmlFor={`${uid}-amount`}>
          <TextInput
            id={`${uid}-amount`}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="tabular text-right"
            autoFocus
            autoComplete="off"
          />
        </Field>
        <Field label="Date" htmlFor={`${uid}-date`}>
          <TextInput
            id={`${uid}-date`}
            type="date"
            min={minDate}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="tabular"
          />
        </Field>
      </div>
      <Field label="Memo" htmlFor={`${uid}-memo`} optional>
        <TextInput
          id={`${uid}-memo`}
          value={memo}
          maxLength={500}
          onChange={(e) => setMemo(e.target.value)}
          autoComplete="off"
        />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" pending={pending} pendingLabel="Moving">
          Move
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ruleText(r: BucketRuleRow, bucketName: string) {
  const min = r.minDepositCents ? ` (deposits of ${formatCents(r.minDepositCents)} or more)` : "";
  if (r.kind === "percent") {
    const pct = (r.percentBp ?? 0) / 100;
    return `${pct}% of each deposit to ${bucketName}${min}`;
  }
  if (r.kind === "fixed")
    return `${formatCents(r.amountCents ?? 0)} of each deposit to ${bucketName}${min}`;
  return `${formatCents(r.amountCents ?? 0)} to ${bucketName} each month`;
}

function AllocationRules({
  bookId,
  account,
  canEdit,
}: {
  bookId: string;
  account: BucketAccountView;
  canEdit: boolean;
}) {
  const uid = useId();
  const { pending, error, run } = useAction();
  const [adding, setAdding] = useState(false);
  const goals = account.buckets.filter((b) => !b.isUnassigned && !b.archived);
  const [bucketId, setBucketId] = useState(goals[0]?.id ?? "");
  const [kind, setKind] = useState("percent");
  const [amount, setAmount] = useState("");
  const [percent, setPercent] = useState("");
  const [minDeposit, setMinDeposit] = useState("");
  const name = (id: string) => account.buckets.find((b) => b.id === id)?.name ?? "a bucket";
  const hasMonthly = account.rules.some((r) => r.kind === "monthly");

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-rule p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[0.9375rem] font-semibold text-ink">Allocation rules</h3>
          <p className="text-[0.8125rem] text-ink-muted">
            When a deposit to {account.name} is approved, these move money out of Unassigned, top to
            bottom, never more than the deposit.
          </p>
        </div>
        {canEdit && hasMonthly ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => run(() => runMonthlyAction(bookId))}
          >
            Run monthly rules now
          </Button>
        ) : null}
      </div>
      <FormError message={error} />
      {account.rules.length ? (
        <ol className="flex flex-col border-t border-rule">
          {account.rules.map((r, i) => (
            <li key={r.id} className="flex items-center gap-2 border-b border-rule py-2 text-sm">
              <span className="tabular w-5 text-ink-muted">{i + 1}</span>
              <span className="min-w-0 flex-1">{ruleText(r, name(r.bucketAccountId))}</span>
              {canEdit ? (
                <span className="flex shrink-0 gap-0.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Move up"
                    disabled={i === 0 || pending}
                    onClick={() => run(() => moveBucketRuleAction(bookId, r.id, "up"))}
                  >
                    <ArrowUp size={14} aria-hidden />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Move down"
                    disabled={i === account.rules.length - 1 || pending}
                    onClick={() => run(() => moveBucketRuleAction(bookId, r.id, "down"))}
                  >
                    <ArrowDown size={14} aria-hidden />
                  </Button>
                  <HoldButton
                    label="Remove"
                    disabled={pending}
                    onConfirm={() => run(() => deleteBucketRuleAction(bookId, r.id))}
                  />
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-ink-muted">
          No rules. Deposits stay in Unassigned until you move them.
        </p>
      )}
      {canEdit && goals.length > 0 ? (
        adding ? (
          <form
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_8rem_9rem_auto] lg:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () =>
                  saveBucketRuleAction(bookId, account.id, {
                    bucketAccountId: bucketId,
                    kind,
                    amount,
                    percent,
                    minDeposit,
                  }),
                () => {
                  setAdding(false);
                  setAmount("");
                  setPercent("");
                  setMinDeposit("");
                },
              );
            }}
          >
            <Field label="Bucket" htmlFor={`${uid}-bucket`}>
              <SelectInput
                id={`${uid}-bucket`}
                value={bucketId}
                onChange={(e) => setBucketId(e.target.value)}
              >
                {goals.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="How much" htmlFor={`${uid}-kind`}>
              <SelectInput
                id={`${uid}-kind`}
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                <option value="percent">A percentage of each deposit</option>
                <option value="fixed">A set amount from each deposit</option>
                <option value="monthly">A set amount each month</option>
              </SelectInput>
            </Field>
            {kind === "percent" ? (
              <Field label="Percent" htmlFor={`${uid}-pct`}>
                <TextInput
                  id={`${uid}-pct`}
                  inputMode="decimal"
                  value={percent}
                  onChange={(e) => setPercent(e.target.value)}
                  placeholder="10"
                  className="tabular text-right"
                />
              </Field>
            ) : (
              <Field label="Amount" htmlFor={`${uid}-amt`}>
                <TextInput
                  id={`${uid}-amt`}
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="200"
                  className="tabular text-right"
                />
              </Field>
            )}
            {kind !== "monthly" ? (
              <Field label="Deposits of at least" htmlFor={`${uid}-min`} optional>
                <TextInput
                  id={`${uid}-min`}
                  inputMode="decimal"
                  value={minDeposit}
                  onChange={(e) => setMinDeposit(e.target.value)}
                  className="tabular text-right"
                />
              </Field>
            ) : (
              <div />
            )}
            <div className="flex gap-2">
              <Button type="submit" variant="primary" disabled={pending}>
                Add rule
              </Button>
              <Button variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div>
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
              <Plus size={14} aria-hidden />
              Add a rule
            </Button>
          </div>
        )
      ) : null}
    </div>
  );
}

function EnableList({ bookId, eligible }: { bookId: string; eligible: Eligible[] }) {
  const uid = useId();
  const { pending, error, run } = useAction();
  const [choosing, setChoosing] = useState<string | null>(null);
  const [names, setNames] = useState("Emergency, Car, Vacation");
  return (
    <section aria-labelledby={`${uid}-title`} className="flex flex-col gap-3">
      <div>
        <h2 id={`${uid}-title`} className="text-[0.9375rem] font-semibold text-ink">
          Turn on buckets
        </h2>
        <p className="text-sm text-ink-muted">
          After this the account takes no postings of its own: deposits land in Unassigned and
          spending comes out of the bucket you pick in For review. This can&apos;t be turned off.
        </p>
      </div>
      <FormError message={error} />
      <ul className="flex flex-col border-t border-rule">
        {eligible.map((a) => (
          <li key={a.id} className="flex flex-col gap-3 border-b border-rule py-3">
            <div className="flex items-center justify-between gap-3">
              <span>
                <span className="font-medium text-ink">{a.name}</span>{" "}
                <Money cents={a.balanceCents} className="text-sm text-ink-muted" />
              </span>
              {choosing !== a.id ? (
                <Button size="sm" variant="secondary" onClick={() => setChoosing(a.id)}>
                  Turn on buckets
                </Button>
              ) : null}
            </div>
            {choosing === a.id ? (
              <form
                className="flex flex-col gap-3"
                // Only the hold button turns buckets on; Enter does nothing here.
                onSubmit={(e) => e.preventDefault()}
              >
                <Field
                  label="Start with these buckets"
                  htmlFor={`${uid}-${a.id}`}
                  hint="Separate names with commas. You can add, rename, and set goals later."
                >
                  <TextInput
                    id={`${uid}-${a.id}`}
                    value={names}
                    onChange={(e) => setNames(e.target.value)}
                    autoComplete="off"
                  />
                </Field>
                <div className="flex gap-2">
                  {/* Can't be undone, so it takes a deliberate hold. */}
                  <HoldButton
                    tone="signal"
                    size="md"
                    label={`Turn on buckets for ${a.name}`}
                    disabled={pending}
                    onConfirm={() =>
                      run(
                        () =>
                          enableBucketsAction(
                            bookId,
                            a.id,
                            names
                              .split(",")
                              .map((n) => n.trim())
                              .filter(Boolean),
                          ),
                        () => setChoosing(null),
                      )
                    }
                  />
                  <Button variant="ghost" onClick={() => setChoosing(null)}>
                    Cancel
                  </Button>
                </div>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
