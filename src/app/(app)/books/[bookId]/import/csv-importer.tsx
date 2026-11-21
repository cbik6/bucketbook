"use client";

import { FileUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Money } from "@/components/money";
import { Button, buttonClass, PendingLabel } from "@/components/ui/button";
import { Field, FormError, SelectInput } from "@/components/ui/field";
import {
  type CsvMapping,
  DATE_FORMATS,
  MAX_CSV_BYTES,
  MAX_CSV_ROWS,
  applyMapping,
  csvMappingSchema,
  guessMapping,
  parseCsv,
} from "@/lib/csv-import";
import { formatDay } from "@/lib/dates";
import { checkBalances } from "@/lib/statement-check";
import type { CsvPreviewRow } from "@/server/bank/csv-service";
import { importCsvAction, previewCsvAction } from "./actions";
import { BalanceCheckPanel } from "./balance-check";

type Account = { id: string; name: string; type: string };
type Draft = Partial<CsvMapping>;

const STATUS_LABEL: Record<CsvPreviewRow["status"], string> = {
  new: "New",
  imported: "Already imported, skipped",
  possible_duplicate: "Possible duplicate, flagged",
};

export function CsvImporter({
  bookId,
  accounts,
  presets,
  initialAccountId,
}: {
  bookId: string;
  accounts: Account[];
  presets: Record<string, CsvMapping>;
  initialAccountId: string;
}) {
  const uid = useId();
  const router = useRouter();
  const [accountId, setAccountId] = useState(initialAccountId);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<string[][]>([]);
  const [draft, setDraft] = useState<Draft>({});
  const [error, setError] = useState<string>();
  const [checked, setChecked] = useState<CsvPreviewRow[] | null>(null);
  const [begin, setBegin] = useState("");
  const [end, setEnd] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [pending, start] = useTransition();

  const header = rows[0] ?? [];
  const width = Math.max(0, ...rows.slice(0, 20).map((r) => r.length));
  const columns = Array.from({ length: width }, (_, i) => ({
    index: i,
    label: draft.hasHeader !== false && header[i]?.trim() ? header[i]!.trim() : `Column ${i + 1}`,
  }));

  const mapping = useMemo(() => {
    const parsed = csvMappingSchema.safeParse(draft);
    return parsed.success ? parsed.data : null;
  }, [draft]);
  const mapped = useMemo(() => (mapping ? applyMapping(rows, mapping) : null), [rows, mapping]);

  const set = (patch: Draft) => {
    setDraft((d) => ({ ...d, ...patch }));
    setChecked(null);
  };

  const loadFile = async (file: File | undefined) => {
    setError(undefined);
    setChecked(null);
    if (!file) return;
    if (file.size > MAX_CSV_BYTES) {
      setError("That file is over 5 MB. Split it into smaller date ranges.");
      return;
    }
    const parsed = parseCsv(await file.text());
    if (parsed.length < 1) {
      setError("That file has no rows.");
      return;
    }
    if (parsed.length > MAX_CSV_ROWS + 1) {
      setError(`That file has more than ${MAX_CSV_ROWS} rows. Split it into smaller date ranges.`);
      return;
    }
    setFileName(file.name);
    setRows(parsed);
    const preset = accountId ? presets[accountId] : undefined;
    setDraft(preset ?? guessMapping(parsed[0] ?? [], parsed.slice(1, 11)));
  };

  const payload = () => ({
    accountId,
    mapping,
    rows: mapped?.rows ?? [],
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

  const counts = checked
    ? {
        fresh: checked.filter((c) => c.status === "new").length,
        dup: checked.filter((c) => c.status === "possible_duplicate").length,
        skipped: checked.filter((c) => c.status === "imported").length,
      }
    : null;
  const statusByLine = new Map(checked?.map((c) => [c.line, c]) ?? []);
  const owed = accounts.find((a) => a.id === accountId)?.type === "liability";
  const balance = checkBalances(begin, end, mapped?.rows ?? [], owed);
  const balanceBlocks = balance.state === "invalid" || (balance.state === "off" && !confirmed);

  return (
    <div className="flex flex-col gap-8">
      <FormError message={error} />
      <section className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Account"
          htmlFor={`${uid}-account`}
          hint={
            accountId && presets[accountId] ? "Uses the columns you chose last time." : undefined
          }
        >
          <SelectInput
            id={`${uid}-account`}
            value={accountId}
            onChange={(e) => {
              setAccountId(e.target.value);
              const preset = presets[e.target.value];
              if (preset && rows.length) setDraft(preset);
              setChecked(null);
            }}
          >
            <option value="">Choose the account this file is for</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="CSV file" htmlFor={`${uid}-file`} hint={fileName || "Up to 5 MB."}>
          <label
            className={buttonClass(
              "secondary",
              "md",
              "cursor-pointer justify-start has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--focus)]",
            )}
          >
            <input
              id={`${uid}-file`}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="sr-only"
              onChange={(e) => loadFile(e.target.files?.[0])}
            />
            <FileUp size={15} aria-hidden />
            {fileName ? "Choose a different file" : "Choose a file"}
          </label>
        </Field>
      </section>

      {rows.length > 0 ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-[0.9375rem] font-semibold text-ink">Match the columns</h2>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="size-4 accent-[var(--signal)]"
              checked={draft.hasHeader !== false}
              onChange={(e) => set({ hasHeader: e.target.checked })}
            />
            The first row holds column names
          </label>
          <div className="grid gap-4 sm:grid-cols-3">
            <ColumnSelect
              label="Date"
              columns={columns}
              value={draft.dateColumn}
              onChange={(v) => set({ dateColumn: v ?? undefined })}
            />
            <Field label="Date format" htmlFor={`${uid}-datefmt`}>
              <SelectInput
                id={`${uid}-datefmt`}
                value={draft.dateFormat ?? ""}
                onChange={(e) =>
                  set({ dateFormat: (e.target.value || undefined) as CsvMapping["dateFormat"] })
                }
              >
                <option value="">Choose</option>
                {DATE_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <ColumnSelect
              label="Description"
              columns={columns}
              value={draft.descriptionColumn}
              onChange={(v) => set({ descriptionColumn: v ?? undefined })}
            />
            <ColumnSelect
              label="Payee"
              optional
              columns={columns}
              value={draft.payeeColumn}
              onChange={(v) => set({ payeeColumn: v })}
            />
            <ColumnSelect
              label="Memo"
              optional
              columns={columns}
              value={draft.memoColumn}
              onChange={(v) => set({ memoColumn: v })}
            />
          </div>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-[0.8125rem] font-medium text-ink">Amounts</legend>
            <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="radio"
                  name={`${uid}-mode`}
                  className="size-4 accent-[var(--signal)]"
                  checked={draft.amountMode !== "split"}
                  onChange={() => set({ amountMode: "signed" })}
                />
                One amount column
              </label>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="radio"
                  name={`${uid}-mode`}
                  className="size-4 accent-[var(--signal)]"
                  checked={draft.amountMode === "split"}
                  onChange={() => set({ amountMode: "split" })}
                />
                Separate money out and money in columns
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {draft.amountMode === "split" ? (
                <>
                  <ColumnSelect
                    label="Money out"
                    columns={columns}
                    value={draft.outflowColumn}
                    onChange={(v) => set({ outflowColumn: v })}
                  />
                  <ColumnSelect
                    label="Money in"
                    columns={columns}
                    value={draft.inflowColumn}
                    onChange={(v) => set({ inflowColumn: v })}
                  />
                </>
              ) : (
                <ColumnSelect
                  label="Amount"
                  columns={columns}
                  value={draft.amountColumn}
                  onChange={(v) => set({ amountColumn: v, amountMode: "signed" })}
                />
              )}
            </div>
            <label className="flex items-start gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-[var(--signal)]"
                checked={draft.flipSign ?? false}
                onChange={(e) => set({ flipSign: e.target.checked })}
              />
              <span>
                Purchases show as positive numbers in this file
                <span className="block text-[0.8125rem] text-ink-muted">
                  Common for credit card exports. Money out should read as negative below.
                </span>
              </span>
            </label>
          </fieldset>
        </section>
      ) : null}

      {mapped ? (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[0.9375rem] font-semibold text-ink">
              {mapped.rows.length} {mapped.rows.length === 1 ? "row" : "rows"} read
            </h2>
            {mapped.problems.length ? (
              <p className="text-sm text-negative">
                {mapped.problems.length} unreadable, will be left out (line{" "}
                {mapped.problems
                  .slice(0, 5)
                  .map((p) => p.line)
                  .join(", ")}
                {mapped.problems.length > 5 ? " and more" : ""}).
              </p>
            ) : null}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr className="border-b border-rule-strong text-left text-xs text-ink-muted">
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">Description</th>
                  <th className="py-2 pr-3 text-right font-medium">Amount</th>
                  {checked ? <th className="py-2 font-medium">Status</th> : null}
                </tr>
              </thead>
              <tbody>
                {mapped.rows.slice(0, checked ? 200 : 8).map((r) => {
                  const st = statusByLine.get(r.line);
                  return (
                    <tr
                      key={r.line}
                      className={`border-b border-rule ${st && st.status !== "new" ? "text-ink-muted" : ""}`}
                    >
                      <td className="tabular whitespace-nowrap py-2 pr-3 text-ink-muted">
                        {formatDay(r.postedDate)}
                      </td>
                      <td className="py-2 pr-3">{r.payee ?? r.description}</td>
                      <td className="py-2 pr-3 text-right">
                        <Money cents={r.amountCents} />
                      </td>
                      {checked ? (
                        <td className="py-2 text-[0.8125rem]">
                          {st ? STATUS_LABEL[st.status] : ""}
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
          {!checked && mapped.rows.length > 8 ? (
            <p className="text-[0.8125rem] text-ink-muted">Showing the first 8 rows.</p>
          ) : null}

          <BalanceCheckPanel
            begin={begin}
            end={end}
            onBegin={setBegin}
            onEnd={setEnd}
            check={balance}
            owed={owed}
            fromStatement={false}
            describe={(line) => {
              const r = mapped.rows.find((x) => x.line === line);
              return r ? (r.payee ?? r.description) : "";
            }}
            onFlipAll={() => set({ flipSign: !(draft.flipSign ?? false) })}
            confirmed={confirmed}
            onConfirm={setConfirmed}
          />

          <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-4">
            {!checked ? (
              <Button
                variant="primary"
                onClick={check}
                disabled={pending || !accountId || mapped.rows.length === 0}
              >
                <PendingLabel pending={pending} label="Checking">
                  Check for duplicates
                </PendingLabel>
              </Button>
            ) : (
              <>
                <Button
                  variant="primary"
                  onClick={doImport}
                  disabled={pending || counts!.fresh + counts!.dup === 0 || balanceBlocks}
                >
                  <PendingLabel pending={pending} label="Importing">
                    Send {counts!.fresh + counts!.dup} to review
                  </PendingLabel>
                </Button>
                <p className="text-sm text-ink-muted">
                  {counts!.fresh} new
                  {counts!.dup ? `, ${counts!.dup} flagged as possible duplicates` : ""}
                  {counts!.skipped ? `, ${counts!.skipped} skipped` : ""}.
                </p>
              </>
            )}
            {!accountId ? (
              <p className="text-sm text-ink-muted">Choose the account first.</p>
            ) : null}
          </div>
        </section>
      ) : rows.length > 0 ? (
        <p className="text-sm text-ink-muted">
          Choose the date, description and amount columns to see a preview.
        </p>
      ) : null}
    </div>
  );
}

function ColumnSelect({
  label,
  columns,
  value,
  onChange,
  optional,
}: {
  label: string;
  columns: { index: number; label: string }[];
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  optional?: boolean;
}) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id} optional={optional}>
      <SelectInput
        id={id}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      >
        <option value="">{optional ? "None" : "Choose"}</option>
        {columns.map((c) => (
          <option key={c.index} value={c.index}>
            {c.label}
          </option>
        ))}
      </SelectInput>
    </Field>
  );
}
