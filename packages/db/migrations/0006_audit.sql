-- 0006_audit - append-only audit trail with a per-row SHA-256 hash chain, then attach it (and the
-- updated_at trigger) to every table. Runs last so every table already exists.
--
-- Each row stores prev_hash (the previous row's row_hash; 64 zeros for the first) and
--   row_hash = sha256(prev_hash | timestamp | table | op | row id | actor | old | new).
-- Editing, deleting or inserting a row in the middle breaks the chain, and audit.verify_chain() finds it.
-- MVP-NOTE: truncating the TAIL of the chain is only detectable if the latest row_hash is anchored somewhere
-- outside the database (e.g. printed on a daily report or sent to a WORM store) - do that in production.

CREATE TABLE audit.trail (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at   timestamptz NOT NULL,
  table_schema text        NOT NULL,
  table_name   text        NOT NULL,
  operation    text        NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  row_id       text,
  actor_id     uuid, -- set by the API per transaction via set_config('app.user_id', ...); no FK so history outlives users
  old_data     jsonb,
  new_data     jsonb,
  prev_hash    text        NOT NULL,
  row_hash     text        NOT NULL UNIQUE,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trail_table_row_idx ON audit.trail (table_schema, table_name, row_id);
CREATE INDEX trail_created_at_idx ON audit.trail (created_at);
CREATE INDEX trail_actor_id_idx ON audit.trail (actor_id) WHERE actor_id IS NOT NULL;

CREATE FUNCTION audit.compute_hash(
  p_prev text, p_ts timestamptz, p_schema text, p_table text, p_op text,
  p_row_id text, p_actor uuid, p_old jsonb, p_new jsonb
) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT encode(
    sha256(convert_to(
      concat_ws('|',
        p_prev,
        to_char(p_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
        p_schema, p_table, p_op,
        coalesce(p_row_id, ''), coalesce(p_actor::text, ''),
        coalesce(p_old::text, ''), coalesce(p_new::text, '')
      ), 'UTF8')),
    'hex')
$$;

-- Trigger arguments name columns to redact (e.g. password_hash).
CREATE FUNCTION audit.log_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_old   jsonb;
  v_new   jsonb;
  v_prev  text;
  v_ts    timestamptz := clock_timestamp();
  v_rowid text;
  v_actor uuid;
  i       int;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN v_new := to_jsonb(NEW); END IF;

  FOR i IN 0 .. TG_NARGS - 1 LOOP
    v_old := v_old - TG_ARGV[i];
    v_new := v_new - TG_ARGV[i];
  END LOOP;

  v_rowid := coalesce(v_new ->> 'id', v_old ->> 'id');
  v_actor := nullif(current_setting('app.user_id', true), '')::uuid;

  -- Serialise chain writers: everyone reads the latest hash under this lock and holds it until commit,
  -- so id order == chain order. Deadlocks (rare, multi-table transactions in opposite order) are retried by the API.
  -- MVP-NOTE: this is a global write lock on audited tables; fine for one shop, not for high write rates.
  PERFORM pg_advisory_xact_lock(hashtextextended('audit.trail.chain', 0));
  SELECT row_hash INTO v_prev FROM audit.trail ORDER BY id DESC LIMIT 1;
  v_prev := coalesce(v_prev, repeat('0', 64));

  INSERT INTO audit.trail
    (created_at, table_schema, table_name, operation, row_id, actor_id, old_data, new_data, prev_hash, row_hash)
  VALUES
    (v_ts, TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP, v_rowid, v_actor, v_old, v_new, v_prev,
     audit.compute_hash(v_prev, v_ts, TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP, v_rowid, v_actor, v_old, v_new));

  RETURN NULL;
END
$$;

-- Walks the whole chain in order. Returns (rows checked, first broken id, reason); id/reason are NULL when intact.
CREATE FUNCTION audit.verify_chain() RETURNS TABLE (checked bigint, first_broken_id bigint, reason text)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  r      audit.trail%ROWTYPE;
  v_prev text := repeat('0', 64);
  v_n    bigint := 0;
BEGIN
  FOR r IN SELECT * FROM audit.trail ORDER BY id LOOP
    v_n := v_n + 1;
    IF r.prev_hash <> v_prev THEN
      RETURN QUERY SELECT v_n, r.id, 'prev_hash does not match the previous row (row removed, inserted or reordered)'::text;
      RETURN;
    END IF;
    IF r.row_hash <> audit.compute_hash(r.prev_hash, r.created_at, r.table_schema, r.table_name, r.operation,
                                        r.row_id, r.actor_id, r.old_data, r.new_data) THEN
      RETURN QUERY SELECT v_n, r.id, 'row_hash does not match the row contents (row was modified)'::text;
      RETURN;
    END IF;
    v_prev := r.row_hash;
  END LOOP;
  RETURN QUERY SELECT v_n, NULL::bigint, NULL::text;
END
$$;

CREATE TRIGGER a_trail_append_only
  BEFORE UPDATE OR DELETE ON audit.trail
  FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();
CREATE TRIGGER a_no_truncate_trail
  BEFORE TRUNCATE ON audit.trail
  FOR EACH STATEMENT EXECUTE FUNCTION core.reject_truncate();

-- -- attach audit triggers ----------------------------------------------------

CREATE FUNCTION audit.attach(p_schema text, p_table text, VARIADIC p_redact text[] DEFAULT '{}') RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_args text := coalesce((SELECT string_agg(quote_literal(c), ', ') FROM unnest(p_redact) AS c), '');
BEGIN
  EXECUTE format(
    'CREATE TRIGGER zz_audit AFTER INSERT OR UPDATE OR DELETE ON %I.%I FOR EACH ROW EXECUTE FUNCTION audit.log_change(%s)',
    p_schema, p_table, v_args);
END
$$;

SELECT audit.attach('core', 'users', 'password_hash');
SELECT audit.attach('core', 'roles');
SELECT audit.attach('core', 'permissions');
SELECT audit.attach('core', 'role_permissions');
SELECT audit.attach('core', 'user_roles');

SELECT audit.attach('crm', 'customers');
SELECT audit.attach('crm', 'contacts');

SELECT audit.attach('erp', 'quotes');
SELECT audit.attach('erp', 'quote_items');
SELECT audit.attach('erp', 'orders');
SELECT audit.attach('erp', 'order_items');
SELECT audit.attach('erp', 'production_stages');
SELECT audit.attach('erp', 'production_orders');
SELECT audit.attach('erp', 'work_orders');
SELECT audit.attach('erp', 'fsm_machines');
SELECT audit.attach('erp', 'fsm_states');
SELECT audit.attach('erp', 'fsm_transitions');

SELECT audit.attach('finance', 'chart_of_accounts');
SELECT audit.attach('finance', 'fiscal_years');
SELECT audit.attach('finance', 'journals');
SELECT audit.attach('finance', 'journal_entries');
SELECT audit.attach('finance', 'journal_entry_lines');
SELECT audit.attach('finance', 'invoices');
SELECT audit.attach('finance', 'payments');

SELECT audit.attach('inventory', 'warehouses');
SELECT audit.attach('inventory', 'items');
SELECT audit.attach('inventory', 'stock_moves');

SELECT audit.attach('workforce', 'tasks');
SELECT audit.attach('workforce', 'task_proofs');

-- -- updated_at auto-bump on every table that can be updated ------------------
-- (audit.trail and inventory.stock_moves are append-only: they still carry the column, but it never changes.)

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.table_schema, c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables tb
        ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
     WHERE c.column_name = 'updated_at'
       AND c.table_schema IN ('core', 'crm', 'erp', 'inventory', 'finance', 'workforce', 'audit')
       AND (c.table_schema, c.table_name) NOT IN (('audit', 'trail'), ('inventory', 'stock_moves'))
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON %I.%I FOR EACH ROW EXECUTE FUNCTION core.set_updated_at()',
      t.table_schema, t.table_name);
  END LOOP;
END
$$;
