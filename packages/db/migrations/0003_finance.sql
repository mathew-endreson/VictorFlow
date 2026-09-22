-- 0003_finance - double-entry ledger.
-- Invariants enforced IN THE DATABASE (the service checks them first for good error messages, but the
-- DB is the last line of defence and cannot be bypassed by a buggy caller):
--   * an entry can only become POSTED if it has >= 2 lines and sum(debit) = sum(credit)
--   * the entry number comes from a Postgres SEQUENCE per (journal, fiscal year) - never COUNT(*)+1
--   * POSTED entries and their lines are immutable (UPDATE / DELETE / INSERT-into / TRUNCATE rejected)
--   * cancellation = a NEW reversing entry (reversal_of), the original is never touched

CREATE TABLE finance.chart_of_accounts (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text        NOT NULL UNIQUE CHECK (code ~ '^[0-9]{1,10}$'),
  name         text        NOT NULL,
  account_type text        NOT NULL CHECK (account_type IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')),
  parent_id    uuid        REFERENCES finance.chart_of_accounts(id),
  is_postable  boolean     NOT NULL DEFAULT true,
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chart_of_accounts_parent_id_idx ON finance.chart_of_accounts (parent_id) WHERE parent_id IS NOT NULL;

CREATE TABLE finance.fiscal_years (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text        NOT NULL UNIQUE CHECK (code ~ '^[0-9A-Z]{4,8}$'),
  start_date date        NOT NULL,
  end_date   date        NOT NULL,
  status     text        NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date > start_date),
  -- fiscal years must not overlap, otherwise "which year does this date belong to" is ambiguous
  EXCLUDE USING gist (daterange(start_date, end_date, '[]') WITH &&)
);

CREATE TABLE finance.journals (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text        NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{2,6}$'),
  name         text        NOT NULL,
  journal_type text        NOT NULL CHECK (journal_type IN ('SALES', 'PURCHASES', 'BANK', 'CASH', 'GENERAL')),
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE finance.journal_entries (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id     uuid        NOT NULL REFERENCES finance.journals(id),
  fiscal_year_id uuid        NOT NULL REFERENCES finance.fiscal_years(id),
  entry_number   text        UNIQUE,
  entry_date     date        NOT NULL,
  description    text        NOT NULL,
  reference      text,
  source_type    text        NOT NULL DEFAULT 'MANUAL' CHECK (source_type IN ('MANUAL', 'INVOICE', 'PAYMENT', 'REVERSAL')),
  source_id      uuid,
  status         text        NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'POSTED')),
  reversal_of    uuid        UNIQUE REFERENCES finance.journal_entries(id),
  posted_at      timestamptz,
  posted_by      uuid        REFERENCES core.users(id) ON DELETE SET NULL,
  created_by     uuid        REFERENCES core.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'POSTED') = (entry_number IS NOT NULL))
);
CREATE INDEX journal_entries_journal_fy_idx ON finance.journal_entries (journal_id, fiscal_year_id);
CREATE INDEX journal_entries_fiscal_year_idx ON finance.journal_entries (fiscal_year_id);
CREATE INDEX journal_entries_entry_date_idx ON finance.journal_entries (entry_date);
CREATE INDEX journal_entries_source_idx ON finance.journal_entries (source_type, source_id) WHERE source_id IS NOT NULL;

CREATE TABLE finance.journal_entry_lines (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id    uuid          NOT NULL REFERENCES finance.journal_entries(id),
  account_id  uuid          NOT NULL REFERENCES finance.chart_of_accounts(id),
  partner_id  uuid          REFERENCES crm.customers(id),
  description text,
  debit       numeric(15,4) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit      numeric(15,4) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  created_at  timestamptz   NOT NULL DEFAULT now(),
  updated_at  timestamptz   NOT NULL DEFAULT now(),
  -- exactly one side carries the amount
  CHECK ((debit = 0) <> (credit = 0))
);
CREATE INDEX journal_entry_lines_entry_id_idx ON finance.journal_entry_lines (entry_id);
CREATE INDEX journal_entry_lines_partner_id_idx ON finance.journal_entry_lines (partner_id);
CREATE INDEX journal_entry_lines_account_id_idx ON finance.journal_entry_lines (account_id);

-- -- invoices & payments ------------------------------------------------------

CREATE TABLE finance.invoices (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  number           text          NOT NULL UNIQUE,
  order_id         uuid          NOT NULL REFERENCES erp.orders(id),
  customer_id      uuid          NOT NULL REFERENCES crm.customers(id),
  invoice_date     date          NOT NULL,
  due_date         date,
  status           text          NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED')),
  total_ht         numeric(15,4) NOT NULL CHECK (total_ht >= 0),
  total_tva        numeric(15,4) NOT NULL CHECK (total_tva >= 0),
  total_ttc        numeric(15,4) NOT NULL CHECK (total_ttc >= 0),
  amount_paid      numeric(15,4) NOT NULL DEFAULT 0,
  journal_entry_id uuid          REFERENCES finance.journal_entries(id),
  cancel_entry_id  uuid          REFERENCES finance.journal_entries(id),
  cancelled_at     timestamptz,
  created_by       uuid          REFERENCES core.users(id) ON DELETE SET NULL,
  created_at       timestamptz   NOT NULL DEFAULT now(),
  updated_at       timestamptz   NOT NULL DEFAULT now(),
  CHECK (amount_paid >= 0 AND amount_paid <= total_ttc),
  CHECK (total_ttc = total_ht + total_tva)
);
-- one live invoice per order (a cancelled one can be re-issued)
CREATE UNIQUE INDEX invoices_one_active_per_order_uq ON finance.invoices (order_id) WHERE status <> 'CANCELLED';
CREATE INDEX invoices_customer_id_idx ON finance.invoices (customer_id);
CREATE INDEX invoices_status_idx ON finance.invoices (status);
CREATE INDEX invoices_invoice_date_idx ON finance.invoices (invoice_date);

CREATE TABLE finance.payments (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id       uuid          NOT NULL REFERENCES finance.invoices(id),
  customer_id      uuid          NOT NULL REFERENCES crm.customers(id),
  amount           numeric(15,4) NOT NULL CHECK (amount > 0),
  method           text          NOT NULL CHECK (method IN ('CASH', 'BANK_TRANSFER', 'CHEQUE', 'CARD')),
  paid_at          date          NOT NULL,
  reference        text,
  journal_entry_id uuid          REFERENCES finance.journal_entries(id),
  created_by       uuid          REFERENCES core.users(id) ON DELETE SET NULL,
  created_at       timestamptz   NOT NULL DEFAULT now(),
  updated_at       timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX payments_invoice_id_idx ON finance.payments (invoice_id);
CREATE INDEX payments_customer_id_idx ON finance.payments (customer_id);

-- -- fiscal-year checks & entry numbering -------------------------------------

CREATE FUNCTION finance.assert_fiscal_year_open(p_fy uuid, p_date date) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_fy finance.fiscal_years%ROWTYPE;
BEGIN
  SELECT * INTO v_fy FROM finance.fiscal_years WHERE id = p_fy;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown fiscal year %', p_fy USING ERRCODE = 'VF003';
  END IF;
  IF p_date < v_fy.start_date OR p_date > v_fy.end_date THEN
    RAISE EXCEPTION 'Entry date % is outside fiscal year % (% to %)', p_date, v_fy.code, v_fy.start_date, v_fy.end_date
      USING ERRCODE = 'VF003';
  END IF;
  IF v_fy.status <> 'OPEN' THEN
    RAISE EXCEPTION 'Fiscal year % is closed', v_fy.code USING ERRCODE = 'VF003';
  END IF;
END
$$;

-- Next number for (journal, fiscal year), drawn from a dedicated Postgres SEQUENCE
-- finance.je_seq_<journal>_<fy>, created on first use. The advisory lock makes the lazy
-- CREATE SEQUENCE race-free. The fiscal year is the one derived from the entry DATE, never the clock.
-- MVP-NOTE: sequences can skip numbers when a transaction rolls back after nextval(); some jurisdictions
-- require gap-free journal numbering - swap this for a counter row (like core.next_doc_no) if yours does.
CREATE FUNCTION finance.next_entry_number(p_journal uuid, p_fy uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_jcode  text;
  v_fycode text;
  v_seq    text;
  v_n      bigint;
BEGIN
  SELECT code INTO v_jcode FROM finance.journals WHERE id = p_journal;
  SELECT code INTO v_fycode FROM finance.fiscal_years WHERE id = p_fy;
  IF v_jcode IS NULL OR v_fycode IS NULL THEN
    RAISE EXCEPTION 'Cannot number entry: unknown journal or fiscal year' USING ERRCODE = 'VF003';
  END IF;

  v_seq := 'je_seq_' || lower(v_jcode) || '_' || lower(v_fycode);
  PERFORM pg_advisory_xact_lock(hashtextextended('finance.' || v_seq, 0));
  EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I.%I', 'finance', v_seq);
  EXECUTE format('SELECT nextval(%L::regclass)', format('%I.%I', 'finance', v_seq)) INTO v_n;

  RETURN v_jcode || '/' || v_fycode || '/' || lpad(v_n::text, 6, '0');
END
$$;

-- -- immutability / balance guards --------------------------------------------

CREATE FUNCTION finance.guard_entry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_count  bigint;
  v_debit  numeric;
  v_credit numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'POSTED' THEN
      RAISE EXCEPTION 'POSTED journal entry % is immutable: DELETE rejected', OLD.entry_number USING ERRCODE = 'VF001';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Journal entries are created as DRAFT and posted with an UPDATE (so lines can be validated first)'
        USING ERRCODE = 'VF001';
    END IF;
    PERFORM finance.assert_fiscal_year_open(NEW.fiscal_year_id, NEW.entry_date);
    RETURN NEW;
  END IF;

  -- UPDATE
  IF OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'POSTED journal entry % is immutable: UPDATE rejected', OLD.entry_number USING ERRCODE = 'VF001';
  END IF;

  PERFORM finance.assert_fiscal_year_open(NEW.fiscal_year_id, NEW.entry_date);

  IF NEW.status = 'POSTED' THEN
    SELECT count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0)
      INTO v_count, v_debit, v_credit
      FROM finance.journal_entry_lines WHERE entry_id = NEW.id;
    IF v_count < 2 THEN
      RAISE EXCEPTION 'A journal entry needs at least 2 lines (has %)', v_count USING ERRCODE = 'VF002';
    END IF;
    IF v_debit <> v_credit THEN
      RAISE EXCEPTION 'Unbalanced journal entry: debit % <> credit %', v_debit, v_credit USING ERRCODE = 'VF002';
    END IF;
    NEW.entry_number := finance.next_entry_number(NEW.journal_id, NEW.fiscal_year_id);
    NEW.posted_at := coalesce(NEW.posted_at, now());
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER a_guard_entry
  BEFORE INSERT OR UPDATE OR DELETE ON finance.journal_entries
  FOR EACH ROW EXECUTE FUNCTION finance.guard_entry();

CREATE FUNCTION finance.guard_entry_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_status  text;
  v_number  text;
  v_entry   uuid;
  v_entries uuid[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_entries := ARRAY[NEW.entry_id];
  ELSIF TG_OP = 'DELETE' THEN
    v_entries := ARRAY[OLD.entry_id];
  ELSE
    v_entries := ARRAY[OLD.entry_id, NEW.entry_id];
  END IF;

  FOREACH v_entry IN ARRAY v_entries
  LOOP
    -- FOR SHARE: a concurrent transaction that is posting this entry must wait for us (and vice versa),
    -- so a line can never slip into an entry between its balance check and its POSTED flip.
    SELECT status, entry_number INTO v_status, v_number
      FROM finance.journal_entries WHERE id = v_entry FOR SHARE;
    IF FOUND AND v_status = 'POSTED' THEN
      RAISE EXCEPTION 'Lines of POSTED journal entry % are immutable: % rejected', v_number, TG_OP USING ERRCODE = 'VF001';
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER a_guard_entry_line
  BEFORE INSERT OR UPDATE OR DELETE ON finance.journal_entry_lines
  FOR EACH ROW EXECUTE FUNCTION finance.guard_entry_line();

CREATE TRIGGER a_no_truncate_entries
  BEFORE TRUNCATE ON finance.journal_entries
  FOR EACH STATEMENT EXECUTE FUNCTION core.reject_truncate();
CREATE TRIGGER a_no_truncate_entry_lines
  BEFORE TRUNCATE ON finance.journal_entry_lines
  FOR EACH STATEMENT EXECUTE FUNCTION core.reject_truncate();
