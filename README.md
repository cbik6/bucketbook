# Bucketbook

Double-entry books for households and small businesses, with savings "buckets" inside
your real bank accounts, running on your own server.

> **Status: version 1.0.** Everything in the first-version plan is built: books and a
> chart of accounts, journal entries, bank data through SimpleFIN and CSV with a review
> queue and rules, buckets with goals, reconciliation, loans, budgets and reports. It
> has been tested heavily but not yet with years of real money; keep your old tool
> running alongside it for a while.

"Bucketbook" is a working name.

## What it is

- **Real double-entry accounting.** Every transaction balances (the database itself
  refuses one that doesn't), posted entries are never edited in place, and every change
  is in an audit log.
- **Bank data you approve.** Transactions arrive through
  [SimpleFIN](https://www.simplefin.org/), CSV files or PDF statements and wait in
  **For review**. Rules and payees
  suggest categories, transfers between your accounts (and between books) are matched,
  splits and receipts are a click away, and nothing reaches the books until you approve
  it.
- **Buckets.** Split one savings account into goals (Emergency, Car, Vacation) the way
  some online banks do. Deposits land in Unassigned, allocation rules move money into
  buckets, and the bank account always equals the sum of its buckets.
- **The rest of the bookkeeping.** Reconcile against statements, track loans with an
  amortization schedule (payments split into principal and interest for you), budget by
  month, and read Profit and Loss, Balance Sheet, Budget vs. Actuals, bucket, spending
  and net worth reports, all with drill-down and CSV export.
- **Multiple books, multiple people.** Keep your household and each business separate,
  and invite others with an Owner, Editor or Viewer role in each book.
- **Your data, your server.** Plain Postgres with readable table names, installable on
  your phone's home screen, light and dark mode.

![The review queue: bank transactions with suggested categories, waiting for approval](docs/screenshots/review-queue.png)

| Buckets with goals                                                             | Spending trends                                                                     |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| ![Savings split into buckets with goal progress](docs/screenshots/buckets.png) | ![Monthly spending by category with a hover readout](docs/screenshots/spending.png) |

The screenshots show the built-in demo book; all names in it are made up.

Want to look around first? After setup, press **Try a demo book** on the Books page for
a household with three months of activity, buckets, a car loan and a budget.

## Install with Docker

You need a computer that stays on (a home server, a NAS, a mini PC or a cloud server)
with [Docker](https://docs.docker.com/get-docker/) and Docker Compose v2. Docker Desktop
on Windows or macOS works too.

### The quick way

Run this in a terminal (on Windows, a WSL terminal):

```bash
curl -fsSL https://raw.githubusercontent.com/cbik6/bucketbook/main/install.sh | sh
```

It makes a `bucketbook` folder where you run it, puts `docker-compose.yml` and a `.env`
settings file with fresh secrets in it, and starts the app, its database and a nightly
backup. In Docker (and Docker Desktop) they appear together as one group called
**bucketbook**. Everything Bucketbook keeps stays in that folder:

```
bucketbook/
  docker-compose.yml
  .env              your settings and secrets: keep a copy somewhere safe
  .env.example      every setting explained
  data/             the database and uploaded receipts
  backups/          a copy of the database, made every night
```

When it finishes it prints the address to open, for example `http://192.168.1.20:9951`.
It uses port 9951, or the next free port if something else already has 9951. The setup
wizard there creates your login and your first book. The bank connection step
can be skipped for now.

To pick the folder, port or address, set them in front of `sh`:

```bash
curl -fsSL https://raw.githubusercontent.com/cbik6/bucketbook/main/install.sh | BUCKETBOOK_PORT=8080 BUCKETBOOK_URL=https://books.example.com sh
```

You can read [the installer](install.sh) before running it; it's short.

### By hand

1. Make a folder called `bucketbook`, download the two files into it, and make the
   folders for the data and backups:

   ```bash
   mkdir bucketbook && cd bucketbook
   curl -fsSLO https://raw.githubusercontent.com/cbik6/bucketbook/main/docker-compose.yml
   curl -fsSL https://raw.githubusercontent.com/cbik6/bucketbook/main/.env.example -o .env
   mkdir -p data/postgres data/receipts backups
   ```

2. Fill in the required values in `.env`:

   | Setting              | What to put there                                                                                             |
   | -------------------- | ------------------------------------------------------------------------------------------------------------- |
   | `APP_URL`            | The address you'll type in the browser, for example `http://192.168.1.20:9951` or `https://books.example.com` |
   | `BETTER_AUTH_SECRET` | Output of `openssl rand -base64 32`                                                                           |
   | `APP_ENCRYPTION_KEY` | Output of `openssl rand -base64 32` (a different value)                                                       |
   | `POSTGRES_PASSWORD`  | Output of `openssl rand -hex 24`                                                                              |

3. Download the images and start it (pulling first makes sure an older copy already on
   this machine isn't used):

   ```bash
   docker compose pull
   docker compose up -d
   ```

   Database migrations run automatically every time the app starts.

   If port 9951 is already in use on your machine, set `APP_PORT` to a free one (say
   `9952`) and use the same port in `APP_URL`.

4. Open `APP_URL` in your browser.

Check that it's healthy (use your port if it isn't 9951):

```bash
curl http://localhost:9951/api/health
```

### Changing the port later

Change `APP_PORT` in `.env`, and the port in `APP_URL` to match, then run
`docker compose up -d` in the `bucketbook` folder.

### Updating without losing data

Updating never touches your books. The new version starts on the same database and
makes any changes it needs to it by itself. To keep it that way:

- **Run every command in your Bucketbook folder**, the one with `docker-compose.yml` and
  `.env`. Not sure where it is? `docker compose ls` lists it under CONFIG FILES.
- **Keep that folder and its `.env`.** Don't delete it, or install again somewhere else,
  to get the new version: a new install starts empty. (Running the installer again in
  the same place is safe; it just prints the update commands.)
- **Don't add `-v` to `docker compose down`**, and don't run `docker volume prune` or
  `docker system prune --volumes`. On 1.0.1 or earlier those delete your data.

**Which version do you have?** Look for a `DATA_DIR=` line in `.env`. If it's there,
you're on 1.0.2 or later. If not, you're on 1.0.1 or earlier. (Or run
`curl http://localhost:9951/api/health` and look at `version`.)

**From 1.0.2 or later**, back up, then get the new `docker-compose.yml` and image:

```bash
docker compose exec backup bucketbook-backup now
curl -fsSLO https://raw.githubusercontent.com/cbik6/bucketbook/main/docker-compose.yml
docker compose pull
docker compose up -d
```

**From 1.0.1 or earlier**, run this once instead. Those versions kept your data in
Docker volumes outside the folder; this moves it into the folder and updates
Bucketbook in the same step:

```bash
curl -fsSL https://raw.githubusercontent.com/cbik6/bucketbook/main/scripts/move-data.sh | sh
```

It saves a backup first, copies and checks your data, and only then starts the new
version. Your old volumes stay until you choose to remove them. Details are in
[Upgrading from 1.0.1 or earlier](docs/backup-restore.md#upgrading-from-101-or-earlier).

If you already downloaded the new `docker-compose.yml` and Docker said **"DATA_DIR is
missing from .env"**, nothing was lost: it refuses to start rather than start empty.
Run the command above.

**Afterwards**, open Bucketbook and check your books look right. If anything is wrong,
the copies in `backups/` can be restored (see [Backups](#backups)).

The image `ghcr.io/cbik6/bucketbook:1` follows every 1.x release. To stay on one
release, set `BUCKETBOOK_IMAGE=ghcr.io/cbik6/bucketbook:1.0.2` in `.env`.

### Building from source

To run your own changes, clone the repository, create `.env` as above, and add this line
to it:

```
COMPOSE_FILE=docker-compose.yml:docker-compose.build.yml
```

Then `docker compose up -d --build` builds the image from the source folder (it takes a
few minutes). Update with `git pull` and the same command.

### Behind a reverse proxy (Caddy)

No special configuration is needed. Set `APP_URL` to the public address and point the
proxy at the app's port, for example in a Caddyfile:

```
books.example.com {
    reverse_proxy 127.0.0.1:9951
}
```

If you also open the app by another address (such as its LAN IP), add that address to
`TRUSTED_ORIGINS` in `.env`.

### Installing on your phone

Bucketbook can be added to a phone's home screen and opens like an app (Safari: Share,
then Add to Home Screen). Browsers only allow this over HTTPS, so serve it through your
proxy with a certificate the phone trusts:

- A public certificate from Caddy's DNS challenge works on every device with no extra
  steps, even when the name only resolves on your home network.
- Caddy's internal CA (`tls internal`) works once you install and trust Caddy's root
  certificate on each phone (on iPhone: install the profile, then turn on full trust in
  Settings, General, About, Certificate Trust Settings).

Over plain HTTP everything works in the browser; only the home screen install is off.

## Connecting your banks

Bucketbook reads bank transactions through [SimpleFIN Bridge](https://beta-bridge.simplefin.org/),
a small paid service that connects to most US banks and credit cards.

1. In SimpleFIN Bridge, connect your banks and create a Setup Token.
2. In Bucketbook, open the book and choose **Bank connections** in its menu (under
   Setup), paste the token, and press Connect. The token works once; Bucketbook trades it for an access key and
   stores that encrypted with `APP_ENCRYPTION_KEY`.
3. A guide opens and walks through each bank account: make a new account for it (pick the
   type and name), connect it to one you already have, or skip it. Its opening balance is
   the bank's balance that day.
4. Press **Sync now**. Each account brings in transactions from the day you connected it,
   never earlier. After that it syncs on the schedule in **Book settings**:
   once a day by default, or up to every 4 hours, starting at the hour you pick (in the
   server's `TZ`), or only when you press Sync now.

**Older history** comes from statements: upload CSV or PDF statements from any date
under Import, or type entries for any date. Bucketbook keeps each account's opening
balance true for its date: it lowers or raises the opening amount by what the older
transactions add up to, so a connected account still shows exactly the bank's balance.
The Opening balances screen sets that balance and date for accounts you track by hand.

New transactions wait in **For review** in each book, laid out like a bank feed: a card
for each bank account (the bank's balance next to the balance in your books), then a
table with Spent and Received columns and a search box. **Add** each with a category (or
split it), **Match** transfers between your accounts and entries you already wrote, or
exclude it. Rules fill in the category for you (the wand button beside **Add**, or **R**,
makes one from a transaction), and nothing posts until you add it. Click a transaction's name (or
press **P**) to give it a clean payee name ("Taco Bell" for "TACO BELL 729852 22 WEST MAIN
ST") and the next one
from that store comes in under that name, with the payee's usual category. **Setup >
Payees** lists them to rename, merge or archive, and **Reports > Spending by payee**
totals them. On
the Posted tab, **Undo** sends a transaction back to review.

Where no rule applies, Bucketbook guesses from what you've already added: the same store
going to the same place, or similar words in the description. A guess is marked **From
your history**, and its details say what it was based on. The learning is plain counting
on your own server; no transaction leaves it. The category list is searchable: type part
of a name, and suggestions, matches and the groups that fit (spending first for money
out, income first for money in) come first. The same list is used everywhere you choose
an account.

To try it without a bank, press **Use the demo bank** on the Bank connections page; it
connects SimpleFIN's public demo account.

Bank connections belong to a book, and their accounts feed only that book. To bring the
same bank into a second book (say a household and a business that share a card), make
another Setup Token in SimpleFIN Bridge and connect it from the second book. Each book
then keeps its own copy of the transactions and reviews them on its own. Owners of a book
connect and disconnect its banks; editors set up its accounts and sync.

Each bank account feeds its own account in the books. New books start without any bank
or card accounts: when you map a bank account, choose **New account**, pick its type
(Checking, Savings, Credit card, Investment, Loan, Cash) and name it. To group several
accounts (for example savings accounts under "Marcus"), add the group in the chart of
accounts and set "Sub-account of" on each. To keep such group accounts as headings only,
set **Parent accounts** to **Headings only** at the top of the chart of accounts: they
can't be picked any more, so every transaction lands on a sub-account. Entries that
already use a parent stay as they are.

**Investment accounts** (brokerage, IRA, 401k) are for net worth: map them as a new
investment account and each sync brings the books to the value the bank reports. Trades
aren't imported, and the changes in value stay out of income and spending.

Credit cards work like any other account: purchases are categorized in review, and the
payment from checking is matched with the card's side as a transfer. Bank, cash, card and
loan accounts can be reconciled against statements from **Reconcile**.

## Buckets, loans and budgets

- **Buckets:** on the Buckets page, turn on buckets for a savings or checking account.
  Its balance moves into Unassigned; add buckets with optional goals, and allocation
  rules (a percentage or amount of each deposit, or an amount each month). In review,
  pick which bucket a withdrawal comes out of; rules can pick it for you.
- **Loans:** on the Loans page, enter the terms from your loan papers. When you approve a
  payment in review with the loan account as its category, it is split into principal
  and interest automatically.
- **Accounts no bank reports** (cash, a car's value): open the account and use **Record
  a new balance**.
- **Budget:** a monthly amount per income and expense account, with Copy last month.
  Compare in Reports.

For banks SimpleFIN can't reach, use **Import** on the For review page:

- **CSV file:** export one from the bank and match its columns once; the mapping is
  remembered per account.
- **PDF statement:** choose the account, then the statement. Bucketbook reads it on your
  server (it is never stored or sent anywhere), shows every transaction it found, and
  lets you leave rows out or flip money in and out before they go to For review. It needs
  a statement downloaded from the bank's website; a scan or photo has no text to read.

Both check the rows against the statement: enter its beginning and ending balances (a PDF
fills them in when it prints them) and Import shows whether the rows add up, and which
row is likely wrong when they don't.

## People

The person who sets up Bucketbook is its admin. Admins manage people from **People** in
the menu under their name at the bottom of the sidebar.

To add someone, open **People**, enter their name and email, pick a role for each book,
and select **Make invite link**. Send them the link: it works once and expires in 7 days.
They open it, choose a password, and land in their books. There is no email server
involved, and sign-up is closed to anyone without a link.

- **Owner:** everything an editor can do, plus connecting banks to the book and the
  book's settings (rename, archive, delete).
- **Editor:** enters and approves transactions, sets up and syncs the book's bank
  accounts, and works with rules, buckets, budgets, loans and reconciling.
- **Viewer:** sees the book and its reports, but can't change anything.

An admin can change anyone's access, make them an admin, or remove them. Every book
always keeps at least one owner, and the install always keeps at least one admin.

## Querying your books with SQL

The database uses plain, readable names. The `ledger_lines` view has one row per posted
line with its date, entry number, memo and `net_cents` (debit minus credit), so a trial
balance is one query:

```sql
select a.name, sum(l.net_cents) / 100.0 as balance
from ledger_lines l join accounts a on a.id = l.account_id
group by a.name order by a.name;
```

Open a SQL prompt with `docker compose exec postgres psql -U bucketbook`.

## Backups

**What to back up:** the whole `bucketbook` folder. Everything Bucketbook keeps is in
it, so pointing Backrest, restic, Borg or any folder backup at it covers everything:

| In the folder   | What it is                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| `.env`          | Settings and secrets. Without `APP_ENCRYPTION_KEY` you'd have to reconnect your banks after a restore |
| `backups/`      | A complete copy of the database from each of the last 14 nights                                       |
| `data/receipts` | Uploaded receipts                                                                                     |
| `data/postgres` | The database's working files (see below)                                                              |

**Nightly copies:** the `backup` service saves the database at 02:00 every night as
`backups/bucketbook-YYYY-MM-DD.sql.gz` and keeps the newest 14. Change that with
`BACKUP_TIME` and `BACKUP_KEEP_DAYS` in `.env` (the time is in your `TZ`). Each file is
written under a temporary name and only renamed once it's complete, so a backup tool
never copies half a file. Schedule your folder backup for after 02:00 to pick up the
same night's copy.

**Restore from `backups/`, not `data/postgres`.** Copying the database's working files
while it runs can catch them mid-write. The nightly file is always consistent. If your
backup tool doesn't run as root it can't read `data/postgres` anyway (it belongs to the
database's user), so exclude that folder.

**Is it working?** `curl http://localhost:9951/api/health` shows the last backup's
status and time, and `docker compose logs backup` shows each run. Back up right now
with `docker compose exec backup bucketbook-backup now`.

**Restore** a nightly file into a fresh database (your current one is saved first):

```bash
docker compose stop app
docker compose run --rm backup restore backups/bucketbook-2026-11-20.sql.gz
docker compose up -d
```

[docs/backup-restore.md](docs/backup-restore.md) has the details, moving to a new server,
and moving an older install's data out of Docker volumes.

## Development

Requirements: Node 24, npm, Docker.

```bash
npm install
npm run db:up                  # dev Postgres on 127.0.0.1:5433
cp .env.example .env.local     # then set DATABASE_URL and the secrets (see below)
npm run dev                    # http://localhost:9951
```

A working `.env.local` for development:

```
DATABASE_URL=postgres://bucketbook:bucketbook@localhost:5433/bucketbook
APP_URL=http://localhost:9951
BETTER_AUTH_SECRET=<openssl rand -base64 32>
APP_ENCRYPTION_KEY=<openssl rand -base64 32>
```

To open the dev server from another computer on your network, set `APP_URL` to
`http://<this machine's IP>:9951` and `DEV_ALLOWED_ORIGINS=<this machine's IP>`.

| Command                                                 | What it does                                                                                                      |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                                           | Dev server on port 9951, reachable on your network                                                                |
| `npm test`                                              | All Vitest tests (unit and integration)                                                                           |
| `npm run test:unit`                                     | Unit tests only, no database needed                                                                               |
| `npm run test:integration`                              | Integration tests against a throwaway `bucketbook_test` database in the dev Postgres                              |
| `npm run test:e2e`                                      | Builds the Docker image, starts a fresh install on port 3100, runs Playwright in a container, then removes it all |
| `npm run lint` / `npm run typecheck` / `npm run format` | Code checks                                                                                                       |
| `npm run db:generate`                                   | Create a new SQL migration after changing `src/server/db/schema`                                                  |
| `npm run db:migrate`                                    | Apply migrations by hand (the app also does this on start)                                                        |
| `npm run db:reset`                                      | Wipe the dev database (asks nothing, dev only)                                                                    |
| `npm run db:studio`                                     | Browse the dev database in Drizzle Studio                                                                         |
| `npm run seed:demo`                                     | Add the demo book to the first user (or `npm run seed:demo -- you@example.com`)                                   |

### Project layout

```
docker/                 the image's entrypoint and the nightly backup (backup.mjs)
drizzle/                SQL migrations (generated, committed, readable)
scripts/                migrate, e2e and backup tests, demo seed, data move for old installs
src/app/                pages and API routes (Next.js App Router)
src/components/         shared UI
src/lib/                code shared by browser and server (money, account types)
src/server/             server-only code: db schema, auth, services, jobs
install.sh              the one-line installer
tests/unit, tests/integration, e2e/
docs/                   decisions log, backup and restore
```

### Design tooling

UI work follows the Impeccable design skill and Emil Kowalski's design-engineering
skill. Product context is in `PRODUCT.md`. The skills themselves are not committed;
restore them with `npx skills experimental_install` (from `skills-lock.json`).

## Roadmap

Version 1 is complete:

1. **Foundation:** install, setup wizard, books, chart of accounts.
2. **Ledger:** journal entries, opening balances, registers, general ledger, activity log.
3. **Bank data:** SimpleFIN, CSV import, review queue, rules, transfer matching, receipts.
4. **Buckets:** bucket setup, allocation rules, bucket draws in review, transfers, goals.
5. **Reconciliation, loans, and credit cards.**
6. **Budgets and reports.**
7. **Polish:** install as an app, demo book, CI and published images.

Ideas for later (the schema leaves room): invoices and bills, multiple currencies,
importers from other apps.

To fix:

- Fix Journal Entries for backdating
- Fix backdating when uploading csv or pdf bank statements

## No warranty

Bucketbook is provided as is, without warranty of any kind, and its authors aren't liable
for any loss or damage from using it, including mistakes in your books or in bank data.
Bank connections go through SimpleFIN Bridge, a separate service with its own
[Terms of Use](https://beta-bridge.simplefin.org/info/terms) and
[Privacy Policy](https://beta-bridge.simplefin.org/info/privacy), which you accept when you
connect.

## License

Bucketbook is free software under the [GNU Affero General Public License v3.0 or later](LICENSE).
You may use, change and share it. If you run a changed version for other people over a
network, you must offer them its source code.
