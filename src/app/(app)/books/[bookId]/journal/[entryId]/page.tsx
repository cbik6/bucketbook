import { History, Pencil } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell";
import { Money } from "@/components/money";
import { ButtonLink } from "@/components/ui/button";
import { formatDay } from "@/lib/dates";
import { formatEntryNumber } from "@/lib/ledger-math";
import { listAttachments } from "@/server/bank/attachments-service";
import { entryBankContext } from "@/server/bank/review-service";
import { getDb } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { loadBookForPage } from "@/server/guards";
import { getEntryDetail } from "@/server/ledger/service";
import { Attachments } from "../../attachments";
import { reverseEntryAction } from "../actions";
import { KindBadge } from "../kind-badge";
import { ReverseForm } from "./reverse-form";

export const metadata: Metadata = { title: "Journal entry" };

const stamp = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

async function EntryContent({
  params,
  searchParams,
}: PageProps<"/books/[bookId]/journal/[entryId]">) {
  await connection();
  const { bookId, entryId } = await params;
  const sp = await searchParams;
  const { user, book } = await loadBookForPage(bookId);
  const requested = typeof sp.version === "string" ? Number(sp.version) : undefined;
  const detail = await getEntryDetail(getDb(), book.id, entryId, requested).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const { entry, lines, versions, reversedBy, reverses, shownVersion, versionHeader } = detail;
  const [bank, files] = await Promise.all([
    entryBankContext(getDb(), user.id, book.id, entry),
    listAttachments(getDb(), book.id, { entryId: entry.id }),
  ]);
  const base = `/books/${book.id}`;
  const label = formatEntryNumber(entry.entryNumber);
  const isOld = shownVersion !== entry.currentVersion;
  const canEdit = book.role !== "viewer";
  const editable =
    canEdit && ["manual", "bank", "transfer"].includes(entry.kind) && !reversedBy && !isOld;
  const reverseNotes: string[] = [];
  if (bank.bankTransactions.length) {
    const n = bank.bankTransactions.length;
    reverseNotes.push(
      `The ${n === 1 ? "bank transaction it records goes" : `${n} bank transactions it records go`} back to For review.`,
    );
  }
  for (const p of bank.partners) {
    reverseNotes.push(
      `The other side, ${formatEntryNumber(p.entryNumber)} in ${p.bookName}, is not reversed. Reverse it there too.`,
    );
  }
  const reversible = canEdit && entry.kind !== "reversal" && !reversedBy && !isOld;
  const debits = lines.reduce((n, l) => n + l.debitCents, 0);
  const credits = lines.reduce((n, l) => n + l.creditCents, 0);
  const saved = sp.saved === "1";

  return (
    <>
      <PageHeader
        title={label}
        maxWidthClass="max-w-[60rem]"
        description={
          <>
            <span className="tabular">{formatDay(versionHeader.entryDate, "long")}</span>
            <KindBadge
              kind={entry.kind}
              reversed={Boolean(reversedBy)}
              version={entry.currentVersion}
            />
          </>
        }
        actions={
          editable ? (
            <ButtonLink href={`${base}/journal/${entry.id}/edit`} variant="secondary">
              <Pencil size={15} aria-hidden />
              Edit
            </ButtonLink>
          ) : entry.kind === "opening_balance" && canEdit && !reversedBy ? (
            <ButtonLink href={`${base}/opening-balances`} variant="secondary">
              <Pencil size={15} aria-hidden />
              Edit opening balances
            </ButtonLink>
          ) : null
        }
      />
      <div className="box-content flex max-w-[60rem] flex-col gap-6 px-5 pb-16 pt-6 lg:px-10">
        {saved ? (
          <p role="status" className="rounded-xl bg-signal-soft px-4 py-3 text-sm">
            Saved. This entry is in the ledger.
          </p>
        ) : null}
        {isOld ? (
          <p className="rounded-xl border border-rule bg-sunken px-4 py-3 text-sm">
            You are looking at version {shownVersion}, which was replaced.{" "}
            <Link
              href={`${base}/journal/${entry.id}`}
              className="font-medium text-signal-ink underline"
            >
              See the current version
            </Link>
          </p>
        ) : null}
        {reversedBy ? (
          <p className="rounded-xl border border-rule bg-sunken px-4 py-3 text-sm">
            Reversed by{" "}
            <Link
              href={`${base}/journal/${reversedBy.id}`}
              className="font-medium text-signal-ink underline"
            >
              {formatEntryNumber(reversedBy.entryNumber)}
            </Link>
            . It can no longer be edited.
          </p>
        ) : null}
        {reverses ? (
          <p className="rounded-xl border border-rule bg-sunken px-4 py-3 text-sm">
            This entry reverses{" "}
            <Link
              href={`${base}/journal/${reverses.id}`}
              className="font-medium text-signal-ink underline"
            >
              {formatEntryNumber(reverses.entryNumber)}
            </Link>
            .
          </p>
        ) : null}

        {versionHeader.payee || versionHeader.memo ? (
          <div className="max-w-prose">
            {versionHeader.payee ? <p className="font-medium">{versionHeader.payee}</p> : null}
            {versionHeader.memo ? (
              <p className={versionHeader.payee ? "text-sm text-ink-muted" : "font-medium"}>
                {versionHeader.memo}
              </p>
            ) : null}
          </div>
        ) : null}

        {bank.partners.map((p) => (
          <p key={p.entryId} className="rounded-xl border border-rule bg-sunken px-4 py-3 text-sm">
            The other side of this transfer is{" "}
            <Link
              href={`/books/${p.bookId}/journal/${p.entryId}`}
              className="font-medium text-signal-ink underline"
            >
              {formatEntryNumber(p.entryNumber)} in {p.bookName}
            </Link>
            . If you change or reverse this entry, do the same there.
          </p>
        ))}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <thead>
              <tr className="border-b border-rule-strong text-left text-xs text-ink-muted">
                <th scope="col" className="py-2 pr-3 font-medium">
                  Account
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Memo
                </th>
                <th scope="col" className="w-32 py-2 pr-3 text-right font-medium">
                  Debit
                </th>
                <th scope="col" className="w-32 py-2 text-right font-medium">
                  Credit
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-b border-rule">
                  <td className="py-2.5 pr-3">
                    <Link href={`${base}/accounts/${l.accountId}`} className="hover:underline">
                      {l.accountCode ? (
                        <span className="mr-2 font-mono text-[0.8125rem] text-ink-muted">
                          {l.accountCode}
                        </span>
                      ) : null}
                      {l.accountName}
                    </Link>
                  </td>
                  <td className="py-2.5 pr-3 text-ink-muted">{l.memo}</td>
                  <td className="py-2.5 pr-3 text-right">
                    <Money cents={l.debitCents} blankZero />
                  </td>
                  <td className="py-2.5 text-right">
                    <Money cents={l.creditCents} blankZero />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="py-2.5 pr-3" colSpan={2}>
                  Total
                </td>
                <td className="py-2.5 pr-3 text-right">
                  <Money cents={debits} />
                </td>
                <td className="py-2.5 text-right">
                  <Money cents={credits} />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {reversible ? (
          <div className="flex flex-col items-start gap-2">
            <ReverseForm
              action={reverseEntryAction.bind(null, book.id, entry.id)}
              entryLabel={label}
              notes={reverseNotes}
              minDate={entry.entryDate < book.startDate ? book.startDate : entry.entryDate}
            />
          </div>
        ) : null}

        {bank.bankTransactions.length ? (
          <section aria-labelledby="bank-heading" className="border-t border-rule pt-6">
            <h2 id="bank-heading" className="mb-3 text-base font-semibold">
              From the bank
            </h2>
            <ul className="flex flex-col gap-1.5 text-sm">
              {bank.bankTransactions.map((t) => (
                <li key={t.id} className="flex flex-wrap items-baseline gap-x-3">
                  <span className="tabular text-ink-muted">{formatDay(t.postedDate)}</span>
                  <span>{t.accountName}</span>
                  <span className="text-ink-muted">{t.description}</span>
                  <Money cents={t.amountCents} />
                  {t.postMethod === "linked" ? (
                    <span className="rounded bg-sunken px-1.5 py-px text-xs text-ink-muted">
                      Matched to this entry
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="border-t border-rule pt-6">
          <Attachments
            bookId={book.id}
            target={{ entryId: entry.id }}
            files={files.map((f) => ({
              id: f.id,
              fileName: f.fileName,
              contentType: f.contentType,
            }))}
            canEdit={canEdit}
          />
        </section>

        <section aria-labelledby="history-heading" className="border-t border-rule pt-6">
          <h2 id="history-heading" className="mb-3 flex items-center gap-2 text-base font-semibold">
            <History size={16} aria-hidden className="text-ink-muted" />
            History
          </h2>
          <ol className="flex flex-col gap-2 text-sm">
            {versions.map((v) => (
              <li key={v.version} className="flex flex-wrap items-baseline gap-x-2">
                {v.version === shownVersion ? (
                  <span className="font-medium">Version {v.version}</span>
                ) : (
                  <Link
                    href={`${base}/journal/${entry.id}?version=${v.version}`}
                    className="font-medium text-signal-ink underline"
                  >
                    Version {v.version}
                  </Link>
                )}
                <span className="text-ink-muted">
                  {v.changeNote ?? "Saved"} by {v.createdByName ?? "someone"} on{" "}
                  {stamp.format(v.createdAt)}
                  {v.version === entry.currentVersion ? " (current)" : ""}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-[0.8125rem] text-ink-muted">
            Every change is also in the{" "}
            <Link href={`${base}/activity`} className="underline">
              activity log
            </Link>
            .
          </p>
        </section>
      </div>
    </>
  );
}

export default function EntryPage(props: PageProps<"/books/[bookId]/journal/[entryId]">) {
  return (
    <Suspense>
      <EntryContent {...props} />
    </Suspense>
  );
}
