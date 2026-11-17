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

### D21. Design direction

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
