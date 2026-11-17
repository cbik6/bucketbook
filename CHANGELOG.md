# Changelog

All notable changes to this project are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
