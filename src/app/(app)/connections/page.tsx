import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { requireUser } from "@/server/auth/session";
import { listBooksForUser } from "@/server/books/service";
import { getDb } from "@/server/db/client";

/** Bank connections moved into each book; old links go to the first book you can edit. */
async function Redirect(): Promise<null> {
  await connection();
  const user = await requireUser();
  const books = await listBooksForUser(getDb(), user.id);
  const book = books.find((b) => b.role !== "viewer");
  redirect(book ? `/books/${book.id}/connections` : "/books");
}

export default function OldConnectionsPage() {
  return (
    <Suspense>
      <Redirect />
    </Suspense>
  );
}
