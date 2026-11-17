import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentUser } from "@/server/auth/session";
import { listBooksForUser } from "@/server/books/service";
import { getDb } from "@/server/db/client";
import { getSetupState } from "@/server/setup/service";

/** The front door: sends people to setup, login, or their first book. */
async function Route(): Promise<null> {
  // Per-user page: always render at request time, never at build time.
  await connection();
  const db = getDb();
  const setup = await getSetupState(db);
  if (!setup.completed) redirect("/setup");
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [first] = await listBooksForUser(db, user.id);
  redirect(first ? `/books/${first.id}/accounts` : "/books");
}

export default function Home() {
  return (
    <Suspense>
      <Route />
    </Suspense>
  );
}
