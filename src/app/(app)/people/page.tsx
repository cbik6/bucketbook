import { connection } from "next/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AppShell, AppShellFallback, PageHeader } from "@/components/app-shell";
import { requireUser } from "@/server/auth/session";
import { listBooksForUser } from "@/server/books/service";
import { getDb } from "@/server/db/client";
import { listPeople } from "@/server/people/service";
import { PeopleManager } from "./people-manager";

export const metadata: Metadata = { title: "People" };

async function PeopleContent() {
  // Per-user page: always render at request time, never at build time.
  await connection();
  const user = await requireUser();
  if (!user.isAdmin) notFound();
  const db = getDb();
  const [books, data] = await Promise.all([
    listBooksForUser(db, user.id),
    listPeople(db, { userId: user.id }),
  ]);
  return (
    <AppShell user={user} books={books}>
      <PageHeader
        title="People"
        description="Who can sign in, and what they can do in each book."
      />
      <div className="max-w-3xl px-5 py-8 lg:px-10">
        <PeopleManager
          me={user.id}
          books={data.books.map((b) => ({
            id: b.id,
            name: b.name,
            archived: Boolean(b.archivedAt),
          }))}
          people={data.people}
          invites={data.invites}
        />
      </div>
    </AppShell>
  );
}

export default function PeoplePage() {
  return (
    <Suspense fallback={<AppShellFallback />}>
      <PeopleContent />
    </Suspense>
  );
}
