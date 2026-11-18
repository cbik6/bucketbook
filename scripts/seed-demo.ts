/**
 * Creates the demo book from the command line: `npm run seed:demo`, or
 * `npm run seed:demo -- you@example.com` to pick whose it is. The app's Books
 * page has the same thing as a button ("Try a demo book").
 */
import { asc, eq } from "drizzle-orm";
import { todayIso } from "../src/lib/dates";
import { getDb, getPool } from "../src/server/db/client";
import { users } from "../src/server/db/schema";
import { createDemoBook } from "../src/server/demo/seed";

async function main() {
  const email = process.argv[2];
  const db = getDb();
  const [user] = email
    ? await db.select().from(users).where(eq(users.email, email))
    : await db.select().from(users).orderBy(asc(users.createdAt)).limit(1);
  if (!user) throw new Error(email ? `No user with email ${email}` : "Run the setup wizard first.");
  const { bookId } = await createDemoBook(
    db,
    { userId: user.id },
    todayIso(process.env.TZ || undefined),
  );
  console.log(`Demo book created: /books/${bookId}/review`);
  await getPool().end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
