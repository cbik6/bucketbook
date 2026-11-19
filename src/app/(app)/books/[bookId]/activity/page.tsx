import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageFallback, PageHeader } from "@/components/app-shell";
import { buttonClass } from "@/components/ui/button";
import { listAccounts } from "@/server/accounts/service";
import { describeAudit } from "@/server/audit/describe";
import { listBookActivity } from "@/server/audit/queries";
import { getDb } from "@/server/db/client";
import { loadBookForPage } from "@/server/guards";

export const metadata: Metadata = { title: "Activity" };

const PAGE_SIZE = 50;
const stamp = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

async function ActivityContent({ params, searchParams }: PageProps<"/books/[bookId]/activity">) {
  await connection();
  const { bookId } = await params;
  const sp = await searchParams;
  const { book } = await loadBookForPage(bookId);
  const page = Math.max(1, Number(typeof sp.page === "string" ? sp.page : 1) || 1);
  const [{ rows, total }, accounts] = await Promise.all([
    listBookActivity(getDb(), book.id, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    listAccounts(getDb(), book.id),
  ]);
  const names = new Map(accounts.map((a) => [a.id, a.name]));
  const live = new Set(accounts.map((a) => a.id));
  const base = `/books/${book.id}`;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="Activity"
        maxWidthClass="max-w-[52rem]"
        description="Every change to this book, newest first. Nothing here can be edited."
      />
      <div className="box-content max-w-[52rem] px-5 pb-16 pt-4 lg:px-10">
        <ol className="flex flex-col">
          {rows.map((r) => {
            const d = describeAudit(r, names);
            const href =
              d.link?.kind === "entry"
                ? `${base}/journal/${d.link.id}`
                : d.link?.kind === "account" && live.has(d.link.id)
                  ? `${base}/accounts/${d.link.id}`
                  : d.link?.kind === "rules"
                    ? `${base}/rules`
                    : d.link?.kind === "review"
                      ? `${base}/review`
                      : undefined;
            return (
              <li
                key={r.id}
                className="flex flex-col gap-0.5 border-b border-rule py-3 sm:flex-row sm:gap-6"
              >
                <div className="tabular w-44 shrink-0 text-[0.8125rem] text-ink-muted">
                  {stamp.format(r.createdAt)}
                </div>
                <div className="min-w-0">
                  <div className="text-ink">
                    {href ? (
                      <Link href={href} className="hover:underline">
                        {d.summary}
                      </Link>
                    ) : (
                      d.summary
                    )}
                    <span className="text-ink-muted"> by {r.userName ?? "the app"}</span>
                  </div>
                  {d.details.length ? (
                    <ul className="mt-0.5 text-[0.8125rem] text-ink-muted">
                      {d.details.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
        {pages > 1 ? (
          <nav aria-label="Pages" className="mt-6 flex items-center gap-3 text-sm">
            {page > 1 ? (
              <Link
                href={`${base}/activity?page=${page - 1}`}
                className={buttonClass("secondary", "sm")}
              >
                Newer
              </Link>
            ) : null}
            <span className="tabular text-ink-muted">
              Page {page} of {pages}
            </span>
            {page < pages ? (
              <Link
                href={`${base}/activity?page=${page + 1}`}
                className={buttonClass("secondary", "sm")}
              >
                Older
              </Link>
            ) : null}
          </nav>
        ) : null}
      </div>
    </>
  );
}

export default function ActivityPage(props: PageProps<"/books/[bookId]/activity">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <ActivityContent {...props} />
    </Suspense>
  );
}
