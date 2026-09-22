-- 0004_inventory - warehouses, items, append-only stock moves, and the stock_levels quant table.
-- stock_levels is maintained by a trigger on stock_moves so on-hand is an O(1) primary-key lookup
-- and can never drift from the move history.

CREATE TABLE inventory.warehouses (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text        NOT NULL UNIQUE,
  name       text        NOT NULL,
  address    text,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE inventory.items (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  sku           text          NOT NULL UNIQUE,
  name          text          NOT NULL,
  unit          text          NOT NULL DEFAULT 'unit',
  category      text,
  min_stock     numeric(15,4) NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  is_active     boolean       NOT NULL DEFAULT true,
  custom_fields jsonb         NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(custom_fields) = 'object'),
  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX items_name_idx ON inventory.items (lower(name));

-- quantity is SIGNED: receipts / transfer-in positive, issues / transfer-out negative, adjustments either.
CREATE TABLE inventory.stock_moves (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id      uuid          NOT NULL REFERENCES inventory.items(id),
  warehouse_id uuid          NOT NULL REFERENCES inventory.warehouses(id),
  move_type    text          NOT NULL CHECK (move_type IN ('RECEIPT', 'ISSUE', 'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT')),
  quantity     numeric(15,4) NOT NULL CHECK (quantity <> 0),
  -- receipts: purchase cost supplied by the caller. issues: filled by the trigger with the weighted-average cost.
  unit_cost    numeric(15,4) CHECK (unit_cost IS NULL OR unit_cost >= 0),
  ref_type     text,
  ref_id       uuid,
  note         text,
  created_by   uuid          REFERENCES core.users(id) ON DELETE SET NULL,
  created_at   timestamptz   NOT NULL DEFAULT now(),
  updated_at   timestamptz   NOT NULL DEFAULT now(),
  CHECK (
    (move_type IN ('RECEIPT', 'TRANSFER_IN') AND quantity > 0)
    OR (move_type IN ('ISSUE', 'TRANSFER_OUT') AND quantity < 0)
    OR move_type = 'ADJUSTMENT'
  )
);
CREATE INDEX stock_moves_item_created_idx ON inventory.stock_moves (item_id, created_at);
CREATE INDEX stock_moves_warehouse_id_idx ON inventory.stock_moves (warehouse_id);
CREATE INDEX stock_moves_ref_idx ON inventory.stock_moves (ref_type, ref_id) WHERE ref_id IS NOT NULL;

CREATE TABLE inventory.stock_levels (
  item_id      uuid          NOT NULL REFERENCES inventory.items(id),
  warehouse_id uuid          NOT NULL REFERENCES inventory.warehouses(id),
  quantity     numeric(15,4) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  avg_cost     numeric(15,4) NOT NULL DEFAULT 0 CHECK (avg_cost >= 0),
  created_at   timestamptz   NOT NULL DEFAULT now(),
  updated_at   timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, warehouse_id)
);
CREATE INDEX stock_levels_warehouse_id_idx ON inventory.stock_levels (warehouse_id);

CREATE FUNCTION inventory.apply_stock_move() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_qty     numeric(15,4);
  v_avg     numeric(15,4);
  v_new_qty numeric(15,4);
BEGIN
  INSERT INTO inventory.stock_levels (item_id, warehouse_id)
  VALUES (NEW.item_id, NEW.warehouse_id)
  ON CONFLICT (item_id, warehouse_id) DO NOTHING;

  -- row lock: concurrent moves on the same (item, warehouse) are serialised, so the average stays consistent
  SELECT quantity, avg_cost INTO v_qty, v_avg
    FROM inventory.stock_levels
   WHERE item_id = NEW.item_id AND warehouse_id = NEW.warehouse_id
     FOR UPDATE;

  v_new_qty := v_qty + NEW.quantity;
  IF v_new_qty < 0 THEN
    RAISE EXCEPTION 'Insufficient stock: on hand %, requested %', v_qty, -NEW.quantity USING ERRCODE = 'VF004';
  END IF;

  -- MVP-NOTE: weighted-average cost. FIFO cost layers would hook in here: on a receipt insert a layer
  -- (move_id, remaining_qty, unit_cost); on an issue consume layers oldest-first and value the issue from them
  -- instead of from v_avg. Nothing outside this trigger depends on how the issue is valued.
  IF NEW.quantity > 0 THEN
    NEW.unit_cost := coalesce(NEW.unit_cost, v_avg);
    IF v_new_qty > 0 THEN
      v_avg := round((v_qty * v_avg + NEW.quantity * NEW.unit_cost) / v_new_qty, 4);
    END IF;
  ELSE
    NEW.unit_cost := v_avg; -- issues leave the average unchanged
  END IF;

  UPDATE inventory.stock_levels
     SET quantity = v_new_qty, avg_cost = v_avg, updated_at = now()
   WHERE item_id = NEW.item_id AND warehouse_id = NEW.warehouse_id;

  RETURN NEW;
END
$$;

CREATE TRIGGER a_apply_stock_move
  BEFORE INSERT ON inventory.stock_moves
  FOR EACH ROW EXECUTE FUNCTION inventory.apply_stock_move();

-- moves are history: corrections are new ADJUSTMENT moves, never edits
CREATE TRIGGER a_stock_moves_append_only
  BEFORE UPDATE OR DELETE ON inventory.stock_moves
  FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();
CREATE TRIGGER a_no_truncate_stock_moves
  BEFORE TRUNCATE ON inventory.stock_moves
  FOR EACH STATEMENT EXECUTE FUNCTION core.reject_truncate();
