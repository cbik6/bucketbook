# Decisions

Notable technical decisions, newest at the bottom of each phase. Each entry says what
was decided and why, in plain terms.

## Phase 1: Foundation (2026-11-17)

### D1. npm as the package manager

It ships with Node, so contributors need nothing extra.

### D2. Next.js App Router for UI and server, TypeScript strict everywhere

One codebase and one container for pages, server logic and API routes.

### D3. Next.js Cache Components left on

Next.js 16 enables Cache Components by default and plans to make it mandatory. Every
screen in this app is per-user, so pages read the session inside a `<Suspense>`
boundary and nothing is cached across users. Adopting it now avoids a rewrite later.

### D4. PostgreSQL with Drizzle ORM, SQL migrations committed

Drizzle generates plain SQL files in `drizzle/` that are easy to read and review. Tables
and columns use clear snake_case names (`accounts.parent_account_id`) so the database is
pleasant to query directly.

### D5. Migrations run on startup, inside the app

`src/instrumentation.ts` runs before the server accepts requests: it validates config,
applies pending migrations (under a Postgres advisory lock, so two instances can't race),
then starts the job queue. If anything fails the process exits with a clear message and
Docker restarts it, instead of serving a half-working app. This keeps the image a single
`node server.js` with no separate migration container.

### D6. Money is integer cents

Stored as `bigint` cents. App code uses JavaScript numbers guarded by
`Number.isSafeInteger`, which is exact up to about $90 trillion. Parsing more than two
decimal places is an error rather than a silent rounding.

### D7. Better Auth for email and password sign-in

Its tables are renamed `auth_sessions`, `auth_accounts` and `auth_verifications` so they
are never confused with the chart of accounts; `users` keeps its plain name. IDs are
UUIDs. Better Auth's telemetry is explicitly off. A database hook closes sign-up once
the first user exists (single user for now). Sessions last 30 days.

### D8. Multi-user ready schema

`book_members` (book, user, role of owner, editor or viewer) exists from day one and
every book query goes through it, so sharing later needs UI, not a schema rewrite.

### D9. Chart of accounts integrity in the database, not only in code

- A composite foreign key on `(book_id, parent_account_id)` makes cross-book parents
  impossible.
- Check constraints limit `type` and `subtype` to known values, stop an account from
  being its own parent, and stop a bucket parent from accepting postings.
- Unique indexes: account numbers per book, sibling names per type (case-insensitive),
  and one account per system role per book.
- Rules that need the whole tree (no cycles, children match the parent's type, archive
  children first) live in `src/server/accounts/rules.ts` as pure functions with tests.
  Text plus check constraints were chosen over Postgres enum types because they are
  easier to change in later migrations.

### D10. `accounts.allows_posting` and system roles

Ordinary parent accounts accept postings (QuickBooks style). Bucket parents never do, so
a real account always equals the sum of its buckets. System accounts (Opening Balance
Equity, Retained Earnings) are found by `system_role`, never by name, so users can rename
them safely. They cannot be archived, deleted, moved or retyped.

### D11. Accounts with activity are archived, not deleted

Deleting is allowed only for leaf accounts with no activity. In Phase 1 nothing has
activity yet; `accountHasActivity()` will check journal lines from Phase 2.

### D12. Audit log written in the same transaction as each change

`recordAudit()` stores the row before and after as JSON. Secrets (passwords, tokens, the
SimpleFIN Access URL) are redacted even if a caller passes them in.

### D13. Book templates as data files

Household, Small Business and Blank live in `src/server/accounts/templates/` as plain
TypeScript data, with tests that check every template's integrity (valid detail types,
unique numbers and names, exactly one of each system account).

### D14. `books.currency_code` defaults to USD

Single currency in v1, but the column keeps the door open.

### D15. Job queue: pg-boss inside the app container

Jobs are stored in Postgres (schema `pgboss`), so Compose stays at two services with no
Redis. It is started from the same startup hook and uses at most two connections.

### D16. SimpleFIN credentials encrypted with AES-256-GCM

`APP_ENCRYPTION_KEY` (32 bytes) encrypts the Access URL at rest. The stored value carries
a version prefix so the key or algorithm can be rotated later.

### D17. Setup wizard state is derived from the data

Whether a user exists, whether a book exists, and the `setup_completed_at` setting. An
interrupted wizard resumes at the right step, and it can't be rerun once complete.

### D18. Docker image: Next.js standalone output on node:24-alpine

Three build stages; the runtime image holds only the standalone server, static files and
SQL migrations, and runs as a non-root user. A `HEALTHCHECK` calls `/api/health`.
Postgres 18 mounts its volume at `/var/lib/postgresql` (the layout changed in version 18).

### D19. Low-memory development plan

The dev VM has about 2.6 GB of RAM (sometimes less) plus 4 GB of swap. So:

- Dev Postgres is capped (`shared_buffers=32MB`, `max_connections=30`, 256 MB container
  limit) in `docker-compose.dev.yml`.
- The app's pool is small (`DB_POOL_MAX`, default 5) and pg-boss uses 2 connections.
- Integration tests run one file at a time against a separate `bucketbook_test` database.
- Playwright runs on its own, never alongside Vitest, and runs inside Microsoft's
  Playwright Docker image so the VM needs no browser libraries.
- Avoid parallel heavy builds; stop the dev server before building the image. Production
  image builds move to GitHub Actions in Phase 7.

### D20. End-to-end tests run against a real throwaway install

`scripts/e2e.sh` builds the image, starts a separate compose project on port 3100 with
random secrets, runs Playwright, then removes it with its volumes. That tests the Docker
setup and the first-run wizard exactly as a new user would see them.

### D21. Design direction (superseded by D24)

UI follows the Impeccable skill (product context in `PRODUCT.md`) and Emil Kowalski's
design-engineering skill. Look: a deep spruce navigation rail, warm paper work area, and
a single marigold signal color, with Geist for text and tabular figures. Distinction
comes from interaction craft rather than decoration: press feedback on buttons, menus
that grow from their trigger, press-and-hold to archive instead of confirmation dialogs,
an undo toast, and no animation on keyboard actions. The "fill line" (a clip-path fill)
is the signature element, used for setup progress now and bucket goals in Phase 4. Light
and dark follow the system with a manual toggle.

### D22. Native form controls for selects

Account pickers use the browser's own `<select>`, which is fully keyboard accessible and
behaves well on phones. A searchable picker can come later if lists get long.

### D23. Agent skills are restored, not committed

Third-party skills (Impeccable, Emil Kowalski's skills) are pinned in `skills-lock.json`
and restored with `npx skills experimental_install`, so the public repo doesn't vendor
their files.

## Phase 1 follow-up (2026-11-17)

### D24. Visual direction changed to "Balanced"

After seeing the first build, Clark compared three rounds of directions and chose
"Balanced", picked mainly because it feels clean. It replaces the spruce and marigold
look from D21; the interaction details from D21 stay (press feedback, menus that grow
from their trigger, press-and-hold to archive, undo toasts, no animation on keyboard
actions, the clip-path fill line).

- A felt-green rail and top bar (#1f5b3f), a plain white page, and Figtree for all text,
  with tabular figures. Geist Mono stays for account numbers only.
- Green is the action color (buttons, focus, selection, progress fills). Pale yellow marks
  focus and the active item on the green rail, where green would disappear.
- Four soft pastels (pink, yellow, green, blue) are reserved for buckets in Phase 4, so a
  bucket is recognizable at a glance without the rest of the screen getting busy.
- Every text and control color was checked against WCAG AA in light and dark mode.
- Fonts are self-hosted at build time by Next.js, so the app makes no requests to Google
  when it runs.

## Phase 2: Ledger (2026-11-17)

### D25. Corrections: edit as a new version, or reverse

Clark chose to support both. Editing a posted entry saves a new version: the old lines
stay in `journal_lines` with `is_current = false`, each version's date and memo are kept
in `journal_entry_versions`, and the audit log stores before and after. Reversing posts
a mirror-image entry (kind `reversal`) on a date you choose, linked to the original. A
reversed entry or a reversal can't be edited, and an entry can be reversed only once.
Reconciled-entry warnings arrive with reconciliation in Phase 5.

### D26. Double entry enforced by the database, not only the app

A deferred constraint trigger checks every entry at COMMIT: at least two current lines,
debits equal credits, and only one version marked current. Other triggers make lines
append-only (no edits or deletes, except flipping `is_current` off), make version
history and entries undeletable (except when a whole book is removed), and refuse
postings to accounts with `allows_posting = false` (bucket parents). Composite foreign
keys keep every line, account and reversal inside one book. Integration tests write raw
SQL to prove these hold even if app code is bypassed.

### D27. A `ledger_lines` view for reports and hand-written SQL

One row per current line with the entry's number, date and memo, plus `net_cents`
(debit minus credit). Reports and registers read it, and it is the easiest place to
start when querying the books directly, for example:
`select account_id, sum(net_cents) from ledger_lines group by account_id;`

### D28. Opening balances are one versioned entry

Each book has at most one `opening_balance` entry, dated on the book's start date, with
the difference posted to Opening Balance Equity. You enter balances as positive,
statement-style amounts and the app turns them into debits or credits. Saving again
records a new version. Changing the start date moves the entry (as a new version) and
is refused while other entries are dated before the new date. Regular entries can't be
dated before the start date.

### D29. Accounts with history

Accounts with any journal lines (current or replaced) can't be deleted, can't change
type, and can be archived only when their balance is zero, so history stays meaningful.

### D30. Entry numbers

Entries are numbered per book (JE 1, JE 2, ...), assigned inside the posting
transaction while the book row is locked, so numbers never collide.

### D31. Bank data waits in a review queue

Every bank transaction (SimpleFIN or CSV) lands in `bank_transactions` and stays there
until you approve it. Approving posts a journal entry of kind `bank`: one line on the
bank or card account for the bank's amount, and one line per category (several for a
split, which must add up exactly). The bank's sign is kept: positive means the account
went up, which is always a debit to that account, for checking and for credit cards
alike. A posted transaction points at its entry, and the database refuses `posted`
without one.

### D32. Entries that record bank transactions stay tied to them

Editing a `bank` or `transfer` entry is allowed (to recategorize), but the lines on the
bank account must still add up to the bank's amount, so the books and the bank can't
drift apart by accident. Reversing such an entry sends its bank transactions back to For
review, which is the "undo" for an approval.

### D33. Transfers: one entry in a book, a linked pair across books

Two transactions on different accounts with equal and opposite amounts no more than four
days apart are suggested as a transfer. Closest dates pair first; on a tie a partner in
the same book wins. Within one book a match posts a single `transfer` entry between the
two accounts, dated on the day the money left. Across books (Clark's choice: "matched
pair"), each book posts its own side against an account that stands for the other book
(for example Investment in the LLC at home, Owner Contributions in the LLC). Both entries
share a `transfer_group_id`, each entry page links to the other, and reversing one says
to reverse the other too. The two counterpart accounts are remembered per pair of books.

### D34. Matching an entry that already exists

When a bank transaction's amount already appears on that account in an entry a few days
away (typed by hand, or the other side of a transfer you categorized from one account),
the review queue offers "Already recorded". Matching links the bank transaction to that
entry without posting anything new. An entry can account for one bank transaction per
account.

### D35. SimpleFIN sync

- Protocol 2.0 (`version=2`, `errlist`, `connections`), still reading the older
  `errors` and `org` fields. Bridge messages are shown on the Bank connections page.
- The Access URL is AES-256-GCM encrypted at rest. Requests send it as a Basic auth
  header, never in the URL, and error messages are scrubbed of credentials.
- A Setup Token is claimed once. A full Access URL is also accepted, which is how the
  public demo connects and how a connection moves between installs.
- Each mapped account remembers the range already fetched. A sync re-reads the last five
  days (plus back to the oldest pending charge), then fetches older history back to the
  book's start date. Windows are 45 days, because the bridge warns above that even
  though it allows 90.
- The bridge expects about 24 requests a day. Every request is logged, a sync stops at 20
  in 24 hours, and one sync makes at most 8 requests, so a long backfill continues over
  the next syncs, newest history first.
- One scheduled sync a day per connection at a chosen hour (server time zone, `TZ`) and a
  random minute, plus Sync now. A lock column keeps two syncs of one connection from
  overlapping.

### D36. Pending charges and duplicates

Dedupe is by SimpleFIN account plus transaction id first. Pending charges are stored and
shown but can't be approved. When a pending charge posts under the same id it moves to
For review with the posted amount (tips change it). When the bank stops reporting a
pending charge (dropped, or replaced by a posted one with a new id) it is marked removed.
A new posted transaction with the same amount on the same account within three days of
one already in review or posted is flagged as a possible duplicate; you choose "It's a
duplicate" (exclude) or "Keep both". Nothing is skipped silently. CSV rows are
fingerprinted (date, amount, description, and position among identical rows) so
re-importing a file skips what is already there, and rows that match a SimpleFIN
transaction are flagged the same way.

### D37. Rules suggest, they never post

Conditions: text in the payee, description or either (contains, is exactly, starts with,
or a regular expression, with obviously slow patterns refused), money in or out, an
amount range, and the bank account. Actions: category, payee name, memo, and "treat as a
transfer"; a bucket action is stored for Phase 4. Rules run top to bottom and, for each
action, the first matching rule that sets it wins. Suggestions are recomputed whenever
rules change. Approving with "Always use this category" saves a rule matching that
payee exactly.

### D38. Receipts

Photos (JPEG, PNG, HEIC, WebP, GIF) and PDFs up to 10 MB, identified by their first bytes
rather than the file name. Files live on the receipts volume under the book's id and are
served only to members of that book, inline, with `nosniff` and a sandbox policy so a
file can never run as a page. A receipt added to a bank transaction in review shows on
the journal entry it becomes. Server actions accept bodies up to 11 MB for this.

### D39. Payee on journal entries

Entries gained an optional payee (versioned like the memo) because bank data has one and
reports will group by it. The `ledger_lines` view adds `entry_payee` at the end, so
existing queries keep working.

### D40. Buckets are child accounts; the real account stops taking postings

Turning on buckets adds an Unassigned bucket, moves the account's balance into it with a
`bucket` entry, and sets the account to take no postings of its own (the database refuses
them). From then on its balance is exactly the sum of its buckets. Bank data still maps
to the real account; the bank line lands in a bucket: deposits in Unassigned unless you
pick another, withdrawals in the bucket you pick in review (rules can pre-fill it).
Reconciliation, bank balance checks and transfer or entry matching all count the real
account and its buckets together. Buckets can't be turned off in v1.

### D41. Allocation rules

Per real account, in priority order: a percentage of each deposit (rounded down to the
cent), a fixed amount from each deposit (optionally only for deposits above a minimum),
or a fixed amount each month. Deposit rules never move more than the deposit, and run in
the same database transaction as the approval that brought the deposit in, as one
`bucket` entry. Monthly rules run from a daily job on the first day they can, from what
Unassigned holds; a rule with nothing available waits, one partly filled counts as done
for the month. Moving money by hand never takes a bucket below zero.

### D42. Goals

A bucket can have a target amount and an optional date. Progress is the balance over the
target; the suggested monthly amount is what is left divided by the months remaining,
counting a partial month, rounded up so the date is met.

### D43. Reconciliation

QuickBooks style, per real account: statement date and ending balance (typed as the
statement shows it; cards as what you owe), beginning balance from the last finished
statement, check off entries until the difference is zero. Cleared items are stored per
entry and account with the amount at the time, so later edits don't rewrite history.
Only the most recent statement can be undone. Editing or reversing an entry that is in a
finished reconciliation needs a confirming tick, enforced by the server.

### D44. Loans

A loan records the liability account, the interest expense account, principal, annual
rate (stored in millionths, so 6.125% is exact), term, first payment date and payment
(the standard level payment unless you enter your lender's). Interest is a month of the
current balance at the rate, rounded half up to the cent; the schedule's last payment
takes whatever is left. In review, choosing the loan account for a payment splits it into
principal and interest from what the books say is owed, editable before approval. Tests
check the math against an independent decimal calculation.

### D45. Balance updates for manual accounts

For cash, a car's value, or a loan no bank reports: "Record a new balance" posts the
difference on that date against an account you choose. It is an ordinary entry, so it
can be edited or reversed like any other.

### D46. Budgets

One amount per income or expense account per month, typed on the accounts that take
postings; parents show the sum of their children so nothing counts twice. Copy last month
replaces the month with the previous month's amounts.

### D47. Reports

Every report reads the current ledger (`ledger_lines`) and shows amounts in each
account's natural direction. The Balance Sheet closes income and expense into Retained
earnings (before the calendar year) and Net income (this year), so it always balances;
tests check that, and that Profit and Loss net income equals the change in equity. Any
account line links to its register for the same dates. CSV exports use plain numbers
with two decimals, and text cells that start like a formula are prefixed with an
apostrophe so spreadsheets don't run them.

### D48. Charts

Hand-written SVG instead of a chart library, to keep the bundle and the look under our
control. Categorical colors come in a fixed order (never cycled), validated for
color-vision deficiency and contrast against both page surfaces; past five categories the
rest fold into Other. Every chart has a legend, a hover and keyboard readout, and a table
view with the same numbers, because three light-mode colors sit under 3:1 contrast.

### D49. Installable app (PWA)

A web app manifest, icons, and a service worker that only provides an offline notice: it
never caches pages or data, so nothing financial is left on a device. Browsers require
HTTPS for the service worker (localhost excepted). Behind Caddy that works with either
certificate approach: a public DNS-challenge certificate works on every device as is; an
internal CA works once its root certificate is installed and trusted on each phone.
Without HTTPS the app still works in the browser, just without install.

### D50. Demo book

"Try a demo book" (Books page) and `npm run seed:demo` build the same "Demo Household":
three months of bank activity imported through the real CSV path and approved through the
real review code (rules, transfers, loan splits, bucket allocations), budgets, and the
last ten days left in For review. It exercises the same invariants as real data, and a
test checks them.

### D51. Continuous integration

GitHub Actions runs lint, types, formatting, and Vitest against a Postgres service on
every push and pull request, then the Docker-based Playwright suite. A second workflow
builds multi-architecture images (amd64 and arm64) and publishes them to the GitHub
Container Registry on pushes to main and version tags. `BUCKETBOOK_IMAGE` in `.env` lets
an install use a published image instead of building.

### D52. One bank account, one account in the books, made on the spot

Each SimpleFIN account still feeds exactly one account in the books (so data can't come
in twice), but the mapping picker now offers "New bank account", "New credit card", "New
investment account" and "New loan", named after the bank's account ("Costco Anywhere
Visa Card by Citi (8837)"), with a first guess from the name and balance. Accounts that
already take a feed are shown as connected and can't be picked again. This is how a
household with several cards, or several savings accounts at one bank, sets up.

### D53. Investment accounts track value, not trades

An Investment detail type (asset). A SimpleFIN account mapped to one is value only: its
buys, sells and dividends are never imported or reviewed; each sync brings the account to
the balance the bank reports with a `valuation` entry. The first value is offset to
Opening Balance Equity (it is where the account started); later changes go to a system
equity account, Unrealized Gains and Losses, created the first time it is needed. Net
worth and the Balance Sheet follow the account, while Profit and Loss, budgets and
spending reports are untouched. Accounts without a feed use Record a new balance, which
defaults to the same equity account.

### D54. Books start without money accounts; you name the accounts you connect

New books (household and small business) no longer come with Checking, Savings or Credit
Card placeholders; the household chart keeps Cash on Hand, which no bank reports. You add
money accounts in the chart of accounts, or while connecting a bank account: choose "New
account", pick the type (Checking, Savings, Credit card, Investment, Loan, Cash, Other
asset) and name it (it starts as the bank's name). It is created at the top level; to
group related accounts (several Marcus savings accounts under "Marcus"), use "Sub-account
of" in the chart of accounts, which keeps the bank connection. The old
"Bank" detail type split into Checking and Savings; existing accounts were converted, with
names containing "sav" becoming Savings.

### D55. Rules from the review queue

Like QuickBooks' "Create rule" on a bank transaction, each transaction's details offer
"Create a rule from this". It opens the same rule editor as the Rules page, prefilled:
payee or description contains the bank text with store numbers, dates and long
reference digits removed, the direction, the bank account, and the category, bucket and
payee chosen on that row. Saving re-applies rules to the queue. The quick "Always use
this category" tick remains for the common case.

### D56. Bank history starts the day you connect

Pulling history back to the book's start date fought with opening balances, which people
enter as the balance on the day they set an account up. Each feed now has an import start
(`import_from`), set to the day it is mapped (and to the upgrade day for feeds connected
before this change); syncs never bring in anything earlier, and never before the book's
start date. The opening balance is the account's balance on that day. For older history,
import a CSV, which is explicit and fingerprinted against duplicates. This supersedes the
backfill part of D35.

### D57. Guided bank setup, opening balances from the bank, fixed start dates

Connecting SimpleFIN opens a guide that takes each bank account in turn: a new account
(type and name), an existing one, or skip; "Decide later" leaves it for another time. Every
connection, guided or not, sets that account's opening balance to the bank's balance at
that moment, merged into the book's single opening balance entry, because history is
only imported from the day of connection (D56). Investment accounts are left to their
value updates. A book's start date is fixed when the book is created (it defaults to that
day): opening balances and import dates hang off it, and moving it would quietly change
what they mean. The connect form shows SimpleFIN's terms and a no-warranty notice, and
the server requires the agreement box.

### D58. Deleting a book

Archiving stays the everyday way to put a book away. Deleting is permanent, so it needs
both: the book must already be archived, and the owner types its name and holds the
button. The ledger guards (D26) still refuse to delete posted lines,
versions, or entries; the delete runs in one transaction that first names the book in a
transaction-local setting (`bucketbook.deleting_book`), and the guards allow deletes only
for rows of that book. Naming another book, or deleting without the setting, is refused as
before. Bank feeds mapped to the book are unmapped (and their import window cleared)
rather than removed, so the SimpleFIN link survives. Receipt files are removed after the
rows. One audit row records the deletion with the book's name. The new book form drops its
start date field: a book starts the day it is created (D57).
