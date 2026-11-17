# Bucketbook

Double-entry books for households and small businesses, with savings "buckets" inside
your real bank accounts, running on your own server.

> **Status: early development (Phase 1 of 7).** Today you can install it, run the
> setup wizard, create books from a template, and build your chart of accounts.
> Journal entries, bank sync, buckets, reconciliation and reports come in later
> phases (see [Roadmap](#roadmap)). Not ready for real money yet.

"Bucketbook" is a working name.

## What it is

- **Real double-entry accounting.** Every transaction balances, posted entries are
  never edited in place, and every change is recorded in an audit log.
- **Buckets.** Split one savings account into goals (Car, Vacation, Emergency) the way
  some online banks do, while the ledger stays correct: the bank account always equals
  the sum of its buckets.
- **Multiple books.** Keep your household and each business separate.
- **Your data, your server.** Plain Postgres with readable table names. Bank data comes
  in through [SimpleFIN](https://www.simplefin.org/) (coming in Phase 3).

## Install with Docker Compose

You need a machine with Docker and Docker Compose v2 or newer.

1. Get the code and create your settings file:

   ```bash
   git clone <this repository> bucketbook
   cd bucketbook
   cp .env.example .env
   ```

2. Fill in the required values in `.env`:

   | Setting              | What to put there                                                                                             |
   | -------------------- | ------------------------------------------------------------------------------------------------------------- |
   | `APP_URL`            | The address you'll type in the browser, for example `http://192.168.1.20:3000` or `https://books.example.com` |
   | `BETTER_AUTH_SECRET` | Output of `openssl rand -base64 32`                                                                           |
   | `APP_ENCRYPTION_KEY` | Output of `openssl rand -base64 32` (a different value)                                                       |
   | `POSTGRES_PASSWORD`  | Output of `openssl rand -hex 24`                                                                              |

   Keep `.env` private and back it up. Every setting is explained in
   [`.env.example`](.env.example).

3. Start it:

   ```bash
   docker compose up -d
   ```

   The first start builds the image, which takes a few minutes. Database migrations run
   automatically every time the app starts.

4. Open `APP_URL` in your browser. The setup wizard creates your login and your first
   book. The bank connection step can be skipped for now.

Check that it's healthy:

```bash
curl http://localhost:3000/api/health
```

### Behind a reverse proxy (Caddy)

No special configuration is needed. Set `APP_URL` to the public address and point the
proxy at the app's port, for example in a Caddyfile:

```
books.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

If you also open the app by another address (such as its LAN IP), add that address to
`TRUSTED_ORIGINS` in `.env`.

### Updating

```bash
git pull
docker compose up -d --build
```

Back up first (see [docs/backup-restore.md](docs/backup-restore.md)).

## Backups

Your data is in two Docker volumes: the database (`pgdata`) and uploaded receipts
(`receipts`). [docs/backup-restore.md](docs/backup-restore.md) has copy-and-paste
commands for both, plus how to restore. Also keep a copy of your `.env`: without
`APP_ENCRYPTION_KEY` you would need to reconnect your bank feeds after a restore.

## Development

Requirements: Node 24, npm, Docker.

```bash
npm install
npm run db:up                  # dev Postgres on 127.0.0.1:5433
cp .env.example .env.local     # then set DATABASE_URL and the secrets (see below)
npm run dev                    # http://localhost:3000
```

A working `.env.local` for development:

```
DATABASE_URL=postgres://bucketbook:bucketbook@localhost:5433/bucketbook
APP_URL=http://localhost:3000
BETTER_AUTH_SECRET=<openssl rand -base64 32>
APP_ENCRYPTION_KEY=<openssl rand -base64 32>
```

To open the dev server from another computer on your network, set `APP_URL` to
`http://<this machine's IP>:3000` and `DEV_ALLOWED_ORIGINS=<this machine's IP>`.

| Command                                                 | What it does                                                                                                      |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                                           | Dev server on port 3000, reachable on your network                                                                |
| `npm test`                                              | All Vitest tests (unit and integration)                                                                           |
| `npm run test:unit`                                     | Unit tests only, no database needed                                                                               |
| `npm run test:integration`                              | Integration tests against a throwaway `bucketbook_test` database in the dev Postgres                              |
| `npm run test:e2e`                                      | Builds the Docker image, starts a fresh install on port 3100, runs Playwright in a container, then removes it all |
| `npm run lint` / `npm run typecheck` / `npm run format` | Code checks                                                                                                       |
| `npm run db:generate`                                   | Create a new SQL migration after changing `src/server/db/schema`                                                  |
| `npm run db:migrate`                                    | Apply migrations by hand (the app also does this on start)                                                        |
| `npm run db:reset`                                      | Wipe the dev database (asks nothing, dev only)                                                                    |
| `npm run db:studio`                                     | Browse the dev database in Drizzle Studio                                                                         |

### Project layout

```
drizzle/                SQL migrations (generated, committed, readable)
scripts/                migrate, e2e runner
src/app/                pages and API routes (Next.js App Router)
src/components/         shared UI
src/lib/                code shared by browser and server (money, account types)
src/server/             server-only code: db schema, auth, services, jobs
tests/unit, tests/integration, e2e/
docs/                   decisions log, backup and restore
```

### Design tooling

UI work follows the Impeccable design skill and Emil Kowalski's design-engineering
skill. Product context is in `PRODUCT.md`. The skills themselves are not committed;
restore them with `npx skills experimental_install` (from `skills-lock.json`).

## Roadmap

1. **Foundation** (done): install, setup wizard, books, chart of accounts.
2. Ledger: journal entries, opening balances, registers, general ledger, audit log views.
3. Bank data: SimpleFIN, CSV import, review queue, rules, transfer matching, receipts.
4. Buckets: bucket setup, allocation rules, goals.
5. Reconciliation, loans, and credit cards.
6. Budgets and reports.
7. Polish, PWA, docs, and publishing.

## License

Not chosen yet.
