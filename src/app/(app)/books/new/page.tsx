import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell, AppShellFallback, PageHeader } from "@/components/app-shell";
import { BookForm } from "@/components/book-form";
import { templateSummaries } from "@/server/accounts/templates";
import { requireUser } from "@/server/auth/session";
import { listBooksForUser } from "@/server/books/service";
import { getDb } from "@/server/db/client";
import { createBookAction } from "../actions";

export const metadata: Metadata = { title: "New book" };

async function NewBookContent() {
  const user = await requireUser();
  const books = await listBooksForUser(getDb(), user.id);
  return (
    <AppShell user={user} books={books}>
      <PageHeader
        title="New book"
        description="For another household, business, or side project."
      />
      <div className="max-w-2xl px-5 py-8 lg:px-10">
        <BookForm
          action={createBookAction}
          templates={templateSummaries()}
          defaultStartDate={`${new Date().getFullYear()}-01-01`}
          submitLabel="Create book"
          namePlaceholder="Side business LLC"
        />
      </div>
    </AppShell>
  );
}

export default function NewBookPage() {
  return (
    <Suspense fallback={<AppShellFallback />}>
      <NewBookContent />
    </Suspense>
  );
}
