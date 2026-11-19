# Changelog

All notable changes to this project are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.12.0] - 2026-11-19

### Changed

- A cleaner sidebar. The everyday pages sit at the top without a heading (For review,
  Chart of accounts, Buckets, Budget, Reports), then Bookkeeping (Journal entries,
  General ledger, Reconcile, Activity). Setup (Bank connections, Rules, Loans, Opening
  balances, Book settings) folds away: it opens by itself on one of its pages and
  remembers whether you left it open.
- Your name at the foot of the sidebar is now one button. Its menu holds the theme,
  People (for admins) and Sign out.

## [1.11.2] - 2026-11-19

### Fixed

- PDF import read every Apple Card purchase as money coming in: a "Payments" heading
  carried over into the transactions below it. A "Transactions" heading now resets it.
- PDF import reads balances printed as "Previous Total Balance" and "Total Balance", and
  a statement period like "Oct 1 to Oct 31, 2026" with one year, and leaves a cash back
  rate such as "2%" out of the description.
- In For review, a split transaction keeps the category list: choose any category to
  back out of the split (choosing split again brings your lines back). "Don't split" is
  now "Undo split", and a stale error clears when you change the category.

## [1.11.1] - 2026-11-19

### Changed

- Transactions from the bank no longer show journal entry numbers. The Posted tab links
  to them with **View**; registers, the general ledger and reconcile call them
  Transaction, Transfer, Bucket move or Value update; opening one shows who it was with as
  its title; and Activity says "Posted a bank transaction". Entries you write yourself
  keep their JE numbers.

## [1.11.0] - 2026-11-19

### Added

- Import checks the rows against the statement. Enter the beginning and ending balances
  (a PDF statement fills them in when it prints them) and Import shows whether the ticked
  rows add up from one to the other. For a card or loan the balances are what is owed.
  When they don't match it says by how much, points out a row that would match if it went
  the other way (or all of them), and fixes it in one click. Sending rows that don't add
  up needs a tick to confirm.
- Each row in a PDF preview has its own button to flip its sign.

## [1.10.0] - 2026-11-19

### Added

- Import transactions from a PDF bank or credit card statement. Choose **Import** on the
  For review page, then **PDF statement**. The PDF is read on your own server and never
  stored or sent anywhere. The preview shows every transaction found, marks any whose
  direction it couldn't tell, and lets you leave rows out or flip money in and out.

### Changed

- **Import CSV** is now **Import**, with CSV file and PDF statement side by side.
- A CSV and a PDF covering the same days flag each other's rows as possible duplicates.

## [1.9.3] - 2026-11-19

### Changed

- In For review, choosing an account in the Account list shows its transactions right
  away. The Show button is gone.

## [1.9.2] - 2026-11-19

### Changed

- In For review, every Approve button looks the same. The first row's is no longer filled
  in green.

## [1.9.1] - 2026-11-19

### Fixed

- Buttons ease into their press instead of jumping.
- Keyboard focus outlines follow each control's shape, and fields show one focus ring
  instead of two.
- In For review, approving a second transaction while the first is still saving no longer
  moves "Saving" to the new row or turns the first row's button back on early.
- Pages show a placeholder while they load instead of a blank screen, and the phone
  header no longer makes the page jump once it loads.
- The reconcile Difference figure keeps its digits steady as it changes.

### Changed

- The bank setup guide fades in and out, and the account editor's backdrop fades in with
  its sheet on phones.
- Buttons keep their width while they show "Saving" and similar labels.
- Small controls on phones (menu links, sign out, theme, remove receipt) have taller
  touch areas.
- Icon buttons share one look with a press state, table rows share one hover color, and
  the setup guide's choices show a hover cue.

## [1.9.0] - 2026-11-18

### Changed

- Bank connections belong to a book. Each book has its own **Bank connections** page in
  its menu, and its bank accounts feed only that book, so two books can connect the same
  bank and keep separate transactions. Owners of the book connect, disconnect and set the
  sync time; editors set up accounts and sync. Admins no longer manage bank connections.
- Existing connections move into the book their accounts feed. A connection whose
  accounts fed several books is split into one per book.
- Deleting a book removes its bank connections.

## [1.8.0] - 2026-11-18

### Added

- People: the admin invites others with a one-time link (valid 7 days) and gives them an
  Owner, Editor or Viewer role in each book. Admins can change access, make someone an
  admin, withdraw invitations, and remove people.

### Changed

- The person who set up the install is its admin. Bank connections are managed by admins
  and shared across the install. Sign-up without an invitation stays closed.

## [1.7.0] - 2026-11-18

### Added

- Accounts the bank reports backwards: when a savings or checking account comes in with a
  negative balance, the setup guide offers "This is money in the account, not money
  owed". Bucketbook then flips that account's balance and transactions on every sync.

## [1.6.1] - 2026-11-18

### Changed

- Clearer choices in the bank setup guide: "Create a new account for it" (the usual
  choice), "Link it to an account already in Bucketbook", or "Skip it", each with a short
  hint.

### Fixed

- Linking a card or loan to an existing asset account no longer shows its opening balance
  as owed.

## [1.6.0] - 2026-11-18

### Added

- Delete an archived book for good from its Book settings (owners only). You type the
  book's name and hold the button; its bank accounts stay connected and wait to be set
  up again.

### Changed

- The new book form no longer asks for a start date: a book starts the day it is created.

## [1.5.0] - 2026-11-18

### Added

- Guided setup for bank accounts: a pop-up walks through each account not yet set up,
  one at a time (new or existing account, type and name, or skip), and opens on its own
  right after connecting SimpleFIN.
- Opening balances come from the bank automatically: connecting an account uses the
  bank's balance that day as its opening balance (investments take their value from
  each sync instead).
- A notice before connecting SimpleFIN: its Terms of Use and Privacy Policy apply, and
  Bucketbook comes with no warranty or liability. A tick box confirms it.

### Changed

- A book's start date can no longer be changed after the book is created.

## [1.4.1] - 2026-11-18

### Changed

- A new book's start date defaults to the day you create it (it was January 1).

## [1.4.0] - 2026-11-18

### Changed

- Connected bank accounts bring in transactions from the day they are connected, not
  from the book's start date, so they don't duplicate opening balances. Accounts already
  connected start from the day of this update. The Bank connections page shows each
  account's start day.
- Journal entries lists the entries you write yourself (and opening balances). Entries
  made from bank transactions, transfers, bucket moves and investment values are in the
  registers, the general ledger and For review's Posted tab; "Show all entries" lists
  everything.

## [1.3.0] - 2026-11-18

### Added

- "Create a rule from this" on any transaction in For review: the rule editor opens filled
  in from the transaction (text to look for without store numbers, money in or out, the
  account, the chosen category, bucket and payee), ready to adjust and save.

## [1.2.1] - 2026-11-18

### Changed

- New accounts made while connecting a bank account are created at the top level; the
  "Inside" choice is gone. Group accounts with "Sub-account of" in the chart of accounts.

## [1.2.0] - 2026-11-18

### Changed

- Connecting a bank account now offers "New account": pick the type, type the name, and
  optionally put it inside an existing account or a new group (for example "Marcus"), so
  several savings accounts at one bank stay together.
- New books start without Checking, Savings or Credit Card placeholders (household keeps
  Cash on Hand). Add the accounts you have, by hand or while connecting a bank.
- The "Bank" detail type is now Checking and Savings; existing accounts were converted.

## [1.1.0] - 2026-11-18

### Added

- Investment accounts for net worth: map a brokerage or retirement account from
  SimpleFIN and the books follow its value each sync (trades aren't imported), with
  changes kept in Unrealized Gains and Losses so income and spending reports are
  untouched.
- Create the right account while mapping a bank account: new bank account, credit card,
  investment account or loan, named after the bank's account. Accounts already connected
  to another bank account are marked and can't be picked twice.

### Changed

- A clearer message when two bank accounts point at the same account in the books.

## [1.0.0] - 2026-11-18

Phases 4 to 7: buckets, reconciliation and loans, budgets and reports, and polish. The
first complete version.

### Added

- Buckets: turn them on for a savings or checking account, with an Unassigned bucket,
  goals with a suggested monthly amount, moving money between buckets, and allocation
  rules (a percentage or amount of each deposit, or an amount each month).
- Bucket picker in For review, and a bucket action for rules.
- Reconciliation against statements, with history, reports, undo for the latest one, and
  a confirmation before changing a reconciled entry.
- Loans with an amortization schedule; payments approved in review split into principal
  and interest automatically.
- "Record a new balance" for accounts no bank reports, such as cash or a car's value.
- Monthly budgets with copy last month.
- Reports: Profit and Loss (with monthly columns), Balance Sheet, Budget vs. Actuals,
  Bucket summary, Spending trends and Net worth charts, all with drill-down to registers
  and CSV export.
- Install on a phone's home screen (web app manifest, icons, offline notice).
- "Try a demo book" and `npm run seed:demo`.
- GitHub Actions: tests on every push, multi-architecture images published to the GitHub
  Container Registry. `BUCKETBOOK_IMAGE` lets an install use a published image.
- Security headers on every page.

### Changed

- The side menu scrolls when it is taller than the screen.

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
