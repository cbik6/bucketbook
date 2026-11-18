import { connection } from "next/server";
import { Suspense } from "react";
import { AppShell, AppShellFallback } from "@/components/app-shell";
import { listBooksForUser } from "@/server/books/service";
import { getDb } from "@/server/db/client";
import { queueCounts } from "@/server/bank/review-service";
import { loadBookForPage } from "@/server/guards";

async function BookShell({ params, children }: LayoutProps<"/books/[bookId]">) {
  // Per-user page: always render at request time, never at build time.
  await connection();
  const { bookId } = await params;
  const { user, book } = await loadBookForPage(bookId);
  const [books, counts] = await Promise.all([
    listBooksForUser(getDb(), user.id),
    queueCounts(getDb(), book.id),
  ]);
  // An archived book is still shown in the switcher while you're looking at it.
  const switcher = books.some((b) => b.id === book.id) ? books : [...books, book];
  return (
    <AppShell user={user} books={switcher} currentBookId={book.id} reviewCount={counts.review}>
      {children}
    </AppShell>
  );
}

export default function BookLayout(props: LayoutProps<"/books/[bookId]">) {
  return (
    <Suspense fallback={<AppShellFallback />}>
      <BookShell {...props} />
    </Suspense>
  );
}
