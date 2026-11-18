-- Deleting a whole (archived) book on purpose. The ledger guards still refuse
-- to delete posted history, except inside the one transaction that deletes
-- that book: it sets bucketbook.deleting_book to the book's id first, and only
-- rows of that book may then be removed.
CREATE OR REPLACE FUNCTION ledger_deleting_book(p_book_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('bucketbook.deleting_book', true), '') = p_book_id::text
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION ledger_lines_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1 OR ledger_deleting_book(OLD.book_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Journal lines cannot be deleted; post a new version or a reversal'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.is_current = true AND OLD.is_current = false THEN
    RAISE EXCEPTION 'A replaced journal line cannot become current again'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.id, NEW.book_id, NEW.entry_id, NEW.version, NEW.line_number, NEW.account_id,
      NEW.debit_cents, NEW.credit_cents, NEW.memo, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.book_id, OLD.entry_id, OLD.version, OLD.line_number, OLD.account_id,
      OLD.debit_cents, OLD.credit_cents, OLD.memo, OLD.created_at) THEN
    RAISE EXCEPTION 'Journal lines cannot be edited in place; post a new version instead'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION ledger_history_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND (
    pg_trigger_depth() > 1
    OR EXISTS (
      SELECT 1 FROM journal_entries e
      WHERE e.id = OLD.entry_id AND ledger_deleting_book(e.book_id)
    )
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% rows are history and cannot be changed', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION ledger_entries_no_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR ledger_deleting_book(OLD.book_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Journal entries cannot be deleted; reverse them instead'
    USING ERRCODE = 'restrict_violation';
END;
$$;
