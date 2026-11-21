# Changelog

All notable changes to this project are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.2] - 2026-11-21

### Added

- **Nightly database backups.** A new `backup` service in `docker-compose.yml` saves the
  database every night at 02:00 as `backups/bucketbook-YYYY-MM-DD.sql.gz` and keeps the
  newest 14. Set `BACKUP_TIME` and `BACKUP_KEEP_DAYS` in `.env`. Each file is written
  under a temporary name, checked, and only then renamed, so a backup tool never copies
  half a file. A run missed while the machine was off happens when it comes back.
- `/api/health` shows the last backup's status (`ok`, `failed`, `stale` or `none`),
  time and file. Back up any time with `docker compose exec backup bucketbook-backup now`.
- **Restore with one command:** `docker compose run --rm backup restore
backups/<file>`. It loads the backup into a new database and swaps it in only once
  it loaded completely, after saving the database it replaces.
- `scripts/move-data.sh` moves the data of an install from 1.0.1 or earlier out of Docker volumes into the
  folder, checking the copy, and never removes the old volumes unless you say so.

### Changed

- **Everything Bucketbook keeps is now in its folder:** the database in
  `data/postgres`, receipts in `data/receipts`, and the nightly copies in `backups/`.
  Backing up the `bucketbook` folder (with Backrest, restic, Borg or anything else) now
  backs up Bucketbook. Before, the data was in Docker volumes that folder backups miss.
- The installer makes those folders. The containers set the owners they need on first
  start, so no `chmod` or `chown` is needed. Receipts keep the folder's group, so you
  can read them without `sudo`.
- The app image includes the Postgres 18 client tools, and the container starts as root
  only to set up the receipts folder before running the app as its own user.

### Upgrading from 1.0.1 or earlier

The new `docker-compose.yml` needs the data moved first, and stops with a message
until it is. In your `bucketbook` folder, run once:

```bash
curl -fsSL https://raw.githubusercontent.com/cbik6/bucketbook/main/scripts/move-data.sh | sh
```

It backs up, updates `docker-compose.yml` and the images, copies and checks the data,
and starts Bucketbook on the new folders. See
[Upgrading from 1.0.1 or earlier](docs/backup-restore.md#upgrading-from-101-or-earlier).

## [1.0.1] - 2026-11-21

### Changed

- Bucketbook uses port 9951 everywhere: inside its container, on your machine for new
  installs, and for the dev server. Port 3000 clashed with too many other apps. Existing
  installs keep the port on the machine set in their `.env`.
- The installer checks the port before it writes anything. If 9951 is already in use it
  picks the next free port and says which; a port chosen with `BUCKETBOOK_PORT` that is
  in use stops the install with a clear message instead of a Docker error.

### Fixed

- Installs work again after a change merged following 1.0.0 pointed `docker-compose.yml`
  at port 9951 inside the container while the published app still listened on 3000.

### Upgrading from 1.0.0

Download the new `docker-compose.yml` into your `bucketbook` folder before pulling, since
the app's port inside its container changed:

```bash
curl -fsSLO https://raw.githubusercontent.com/cbik6/bucketbook/main/docker-compose.yml
docker compose pull
docker compose up -d
```

## [1.0.0] - 2026-11-20

The first public release: everything in the first-version plan, plus what daily use asked
for along the way.

### Added

- **For review, like a bank feed.** A card for each bank account shows how many
  transactions wait, the bank's balance and the balance in Bucketbook. The table has
  Spent and Received columns, a search box, and an Add or Match button on each row; add
  several at once with Add N. Details offer Categorize, Find match, Record as transfer,
  Split, receipts, Create a rule, Exclude and Undo.
- **Category guesses from your history.** Where no rule applies, review guesses the
  category and payee from the same store or similar words, marks it "From your history"
  and says why. The learning runs on your own server.
- **One searchable account list** everywhere an account is chosen, with suggestions and
  matches first and sub-accounts indented under their parents.
- **Parent accounts as headings only**, a setting on the chart of accounts.
- **Bank connections per book**, with a guided setup for each new bank account, opening
  balances taken from the bank, investment accounts that follow their value, and a fix
  for accounts the bank reports backwards. Transactions start the day an account is
  connected.
- **Import from CSV files and PDF statements**, read on your server, with a duplicate
  check and a check that the rows add up from the beginning to the ending balance.
- **Rules**, including one filled in from any transaction in review.
- **Buckets**: split a savings or checking account into goals, with an Unassigned bucket,
  goals with a suggested monthly amount, moving money, and allocation rules.
- **Reconciliation** against statements, with history, reports and undo.
- **Loans** with an amortization schedule; payments split into principal and interest.
- "Record a new balance" for accounts no bank reports, such as cash or a car's value.
- **Monthly budgets** with copy last month.
- **Reports**: Profit and Loss, Balance Sheet, Budget vs. Actuals, Bucket summary,
  Spending trends and Net worth, with drill-down and CSV export.
- **People**: invite others with a one-time link and give them an Owner, Editor or Viewer
  role in each book.
- Delete an archived book for good.
- Install on a phone's home screen; light and dark mode.
- "Try a demo book" and `npm run seed:demo`.
- A one-line installer, and multi-architecture images on the GitHub Container Registry.
- Security headers on every page.

## [0.3.0] - 2026-11-18

Phase 3: Bank data.

### Added

- Bank connections page: connect SimpleFIN with a Setup Token (or the demo bank), choose
  which book and account each bank account feeds, sync daily at a chosen hour or with
  Sync now, and compare each bank balance with the books.
- SimpleFIN sync that backfills from each book's start date in small windows within the
  bridge's daily request limit, dedupes by transaction id, holds pending charges until
  they clear, and flags likely duplicates for you to confirm.
- For review queue: approve with a category, split one transaction across accounts,
  match transfers between your accounts (including between books, posting a linked
  entry in each), match transactions to entries you already typed, exclude, and approve
  many at once. Keyboard: J and K to move, A to approve, X to select, E to exclude.
- Rules that suggest a category, payee and memo from the payee or description, amount,
  direction and account, in priority order, plus "Always use this category" while
  approving.
- CSV import with a column mapping saved per account, a preview, and duplicate checks.
- Receipts (photos and PDFs) on bank transactions and journal entries.
- Payee on journal entries.

### Changed

- Bank and transfer entries can be edited only in ways that keep the bank account's
  amount; reversing one sends its bank transactions back to review.

## [0.2.0] - 2026-11-17

Phase 2: Ledger.

### Added

- Manual journal entries with a multi-line entry screen: live debit and credit totals,
  automatic balancing amount on the next line, Enter to add a line, Ctrl+Enter to post,
  and a stacked layout on phones.
- Editing a posted entry saves a new version; every version stays viewable in the
  entry's history. Reversing posts a mirror-image entry on a date you choose.
- Opening balances screen that builds one entry offset to Opening Balance Equity.
- Account registers with a running balance, date ranges, and an option to include
  sub-accounts.
- General ledger by account with beginning balances, date range presets and custom
  ranges.
- Activity log showing every change to a book in plain language.
- Balances on the chart of accounts, with sub-accounts rolled into their parents.
- Changing a book's start date from Book settings.
- Database-level double entry: unbalanced entries and in-place edits of posted lines are
  refused by Postgres itself.
- `ledger_lines` view for querying the current ledger with SQL.

### Changed

- Clicking an account name now opens its register; the pencil button opens the editor.
- Accounts with transactions can no longer be deleted or change type, and need a zero
  balance before archiving.
- New "Balanced" look: felt-green navigation, a white page, Figtree type, green actions, and
  pastel colors reserved for buckets. Light and dark modes were rechecked for contrast.

## [0.1.0] - 2026-11-17

Phase 1: Foundation.

### Added

- Docker Compose install with two services (app and Postgres) and named volumes for the
  database and receipts. Health checks on both.
- Configuration through environment variables, validated at startup with clear error
  messages, and documented in `.env.example`.
- Database schema with readable table names and the first SQL migration. Migrations run
  automatically on every start.
- `/api/health` endpoint reporting database, migration and job queue status.
- Email and password sign-in. Sign-up closes once the owner account exists.
- First-run setup wizard: create the owner login, create the first book from a template,
  and skip the bank connection for now.
- Books: create, rename, archive and restore, plus a book switcher.
- Chart of accounts with Asset, Liability, Equity, Income and Expense types, detail types,
  optional account numbers, and unlimited nesting. Create, edit, archive, restore, and
  delete unused accounts.
- Starting charts of accounts: Household, Small Business (numbered), and Blank. Every book
  gets Opening Balance Equity and Retained Earnings as protected system accounts.
- Audit log of every change, written in the same transaction as the change.
- Encryption helper for stored bank credentials (used from Phase 3).
- Background job queue (pg-boss) running inside the app container, ready for bank sync.
- Light and dark themes that follow the system, with a manual toggle.
- Keyboard shortcuts on the chart of accounts: N for a new account, Escape to close the
  panel.
- Vitest unit and integration tests, and a Playwright test of the first-run flow.
