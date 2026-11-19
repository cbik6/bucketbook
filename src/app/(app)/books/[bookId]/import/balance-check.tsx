"use client";

import { CircleAlert, CircleCheck } from "lucide-react";
import { useId } from "react";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import type { BalanceCheck } from "@/lib/statement-check";

/**
 * Beginning and ending balances from the statement, and whether the rows
 * being imported add up from one to the other.
 */
export function BalanceCheckPanel({
  begin,
  end,
  onBegin,
  onEnd,
  check,
  owed,
  fromStatement,
  describe,
  onFlipRow,
  onFlipAll,
  confirmed,
  onConfirm,
}: {
  begin: string;
  end: string;
  onBegin: (v: string) => void;
  onEnd: (v: string) => void;
  check: BalanceCheck;
  /** A card or loan: the balances are what is owed. */
  owed: boolean;
  /** The balances were filled in from the statement itself. */
  fromStatement: boolean;
  describe: (line: number) => string;
  onFlipRow?: (line: number) => void;
  onFlipAll: () => void;
  confirmed: boolean;
  onConfirm: (v: boolean) => void;
}) {
  const uid = useId();
  return (
    <section
      aria-labelledby={`${uid}-title`}
      className="flex flex-col gap-4 rounded-xl border border-rule p-4"
    >
      <div>
        <h3 id={`${uid}-title`} className="text-[0.9375rem] font-semibold text-ink">
          Check against the statement
        </h3>
        <p className="text-[0.8125rem] text-ink-muted">
          {fromStatement
            ? "Filled in from the statement. "
            : `Optional. Enter the ${owed ? "balance owed" : "balances"} printed on the statement. `}
          The ticked rows should add up from the beginning to the ending
          {owed ? " amount owed" : " balance"}.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={owed ? "Owed at the start" : "Beginning balance"}
          htmlFor={`${uid}-begin`}
          error={check.state === "invalid" && check.field === "begin" ? check.message : undefined}
        >
          <TextInput
            id={`${uid}-begin`}
            inputMode="decimal"
            autoComplete="off"
            className="tabular"
            value={begin}
            invalid={check.state === "invalid" && check.field === "begin"}
            onChange={(e) => onBegin(e.target.value)}
            placeholder="0.00"
          />
        </Field>
        <Field
          label={owed ? "Owed at the end" : "Ending balance"}
          htmlFor={`${uid}-end`}
          error={check.state === "invalid" && check.field === "end" ? check.message : undefined}
        >
          <TextInput
            id={`${uid}-end`}
            inputMode="decimal"
            autoComplete="off"
            className="tabular"
            value={end}
            invalid={check.state === "invalid" && check.field === "end"}
            onChange={(e) => onEnd(e.target.value)}
            placeholder="0.00"
          />
        </Field>
      </div>

      {check.state === "match" || check.state === "off" ? (
        <div className="flex flex-col gap-3" aria-live="polite">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-ink-muted">Start</dt>
              <dd>
                <Money cents={check.beginCents} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">{owed ? "Charges" : "Money in"}</dt>
              <dd>
                <Money cents={owed ? -check.outCents : check.inCents} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">
                {owed ? "Payments and credits" : "Money out"}
              </dt>
              <dd>
                <Money cents={owed ? check.inCents : check.outCents} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">These rows end at</dt>
              <dd className="font-medium">
                <Money cents={check.expectedEndCents} />
              </dd>
            </div>
          </dl>
          {check.state === "match" ? (
            <p className="flex items-center gap-2 text-sm font-medium text-positive">
              <CircleCheck size={16} aria-hidden />
              {owed
                ? "Adds up to what the statement says is owed at the end."
                : "Adds up to the statement\u2019s ending balance."}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="flex items-start gap-2 text-sm font-medium text-negative">
                <CircleAlert size={16} aria-hidden className="mt-0.5 shrink-0" />
                <span>
                  Off by{" "}
                  <span className="tabular">
                    <Money cents={Math.abs(check.differenceCents)} />
                  </span>
                  . The statement ends at <Money cents={check.endCents} />.
                </span>
              </p>
              {check.flipAll ? (
                <div className="flex flex-wrap items-center gap-3 text-sm text-ink">
                  It would match with money in and money out swapped.
                  <Button size="sm" onClick={onFlipAll}>
                    Swap them
                  </Button>
                </div>
              ) : check.flipLine != null ? (
                <div className="flex flex-wrap items-center gap-3 text-sm text-ink">
                  <span>
                    It would match if &ldquo;{describe(check.flipLine)}&rdquo; went the other way.
                  </span>
                  {onFlipRow ? (
                    <Button size="sm" onClick={() => onFlipRow(check.flipLine!)}>
                      Flip that row
                    </Button>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-ink-muted">
                  A row may be missing, misread, or ticked off. Compare the rows with the statement,
                  and check the balances above.
                </p>
              )}
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--signal)]"
                  checked={confirmed}
                  onChange={(e) => onConfirm(e.target.checked)}
                />
                Send them to review anyway
              </label>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
