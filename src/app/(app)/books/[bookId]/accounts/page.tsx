import { connection } from "next/server";
import { Archive, Lock, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { type AccountNode, buildAccountTree, descendantIds, flattenTree } from "@/lib/account-tree";
import {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPE_SINGULAR,
  type AccountType,
  isAccountType,
  subtypeLabel,
} from "@/lib/account-types";
import { type AccountRow, listAccounts } from "@/server/accounts/service";
import { CHART_TEMPLATES } from "@/server/accounts/templates";
import { getDb } from "@/server/db/client";
import { loadBookForPage } from "@/server/guards";
import { AccountEditor, type EditorAccount } from "./account-editor";
import { AccountShortcuts } from "./shortcuts";

export const metadata: Metadata = { title: "Chart of accounts" };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

function hrefWith(base: string, params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

async function AccountsContent({ params, searchParams }: PageProps<"/books/[bookId]/accounts">) {
  // Per-user page: always render at request time, never at build time.
  await connection();
  const { bookId } = await params;
  const sp: Search = await searchParams;
  const { book } = await loadBookForPage(bookId);
  const rows = await listAccounts(getDb(), book.id);

  const showArchived = one(sp.archived) === "1";
  const editId = one(sp.edit);
  const isNew = one(sp.new) === "1";
  const newType = one(sp.type);
  const newParent = one(sp.parent);
  const savedId = one(sp.saved);
  const welcome = one(sp.welcome) === "1";
  const canEdit = book.role !== "viewer";

  const base = `/books/${book.id}/accounts`;
  const keep = { archived: showArchived ? "1" : undefined };
  const closeHref = hrefWith(base, keep);
  const newHref = hrefWith(base, { ...keep, new: "1" });

  const tree = buildAccountTree(rows);
  const activeCount = rows.filter((r) => !r.archivedAt).length;
  const archivedCount = rows.length - activeCount;

  const editorAccounts: EditorAccount[] = ACCOUNT_TYPES.flatMap((t) =>
    flattenTree(tree[t], { includeArchived: true }).map((n) => toEditor(n, rows)),
  );
  const editing = editId ? editorAccounts.find((a) => a.id === editId) : undefined;
  const panelOpen = Boolean(editing || (isNew && canEdit));
  const templateLabel = CHART_TEMPLATES[book.template as keyof typeof CHART_TEMPLATES]?.label;

  return (
    <>
      <AccountShortcuts newHref={newHref} closeHref={closeHref} panelOpen={panelOpen} />
      <PageHeader
        title="Chart of accounts"
        description={
          <span className="tabular">
            {activeCount} accounts{archivedCount > 0 ? `, ${archivedCount} archived` : ""}
          </span>
        }
        actions={
          <>
            {archivedCount > 0 || showArchived ? (
              <Link
                href={hrefWith(base, { archived: showArchived ? undefined : "1" })}
                scroll={false}
                className={buttonClass("ghost", "md")}
                aria-pressed={showArchived}
              >
                <Archive size={16} aria-hidden />
                {showArchived ? "Hide archived" : "Show archived"}
              </Link>
            ) : null}
            {canEdit ? (
              <ButtonLink href={newHref} scroll={false} variant="primary">
                <Plus size={16} aria-hidden />
                New account
                <kbd className="ml-1 hidden rounded border border-on-signal/25 px-1 font-sans text-[0.6875rem] font-medium leading-4 opacity-70 sm:inline">
                  N
                </kbd>
              </ButtonLink>
            ) : null}
          </>
        }
      />

      {welcome ? (
        <div className="mx-5 mt-5 flex items-start justify-between gap-4 rounded-xl bg-signal-soft px-4 py-3 text-sm text-ink lg:mx-10">
          <p>
            <span className="font-medium">Your book is ready.</span> These accounts came from the{" "}
            {templateLabel} template. Rename, add, nest, or archive anything to make it yours.
          </p>
          <Link href={closeHref} className="shrink-0 font-medium text-signal-ink underline">
            Got it
          </Link>
        </div>
      ) : null}

      <div className="flex items-stretch">
        <div className={`min-w-0 flex-1 px-5 pb-16 lg:px-10 ${panelOpen ? "hidden lg:block" : ""}`}>
          {ACCOUNT_TYPES.map((type) => (
            <TypeSection
              key={type}
              type={type}
              nodes={flattenTree(tree[type], { includeArchived: showArchived })}
              base={base}
              keep={keep}
              selectedId={editing?.id}
              savedId={savedId}
              canEdit={canEdit}
            />
          ))}
        </div>

        {panelOpen ? (
          <aside
            aria-label={editing ? `Edit ${editing.name}` : "New account"}
            className="w-full shrink-0 border-rule bg-surface lg:w-[26rem] lg:border-l"
          >
            <div className="lg:sticky lg:top-0 lg:max-h-dvh lg:overflow-y-auto">
              <AccountEditor
                key={editing?.id ?? `new-${newType}-${newParent}`}
                bookId={book.id}
                closeHref={closeHref}
                canEdit={canEdit}
                accounts={editorAccounts}
                account={editing}
                defaultType={newType && isAccountType(newType) ? newType : undefined}
                defaultParentId={newParent}
              />
            </div>
          </aside>
        ) : null}
      </div>
    </>
  );
}

function toEditor(n: AccountNode<AccountRow>, rows: AccountRow[]): EditorAccount {
  return {
    id: n.id,
    name: n.name,
    code: n.code,
    type: n.type as AccountType,
    subtype: n.subtype,
    description: n.description,
    parentAccountId: n.parentAccountId,
    archived: Boolean(n.archivedAt),
    isSystem: n.isSystem,
    isBucket: n.isBucket,
    bucketsEnabled: n.bucketsEnabled,
    depth: n.depth,
    hasChildren: n.children.length > 0,
    descendantIds: [...descendantIds(rows, n.id)],
  };
}

function TypeSection({
  type,
  nodes,
  base,
  keep,
  selectedId,
  savedId,
  canEdit,
}: {
  type: AccountType;
  nodes: AccountNode<AccountRow>[];
  base: string;
  keep: Record<string, string | undefined>;
  selectedId?: string;
  savedId?: string;
  canEdit: boolean;
}) {
  const headingId = `type-${type}`;
  return (
    <section aria-labelledby={headingId} className="mt-8">
      <div className="flex items-baseline justify-between gap-3 border-b border-rule-strong pb-2">
        <h2 id={headingId} className="text-[0.9375rem] font-semibold text-ink">
          {ACCOUNT_TYPE_LABELS[type]}
          <span className="tabular ml-2 text-[0.8125rem] font-normal text-ink-muted">
            {nodes.length}
          </span>
        </h2>
        {canEdit ? (
          <Link
            href={hrefWith(base, { ...keep, new: "1", type })}
            scroll={false}
            className="rounded text-[0.8125rem] font-medium text-ink-muted hover:text-ink"
          >
            Add {ACCOUNT_TYPE_SINGULAR[type].toLowerCase()} account
          </Link>
        ) : null}
      </div>

      {nodes.length === 0 ? (
        <p className="py-4 text-sm text-ink-muted">
          No {ACCOUNT_TYPE_LABELS[type].toLowerCase()} accounts yet.
        </p>
      ) : (
        <table className="w-full text-sm">
          <caption className="sr-only">{ACCOUNT_TYPE_LABELS[type]} accounts</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Number</th>
              <th scope="col">Detail type</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((n) => {
              const selected = n.id === selectedId;
              const archived = Boolean(n.archivedAt);
              return (
                <tr
                  key={n.id}
                  data-saved={n.id === savedId || undefined}
                  className={`group border-b border-rule transition-colors duration-150 data-[saved]:animate-[saved-flash_1.6s_var(--ease-out)] ${
                    selected ? "bg-signal-soft" : "hover:bg-sunken/70"
                  }`}
                >
                  <td className="py-0">
                    <div
                      className="flex h-11 items-center"
                      style={{ paddingLeft: `${n.depth * 1.25}rem` }}
                    >
                      {n.depth > 0 ? (
                        <span aria-hidden className="mr-2 h-px w-2.5 shrink-0 bg-rule-strong" />
                      ) : null}
                      <Link
                        href={hrefWith(base, { ...keep, edit: n.id })}
                        scroll={false}
                        aria-current={selected ? "true" : undefined}
                        className={`min-w-0 truncate rounded hover:underline ${
                          archived ? "text-ink-muted line-through decoration-ink-faint" : "text-ink"
                        } ${n.depth === 0 ? "font-medium" : ""}`}
                      >
                        {n.name}
                      </Link>
                      {n.isSystem ? (
                        <Lock
                          size={13}
                          className="ml-2 shrink-0 text-ink-muted"
                          aria-label="Used by the app"
                        />
                      ) : null}
                      {archived ? (
                        <span className="ml-2 shrink-0 rounded bg-sunken px-1.5 text-xs text-ink-muted">
                          Archived
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="w-24 py-0 pr-4 font-mono text-[0.8125rem] text-ink-muted">
                    {n.code}
                  </td>
                  <td className="hidden w-48 py-0 pr-4 text-ink-muted sm:table-cell">
                    {subtypeLabel(n.type as AccountType, n.subtype)}
                  </td>
                  <td className="w-10 py-0 text-right">
                    {canEdit && !archived ? (
                      <Link
                        href={hrefWith(base, { ...keep, new: "1", parent: n.id })}
                        scroll={false}
                        aria-label={`Add sub-account under ${n.name}`}
                        title="Add sub-account"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-[opacity,background-color,transform] duration-150 hover:bg-surface hover:text-ink active:scale-[0.95] [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"
                      >
                        <Plus size={15} aria-hidden />
                      </Link>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default function AccountsPage(props: PageProps<"/books/[bookId]/accounts">) {
  return (
    <Suspense
      fallback={
        <div className="px-5 pt-10 lg:px-10">
          <div className="h-7 w-56 animate-pulse rounded bg-rule" />
        </div>
      }
    >
      <AccountsContent {...props} />
    </Suspense>
  );
}
