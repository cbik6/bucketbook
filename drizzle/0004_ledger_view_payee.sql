-- Custom SQL migration file, put your code below! --
-- Adds the entry's payee to the ledger_lines view (new columns go at the end,
-- so existing queries keep working).
CREATE OR REPLACE VIEW ledger_lines AS
SELECT
  l.id AS line_id,
  l.book_id,
  e.id AS entry_id,
  e.entry_number,
  e.kind AS entry_kind,
  e.entry_date,
  e.memo AS entry_memo,
  l.line_number,
  l.account_id,
  l.debit_cents,
  l.credit_cents,
  l.debit_cents - l.credit_cents AS net_cents,
  l.memo AS line_memo,
  e.payee AS entry_payee
FROM journal_lines l
JOIN journal_entries e ON e.id = l.entry_id AND l.version = e.current_version
WHERE l.is_current;
