-- Ledger guards: the database itself refuses an unbalanced or edited-in-place ledger,
-- even if application code has a bug.

-- 1. Every journal entry must balance. Checked at COMMIT (deferred), so an entry
--    and all of its lines can be written in one transaction before the check runs.
CREATE FUNCTION ledger_assert_entry_balanced(p_entry_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_version integer;
  v_lines integer;
  v_debits bigint;
  v_credits bigint;
  v_stray integer;
  v_number integer;
BEGIN
  SELECT current_version, entry_number INTO v_version, v_number
    FROM journal_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN
    RETURN; -- the entry was deleted in this transaction (book removal)
  END IF;

  SELECT count(*), coalesce(sum(debit_cents), 0), coalesce(sum(credit_cents), 0)
    INTO v_lines, v_debits, v_credits
    FROM journal_lines
   WHERE entry_id = p_entry_id AND version = v_version AND is_current;

  SELECT count(*) INTO v_stray
    FROM journal_lines
   WHERE entry_id = p_entry_id AND is_current <> (version = v_version);

  IF v_lines < 2 THEN
    RAISE EXCEPTION 'Journal entry % needs at least two lines (has %)', v_number, v_lines
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_debits <> v_credits THEN
    RAISE EXCEPTION 'Journal entry % does not balance: debits % cents, credits % cents',
      v_number, v_debits, v_credits
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_stray > 0 THEN
    RAISE EXCEPTION 'Journal entry % has lines from more than one version marked current', v_number
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION ledger_check_lines_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ledger_assert_entry_balanced(NEW.entry_id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_lines_balanced
  AFTER INSERT OR UPDATE ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_check_lines_trigger();
--> statement-breakpoint
CREATE FUNCTION ledger_check_entry_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ledger_assert_entry_balanced(NEW.id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_entries_balanced
  AFTER INSERT OR UPDATE OF current_version ON journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_check_entry_trigger();
--> statement-breakpoint

-- 2. Posted lines are never edited or deleted. The only allowed change is
--    is_current flipping to false when a newer version replaces them.
--    Deletes are allowed only as part of removing a whole book (a cascade).
CREATE FUNCTION ledger_lines_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1 THEN
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
CREATE TRIGGER journal_lines_append_only
  BEFORE UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION ledger_lines_append_only();
--> statement-breakpoint
CREATE FUNCTION ledger_history_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% rows are history and cannot be changed', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER journal_entry_versions_immutable
  BEFORE UPDATE OR DELETE ON journal_entry_versions
  FOR EACH ROW EXECUTE FUNCTION ledger_history_immutable();
--> statement-breakpoint
CREATE FUNCTION ledger_entries_no_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Journal entries cannot be deleted; reverse them instead'
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER journal_entries_no_delete
  BEFORE DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_no_delete();
--> statement-breakpoint

-- 3. Lines may only post to accounts that accept postings (never to a bucket parent).
CREATE FUNCTION ledger_lines_posting_account() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_allows boolean;
BEGIN
  SELECT allows_posting INTO v_allows FROM accounts WHERE id = NEW.account_id;
  IF NOT coalesce(v_allows, false) THEN
    RAISE EXCEPTION 'Account % does not accept postings', NEW.account_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER journal_lines_posting_account
  BEFORE INSERT ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION ledger_lines_posting_account();
--> statement-breakpoint

-- 4. A readable view of the current ledger for reports and for querying by hand:
--    one row per current line, with the entry's date, number and memo.
CREATE VIEW ledger_lines AS
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
  l.memo AS line_memo
FROM journal_lines l
JOIN journal_entries e ON e.id = l.entry_id AND l.version = e.current_version
WHERE l.is_current;
