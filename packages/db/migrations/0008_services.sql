-- 0008_services - the services catalogue for area/length/batch pricing, and the order_items columns
-- that snapshot which service + rate + dimensions produced a line's price.
--
-- No existing "products" concept to extend: inventory.items is stock-only (no price field at all, the
-- wrong domain), and order_items had free-text description + a manually-typed unit_price with no catalog
-- reference. This is genuinely new, alongside erp.orders/order_items rather than inside inventory.
--
-- Snapshot design: order_items already stores its own unit_price/line_ht/line_tva/line_ttc directly on
-- the row at creation time (there is no separate invoice_items table; invoices just reference order_id),
-- so the immutability property this migration is asked to preserve already exists structurally. What's
-- added here is provenance: which service and rate produced that price, so a later change to a service's
-- ratio can never retroactively re-price an existing order/invoice line, same principle as the ledger.

CREATE TABLE erp.services (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text          NOT NULL UNIQUE,
  name         text          NOT NULL,
  pricing_unit text          NOT NULL CHECK (pricing_unit IN ('m2', 'per_item', 'per_linear_m')),
  -- Meaning depends on pricing_unit: DA per square meter; DA per single piece of any length; DA per whole
  -- batch (batch_size physical items) for per_item, e.g. "1500 DA per 1000 cards".
  price_ratio  numeric(15,4) NOT NULL CHECK (price_ratio >= 0),
  -- Only meaningful for per_item; 1 (i.e. plain per-unit pricing) for the other two units.
  batch_size   numeric(15,4) NOT NULL DEFAULT 1 CHECK (batch_size > 0),
  is_active    boolean       NOT NULL DEFAULT true,
  created_at   timestamptz   NOT NULL DEFAULT now(),
  updated_at   timestamptz   NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON erp.services FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
SELECT audit.attach('erp', 'services');

ALTER TABLE erp.order_items
  ADD COLUMN service_id uuid REFERENCES erp.services(id) ON DELETE SET NULL,
  -- Copied from the service at the moment the line was created/repriced, never re-read from erp.services
  -- afterwards, so an admin editing a service's rate tomorrow cannot silently change today's order.
  ADD COLUMN pricing_unit_snapshot text,
  ADD COLUMN price_ratio_snapshot numeric(15,4),
  ADD COLUMN batch_size_snapshot numeric(15,4),
  -- One piece's dimensions (meters). Named piece_* rather than bare width/height/length: the latter
  -- shadows the built-in length() function, a needless footgun in later queries on this table.
  ADD COLUMN piece_width numeric(10,3),
  ADD COLUMN piece_height numeric(10,3),
  ADD COLUMN piece_length numeric(10,3),
  ADD COLUMN is_price_override boolean NOT NULL DEFAULT false,
  ADD COLUMN override_reason text,
  ADD CONSTRAINT order_items_override_reason_required
    CHECK (NOT is_price_override OR (override_reason IS NOT NULL AND btrim(override_reason) <> ''));
CREATE INDEX order_items_service_id_idx ON erp.order_items (service_id) WHERE service_id IS NOT NULL;
