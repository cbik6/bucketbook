"use client";

import { ArrowUpDown, FileText } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Money } from "@/components/money";
import { Button, IconButton, PendingLabel, buttonClass } from "@/components/ui/button";
import { Field, FormError, SelectInput } from "@/components/ui/field";
import { formatDay } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { MAX_PDF_BYTES, type StatementResult } from "@/lib/pdf-statement";
import { checkBalances } from "@/lib/statement-check";
import type { CsvPreviewRow } from "@/server/bank/csv-service";
import { importCsvAction, previewCsvAction, readPdfAction } from "./actions";
import { BalanceCheckPanel } from "./balance-check";

type Account = { id: string; name: string; type: string };

const STATUS_LABEL: Record<CsvPreviewRow["status"], string> = {
  new: "New",
  imported: "Already imported, skipped",
  possible_duplicate: "Possible duplicate, flagged",
  before_start: "Before the start date, skipped",
};

/**
 * Reads a statement PDF on the server, shows every transaction it found, and
 * lets you leave rows out or flip the signs before sending them to review.
 */
export function PdfImporter({
  bookId,
  startDate,
  accounts,
  initialAccountId,
}: {
  bookId: string;
  startDate: string;
  accounts: Account[];
  initialAccountId: string;
}) {
  const uid = useId();
  const router = useRouter();
  const file = useRef<File | null>(null);
  const [accountId, setAccountId] = useState(initialAccountId);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<StatementResult | null>(null);
  const [left, setLeft] = useState<Set<number>>(new Set());
  const [flip, setFlip] = useState(false);
  // Rows whose sign was flipped one at a time.
  const [flipped, setFlipped] = useState<Set<number>>(new Set());
  const [begin, setBegin] = useState("");
  const [end, setEnd] = useState("");
  const [fromStatement, setFromStatement] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [checked, setChecked] = useState<CsvPreviewRow[] | null>(null);
  const [error, setError] = useState<string>();
  const [reading, startRead] = useTransition();
  const [pending, start] = useTransition();

  const read = (account: string) => {
    const f = file.current;
    if (!f || !account) return;
    setError(undefined);
    setChecked(null);
    if (f.size > MAX_PDF_BYTES) {
      setError("That PDF is over 10 MB. Try one statement at a time.");
      return;
    }
    const data = new FormData();
    data.set("accountId", account);
    data.set("file", f);
    startRead(async () => {
      const r = await readPdfAction(bookId, data);
      if (!r.ok || !r.result) {
        setResult(null);
        setError(r.error);
        return;
      }
      setResult(r.result);
      setLeft(new Set());
      setFlip(false);
      setFlipped(new Set());
      setConfirmed(false);
      const money = (c: number | null) => (c == null ? "" : formatCents(c, { showSymbol: false }));
      setBegin(money(r.result.openingCents));
      setEnd(money(r.result.closingCents));
      setFromStatement(r.result.openingCents != null && r.result.closingCents != null);
    });
  };

  const rows = (result?.rows ?? []).map((r) => ({
    ...r,
    amountCents: r.amountCents * (flip ? -1 : 1) * (flipped.has(r.line) ? -1 : 1),
  }));
  const chosen = rows.filter((r) => !left.has(r.line));
  const payload = () => ({
    accountId,
    kind: "pdf" as const,
    rows: chosen.map((r) => ({
      line: r.line,
      postedDate: r.postedDate,
      amountCents: r.amountCents,
      description: r.description,
      payee: null,
      memo: null,
    })),
  });

  const check = () =>
    start(async () => {
      setError(undefined);
      const r = await previewCsvAction(bookId, payload());
      if (!r.ok) setError(r.error);
      else setChecked(r.rows ?? []);
    });

  const doImport = () =>
    start(async () => {
      const r = await importCsvAction(bookId, payload());
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast.success(`Imported ${r.count} ${r.count === 1 ? "transaction" : "transactions"}.`, {
        description: r.skipped ? `${r.skipped} already imported were skipped.` : undefined,
      });
      router.push(`/books/${bookId}/review`);
    });

  const toggle = (line: number) => {
    setLeft((s) => {
      const n = new Set(s);
      if (n.has(line)) n.delete(line);
      else n.add(line);
      return n;
    });
    setChecked(null);
  };

  const statusByLine = new Map(checked?.map((c) => [c.line, c]) ?? []);
  const counts = checked
    ? {
        fresh: checked.filter((c) => c.status === "new").length,
        dup: checked.filter((c) => c.status === "possible_duplicate").length,
        skipped: checked.filter((c) => c.status === "imported" || c.status === "before_start")
          .length,
      }
    : null;
  const owed = accounts.find((a) => a.id === accountId)?.type === "liability";
  const balance = checkBalances(begin, end, chosen, owed);
  const balanceBlocks = balance.state === "invalid" || (balance.state === "off" && !confirmed);
  const flipRow = (line: number) => {
    setFlipped((s) => {
      const n = new Set(s);
      if (n.has(line)) n.delete(line);
      else n.add(line);
      return n;
    });
    setChecked(null);
  };
  const totalIn = chosen.filter((r) => r.amountCents > 0).reduce((s, r) => s + r.amountCents, 0);
  const totalOut = chosen.filter((r) => r.amountCents < 0).reduce((s, r) => s + r.amountCents, 0);

  return (
    <div className="flex flex-col gap-8">
      <FormError message={error} />
      <section className="grid gap-4 sm:grid-cols-2">
        <Field label="Account" htmlFor={`${uid}-account`}>
          <SelectInput
            id={`${uid}-account`}
            value={accountId}
            onChange={(e) => {
              setAccountId(e.target.value);
              // Signs depend on the account (a card's charges are money out), so read again.
              read(e.target.value);
            }}
          >
            <option value="">Choose the account this statement is for</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field
          label="PDF statement"
          htmlFor={`${uid}-file`}
          hint={
            fileName ||
            (accountId
              ? "Up to 10 MB. Read on this server; never stored or sent anywhere."
              : "Choose the account first.")
          }
        >
          <label
            className={buttonClass(
              "secondary",
              "md",
              `justify-start has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--focus)] ${
                accountId ? "cursor-pointer" : "pointer-events-none opacity-50"
              }`,
            )}
          >
            <input
              id={`${uid}-file`}
              type="file"
              accept=".pdf,application/pdf"
              className="sr-only"
              disabled={!accountId}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                file.current = f;
                setFileName(f.name);
                read(accountId);
              }}
            />
            <FileText size={15} aria-hidden />
            <PendingLabel pending={reading} label="Reading the PDF">
              {fileName ? "Choose a different PDF" : "Choose a PDF"}
            </PendingLabel>
          </label>
        </Field>
      </section>

      {result ? (
        <section className="flex flex-col gap-3" aria-busy={reading || undefined}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[0.9375rem] font-semibold text-ink">
              {rows.length} {rows.length === 1 ? "transaction" : "transactions"} found
              {result.periodStart && result.periodEnd ? (
                <span className="font-normal text-ink-muted">
                  {" "}
                  for {formatDay(result.periodStart)} to {formatDay(result.periodEnd)}
                </span>
              ) : null}
            </h2>
            <p className="tabular text-sm text-ink-muted">
              In <Money cents={totalIn} />, out <Money cents={totalOut} />
            </p>
          </div>
          {result.notes.map((n) => (
            <p key={n} className="text-sm text-ink-muted">
              {n}
            </p>
          ))}
          <label className="flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-[var(--signal)]"
              checked={flip}
              onChange={(e) => {
                setFlip(e.target.checked);
                setChecked(null);
              }}
            />
            <span>
              Money in and money out are the wrong way round
              <span className="block text-[0.8125rem] text-ink-muted">
                Money out of the account should read as negative below.
              </span>
            </span>
          </label>

          <BalanceCheckPanel
            begin={begin}
            end={end}
            onBegin={(v) => {
              setBegin(v);
              setFromStatement(false);
            }}
            onEnd={(v) => {
              setEnd(v);
              setFromStatement(false);
            }}
            check={balance}
            owed={owed}
            fromStatement={fromStatement}
            describe={(line) => rows.find((r) => r.line === line)?.description ?? ""}
            onFlipRow={flipRow}
            onFlipAll={() => {
              setFlip((f) => !f);
              setChecked(null);
            }}
            confirmed={confirmed}
            onConfirm={setConfirmed}
          />

          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-b border-rule-strong text-left text-xs text-ink-muted">
                  <th className="w-8 py-2 pr-2 font-medium">
                    <span className="sr-only">Include</span>
                  </th>
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">Description</th>
                  <th className="py-2 pr-3 text-right font-medium">Amount</th>
                  {checked ? <th className="py-2 font-medium">Status</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const out = left.has(r.line);
                  const st = statusByLine.get(r.line);
                  const early = r.postedDate < startDate;
                  return (
                    <tr
                      key={r.line}
                      className={`border-b border-rule hover:bg-sunken/70 ${out || (st && st.status !== "new") ? "text-ink-muted" : ""}`}
                    >
                      <td className="py-2 pr-2 align-top">
                        <input
                          type="checkbox"
                          className="mt-0.5 size-4 accent-[var(--signal)]"
                          checked={!out}
                          onChange={() => toggle(r.line)}
                          aria-label={`Include ${r.description}`}
                        />
                      </td>
                      <td className="tabular whitespace-nowrap py-2 pr-3 align-top text-ink-muted">
                        {formatDay(r.postedDate)}
                      </td>
                      <td className={`py-2 pr-3 align-top ${out ? "line-through" : ""}`}>
                        {r.description}
                        {r.signGuessed && !out && !flipped.has(r.line) ? (
                          <span className="ml-2 rounded bg-sunken px-1.5 py-px text-xs text-ink-muted">
                            Check sign
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3 text-right align-top">
                        <div className="flex items-center justify-end gap-1">
                          <Money cents={r.amountCents} />
                          <IconButton
                            size="sm"
                            className="-my-1.5"
                            title="Flip the sign"
                            aria-label={`Flip the sign of ${r.description}`}
                            aria-pressed={flipped.has(r.line)}
                            onClick={() => flipRow(r.line)}
                          >
                            <ArrowUpDown size={14} aria-hidden />
                          </IconButton>
                        </div>
                      </td>
                      {checked ? (
                        <td className="py-2 align-top text-[0.8125rem]">
                          {out
                            ? "Left out"
                            : st
                              ? STATUS_LABEL[st.status]
                              : early
                                ? STATUS_LABEL.before_start
                                : ""}
                          {st?.duplicateOfText ? (
                            <span className="block text-ink-muted">Like {st.duplicateOfText}</span>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-4">
            {!checked ? (
              <Button
                variant="primary"
                onClick={check}
                disabled={reading || chosen.length === 0}
                pending={pending}
                pendingLabel="Checking"
              >
                Check for duplicates
              </Button>
            ) : (
              <>
                <Button
                  variant="primary"
                  onClick={doImport}
                  disabled={counts!.fresh + counts!.dup === 0 || balanceBlocks}
                  pending={pending}
                  pendingLabel="Importing"
                >
                  Send {counts!.fresh + counts!.dup} to review
                </Button>
                <p className="text-sm text-ink-muted">
                  {counts!.fresh} new
                  {counts!.dup ? `, ${counts!.dup} flagged as possible duplicates` : ""}
                  {counts!.skipped ? `, ${counts!.skipped} skipped` : ""}.
                </p>
              </>
            )}
          </div>
        </section>
      ) : reading ? (
        <p className="text-sm text-ink-muted">Reading the statement.</p>
      ) : null}
    </div>
  );
}
