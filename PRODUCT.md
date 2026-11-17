# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Self-hosting households and small-business owners who run their own home servers and know at least some bookkeeping. The first user is an accountant who keeps both family books and LLC books, so the app must satisfy someone who knows double-entry well, while staying friendly to a household member who just wants to see how much is in the car fund.

Typical sessions: a weekly sit-down at a desktop to review new bank transactions and post them; quick checks on a phone to see bucket balances or clear a few items from the review queue; month-end reconciliation and reports at a desk.

## Product Purpose

Keep honest, auditable double-entry books for one or more entities (a household and one or more small businesses), with bank data pulled in through SimpleFIN, and with "buckets": virtual sub-accounts inside a real bank account so one savings account can hold money for several goals. Success means the ledger always balances, bank balances tie out, and the family knows what every dollar in every bucket is for.

## Positioning

Real double-entry accounting with QuickBooks-level rigor (journal entries, chart of accounts, reconciliation, balance sheet) combined with Marcus-style savings buckets that live inside the ledger as child accounts, all self-hosted with the user's own database. Budget apps have envelopes without a ledger; accounting apps have a ledger without envelopes.

## Operating Context

- Runs in Docker Compose (app plus Postgres) on a home server, usually behind a reverse proxy on a private subdomain.
- Multiple books per install (for example a personal book and one per LLC); the user switches between them.
- Bank feeds come from SimpleFIN; transactions land in a For Review queue and post only after approval.
- Accounting vocabulary is used as accountants use it: debit, credit, journal entry, chart of accounts, reconcile, opening balance equity.

## Capabilities and Constraints

- Money is integer cents. Debits must equal credits. Posted entries are never edited in place.
- Chart of accounts uses Asset, Liability, Equity, Income, Expense with subtypes and unlimited nesting; accounts with activity can be archived, never deleted.
- Cash basis in v1. Single user in v1, with a schema ready for multiple users.
- Open source and published for other self-hosters: no personal details in the product, app name kept in one constant (the name is a placeholder).
- Out of scope for v1: invoices and bills, multiple currencies, payroll, sales tax, investment lots, importers, sharing UI, native apps.

## Brand Commitments

- Working name "Bucketbook" (placeholder; may change).
- Voice: warm and personal, a family's money app rather than an enterprise tool, while precise and trustworthy with numbers.
- Never use em dashes or en dashes in any copy.

## Evidence on Hand

No screenshots, testimonials, users, or metrics exist yet. Do not fabricate any.

## Product Principles

1. The ledger is the truth. Every number on screen ties back to journal lines the user can drill into.
2. Nothing posts without the user's approval; the app suggests, the user decides.
3. Precision first, personality second: friendliness never blurs a number.
4. Fast for the weekly routine: keyboard-driven review and entry on desktop, quick glances on a phone.
5. Self-hosters own their data: plain Postgres, readable migrations, documented backups.

## Accessibility & Inclusion

WCAG AA contrast in light and dark modes. Full keyboard navigation, especially in the review queue and journal entry screens. Tables use tabular figures, right-aligned amounts, and negatives that are clear without relying on color alone.
