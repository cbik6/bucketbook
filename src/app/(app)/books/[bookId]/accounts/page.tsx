import { connection } from "next/server";
import { Archive, Lock, Pencil, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageFallback, PageHeader } from "@/components/app-shell";
import { buttonClass, ButtonLink, iconButtonClass } from "@/components/ui/button";
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
import { ParentPosting } from "./parent-posting";
import { Money } from "@/components/money";
import { naturalBalance } from "@/lib/ledger-math";
import { accountTotals } from "@/server/ledger/queries";
import { AccountEditor, type EditorAccount } from "./account-editor";
import { MobileSheetGuard } from "./mobile-sheet-guard";
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
  // Balances in each account's natural direction, with sub-accounts rolled up.
  const totals = await accountTotals(getDb(), book.id);
  const balances = new Map<string, number>();
  const roll = (n: AccountNode<AccountRow>): number => {
    const t = totals.get(n.id);
    const own = t ? naturalBalance(n.type as AccountType, t.debitCents, t.creditCents) : 0;
    const sum = n.children.reduce((acc, c) => acc + roll(c), own);
    balances.set(n.id, sum);
    return sum;
  };
  for (const t of ACCOUNT_TYPES) tree[t].forEach(roll);
  const activeCount = rows.filter((r) => !r.archivedAt).length;
  const archivedCount = rows.length - activeCount;

  const editorAccounts: EditorAccount[] = ACCOUNT_TYPES.flatMap((t) =>
    flattenTree(tree[t], { includeArchived: true }).map((n) => toEditor(n, rows)),
  );
  const editing = editId ? editorAccounts.find((a) => a.id === editId) : undefined;
  const panelOpen = Boolean(editing || (isNew && canEdit));
  // The number column only appears once a book actually uses account numbers.
  const showCodes = rows.some((r) => r.code);
  const templateLabel = CHART_TEMPLATES[book.template as keyof typeof CHART_TEMPLATES]?.label;

  return (
    <>
      <AccountShortcuts newHref={newHref} closeHref={closeHref} panelOpen={panelOpen} />
      <div data-sheet-inert>
        <PageHeader
          title="Chart of accounts"
          maxWidthClass="max-w-[52rem]"
          description={
            <span className="tabular">
              {activeCount} accounts{archivedCount > 0 ? `, ${archivedCount} archived` : ""}
            </span>
          }
          actions={
            <>
              <ParentPosting bookId={book.id} allowed={book.postToParents} canEdit={canEdit} />
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
      </div>

      {welcome ? (
        <div
          data-sheet-inert
          className="mx-5 mt-5 flex max-w-[52rem] items-start justify-between gap-4 rounded-xl bg-signal-soft px-4 py-3 text-sm text-ink lg:mx-10"
        >
          <p>
            <span className="font-medium">Your book is ready.</span> These accounts came from the{" "}
            {templateLabel} template. Rename, add, nest, or archive anything to make it yours. Next,
            enter your{" "}
            <Link
              href={`/books/${book.id}/opening-balances`}
              className="font-medium text-signal-ink underline"
            >
              opening balances
            </Link>
            .
          </p>
          <Link href={closeHref} className="shrink-0 font-medium text-signal-ink underline">
            Got it
          </Link>
        </div>
      ) : null}

      <div className="flex items-stretch">
        <div data-sheet-inert className="min-w-0 flex-1 px-5 pb-16 lg:px-10">
          <div className="max-w-[52rem]">
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
                showCodes={showCodes}
                balances={balances}
              />
            ))}
          </div>
        </div>

        {panelOpen ? (
          <>
            {/* Phones: the editor is a bottom sheet over the list. */}
            <Link
              href={closeHref}
              scroll={false}
              tabIndex={-1}
              aria-hidden
              className="fixed inset-0 z-40 animate-[scrim-in_200ms_var(--ease-out)] bg-scrim lg:hidden"
            />
            <MobileSheetGuard />
            <aside
              data-account-editor
              aria-label={editing ? `Edit ${editing.name}` : "New account"}
              className="fixed inset-x-0 bottom-0 z-50 max-h-[88dvh] overflow-y-auto rounded-t-2xl bg-surface pb-[env(safe-area-inset-bottom)] shadow-[var(--shadow-float)] animate-[sheet-rise_400ms_var(--ease-drawer)] lg:static lg:z-auto lg:max-h-none lg:w-[26rem] lg:shrink-0 lg:animate-none lg:overflow-visible lg:rounded-none lg:border-l lg:border-rule lg:pb-0 lg:shadow-none"
            >
              <div
                aria-hidden
                className="mx-auto mt-2 h-1 w-10 rounded-full bg-rule-strong lg:hidden"
              />
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
          </>
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
  showCodes,
  balances,
}: {
  type: AccountType;
  nodes: AccountNode<AccountRow>[];
  base: string;
  keep: Record<string, string | undefined>;
  selectedId?: string;
  savedId?: string;
  canEdit: boolean;
  showCodes: boolean;
  balances: Map<string, number>;
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
              {showCodes ? <th scope="col">Number</th> : null}
              <th scope="col">Detail type</th>
              <th scope="col">Balance</th>
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
                        href={`${base}/${n.id}`}
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
                  {showCodes ? (
                    <td className="w-24 py-0 pr-4 font-mono text-[0.8125rem] text-ink-muted">
                      {n.code}
                    </td>
                  ) : null}
                  <td className="hidden w-40 py-0 pr-4 text-ink-muted sm:table-cell">
                    {subtypeLabel(n.type as AccountType, n.subtype)}
                  </td>
                  <td className="w-32 py-0 pr-2 text-right">
                    <Money
                      cents={balances.get(n.id) ?? 0}
                      className={n.children.length > 0 && !selected ? "text-ink-muted" : ""}
                    />
                  </td>
                  <td className="w-20 whitespace-nowrap py-0 text-right">
                    {canEdit ? (
                      <Link
                        href={hrefWith(base, { ...keep, edit: n.id })}
                        scroll={false}
                        aria-label={`Edit ${n.name}`}
                        title="Edit account"
                        className={rowAction}
                      >
                        <Pencil size={14} aria-hidden />
                      </Link>
                    ) : null}
                    {canEdit && !archived ? (
                      <Link
                        href={hrefWith(base, { ...keep, new: "1", parent: n.id })}
                        scroll={false}
                        aria-label={`Add sub-account under ${n.name}`}
                        title="Add sub-account"
                        className={rowAction}
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

/** Row actions show on hover where a pointer can hover, and always on touch screens. */
const rowAction = iconButtonClass({
  size: "sm",
  tone: "raised",
  extra:
    "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100",
});

export default function AccountsPage(props: PageProps<"/books/[bookId]/accounts">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <AccountsContent {...props} />
    </Suspense>
  );
}
